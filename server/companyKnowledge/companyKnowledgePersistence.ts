import crypto from 'crypto';
import { postgresPersistenceEnabled } from '../persistence/postgres.js';
import {
  postgresCompanyKnowledgeRepository,
} from '../persistence/a3PostgresRepositories.js';
import { postgresAccountRepository } from '../persistence/postgresRepositories.js';
import {
  CompanyKnowledgeAccessError,
  companyKnowledgeStore,
  normalizeEntityName,
} from './companyKnowledgeStore.js';
import type {
  BusinessEvent,
  CompanyEntity,
  CompanyEntityType,
  CompanyRelationship,
  KnowledgeClaim,
  KnowledgeClaimKind,
  KnowledgeClaimValue,
  KnowledgeProjectionRun,
  KnowledgeSnapshotCounts,
  KnowledgeSourceRef,
  SourceAuthority,
} from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function shortHash(parts: unknown[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 20);
}

function sourceRefKey(source: KnowledgeSourceRef): string {
  return JSON.stringify([
    source.sourceType,
    source.sourceId,
    source.sourceVersionId || null,
    source.tableId || null,
    source.rowIndex ?? null,
    source.documentId || null,
    source.pageNumber ?? null,
    source.excerpt || null,
  ]);
}

function mergeSourceRefs(
  existing: KnowledgeSourceRef[],
  incoming: KnowledgeSourceRef[]
): KnowledgeSourceRef[] {
  const merged = new Map<string, KnowledgeSourceRef>();
  for (const source of [...existing, ...incoming]) {
    merged.set(sourceRefKey(source), clone(source));
  }
  return Array.from(merged.values());
}

function claimValueType(
  value: KnowledgeClaimValue
): KnowledgeClaim['valueType'] {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return 'NUMBER';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    return 'DATE';
  }
  return 'TEXT';
}

export class CompanyKnowledgePersistence {
  public usesPostgres(): boolean {
    return postgresPersistenceEnabled();
  }

  public async saveProjectionRun(
    run: KnowledgeProjectionRun
  ): Promise<KnowledgeProjectionRun> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.saveProjectionRun(run);
    }
    await postgresAccountRepository.ensureAccount(run.accountId);
    await postgresCompanyKnowledgeRepository.saveProjectionRun(run);
    return clone(run);
  }

  public async upsertEntity(params: {
    accountId: string;
    type: CompanyEntityType;
    canonicalName: string;
    identityKey?: string;
    aliases?: string[];
    sourceRef: KnowledgeSourceRef;
    observedAt: number;
  }): Promise<CompanyEntity> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.upsertEntity(params);
    }

    await postgresAccountRepository.ensureAccount(params.accountId);
    const normalizedName = normalizeEntityName(
      params.canonicalName
    );
    const requestedIdentityKey = params.identityKey
      ? normalizeEntityName(params.identityKey)
      : '';

    if (
      !normalizedName ||
      (params.identityKey && !requestedIdentityKey)
    ) {
      throw new Error(
        'Entity name and identity key cannot be empty.'
      );
    }

    const sameType =
      await postgresCompanyKnowledgeRepository.listEntities({
        accountId: params.accountId,
        type: params.type,
        limit: 1000,
      });

    const nameMatches = !requestedIdentityKey
      ? sameType.filter(
          (entity) =>
            entity.normalizedName === normalizedName ||
            entity.aliases.some(
              (alias) =>
                normalizeEntityName(alias) ===
                normalizedName
            )
        )
      : [];

    const matchedByName =
      nameMatches.length === 1 ? nameMatches[0] : null;
    const identityKey =
      requestedIdentityKey ||
      matchedByName?.identityKey ||
      normalizedName;
    const id =
      matchedByName?.id ||
      'ent_' +
        shortHash([
          params.accountId,
          params.type,
          identityKey,
        ]);

    const existing =
      await postgresCompanyKnowledgeRepository.getEntity(
        params.accountId,
        id
      );

    if (existing) {
      const aliases = new Set(existing.aliases);
      aliases.add(existing.canonicalName);
      aliases.add(params.canonicalName);
      for (const alias of params.aliases || []) {
        if (alias.trim()) aliases.add(alias.trim());
      }

      const shouldImproveDisplayName =
        normalizeEntityName(existing.canonicalName) ===
          existing.identityKey &&
        normalizedName !== identityKey;

      const updated: CompanyEntity = {
        ...existing,
        canonicalName: shouldImproveDisplayName
          ? params.canonicalName.trim()
          : existing.canonicalName,
        normalizedName: shouldImproveDisplayName
          ? normalizedName
          : existing.normalizedName,
        aliases: Array.from(aliases).filter(
          (alias) =>
            normalizeEntityName(alias) !== normalizedName
        ),
        sourceRefs: mergeSourceRefs(existing.sourceRefs, [
          params.sourceRef,
        ]),
        updatedAt: Date.now(),
        lastObservedAt: Math.max(
          existing.lastObservedAt,
          params.observedAt
        ),
      };
      await postgresCompanyKnowledgeRepository.saveEntity(
        updated
      );
      return updated;
    }

    const now = Date.now();
    const entity: CompanyEntity = {
      id,
      accountId: params.accountId,
      type: params.type,
      canonicalName: params.canonicalName.trim(),
      normalizedName,
      identityKey,
      aliases: Array.from(
        new Set(
          (params.aliases || [])
            .map((alias) => alias.trim())
            .filter(Boolean)
        )
      ).filter(
        (alias) =>
          normalizeEntityName(alias) !== normalizedName
      ),
      sourceRefs: [clone(params.sourceRef)],
      createdAt: now,
      updatedAt: now,
      firstObservedAt: params.observedAt,
      lastObservedAt: params.observedAt,
    };

    await postgresCompanyKnowledgeRepository.saveEntity(entity);
    return entity;
  }

  public async upsertRelationship(params: {
    accountId: string;
    subjectEntityId: string;
    predicate: string;
    objectEntityId: string;
    claimKind: KnowledgeClaimKind;
    authority: SourceAuthority;
    sourceRef: KnowledgeSourceRef;
    observedAt: number;
  }): Promise<CompanyRelationship> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.upsertRelationship(params);
    }

    const subject = await this.requireEntity(
      params.accountId,
      params.subjectEntityId
    );
    const object = await this.requireEntity(
      params.accountId,
      params.objectEntityId
    );
    const predicate = params.predicate
      .trim()
      .toUpperCase();
    if (!predicate) {
      throw new Error(
        'Relationship predicate is required.'
      );
    }

    const fingerprint = shortHash([
      params.accountId,
      subject.id,
      predicate,
      object.id,
      params.claimKind,
    ]);
    const id = 'rel_' + fingerprint;

    const existing =
      await postgresCompanyKnowledgeRepository.getRelationship(
        params.accountId,
        id
      );

    if (existing) {
      const sourceAlreadyPresent =
        existing.sourceRefs.some(
          (source) =>
            sourceRefKey(source) ===
            sourceRefKey(params.sourceRef)
        );

      const updated: CompanyRelationship = {
        ...existing,
        authority:
          params.authority.rank > existing.authority.rank
            ? clone(params.authority)
            : existing.authority,
        sourceRefs: mergeSourceRefs(existing.sourceRefs, [
          params.sourceRef,
        ]),
        lastObservedAt: Math.max(
          existing.lastObservedAt,
          params.observedAt
        ),
        occurrenceCount:
          existing.occurrenceCount +
          (sourceAlreadyPresent ? 0 : 1),
        updatedAt: Date.now(),
      };
      await postgresCompanyKnowledgeRepository.saveRelationship(
        updated
      );
      return updated;
    }

    const now = Date.now();
    const relationship: CompanyRelationship = {
      id,
      fingerprint,
      accountId: params.accountId,
      subjectEntityId: subject.id,
      predicate,
      objectEntityId: object.id,
      claimKind: params.claimKind,
      authority: clone(params.authority),
      sourceRefs: [clone(params.sourceRef)],
      firstObservedAt: params.observedAt,
      lastObservedAt: params.observedAt,
      occurrenceCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    await postgresCompanyKnowledgeRepository.saveRelationship(
      relationship
    );
    return relationship;
  }

  public async recordClaim(params: {
    accountId: string;
    subjectEntityId: string;
    predicate: string;
    value: KnowledgeClaimValue;
    claimKind: KnowledgeClaimKind;
    authority: SourceAuthority;
    sourceRef: KnowledgeSourceRef;
    observedAt: number;
    validFrom?: number;
  }): Promise<KnowledgeClaim> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.recordClaim(params);
    }

    const subject = await this.requireEntity(
      params.accountId,
      params.subjectEntityId
    );
    const predicate = params.predicate
      .trim()
      .toUpperCase();
    if (!predicate) {
      throw new Error('Claim predicate is required.');
    }

    const fingerprint = shortHash([
      params.accountId,
      subject.id,
      predicate,
      params.value,
      params.claimKind,
      params.sourceRef.sourceType,
      params.sourceRef.sourceId,
      params.sourceRef.sourceVersionId || null,
      params.sourceRef.tableId || null,
      params.sourceRef.rowIndex ?? null,
      params.sourceRef.documentId || null,
      params.sourceRef.pageNumber ?? null,
    ]);
    const claimId = 'clm_' + fingerprint;
    const duplicate =
      await postgresCompanyKnowledgeRepository.getClaim(
        params.accountId,
        claimId
      );
    if (duplicate) return duplicate;

    const currentClaims =
      await postgresCompanyKnowledgeRepository.listClaims({
        accountId: params.accountId,
        entityId: subject.id,
        predicate,
        currentOnly: true,
        limit: 1000,
      });

    const priorCurrent = currentClaims
      .filter(
        (claim) =>
          claim.sourceRef.sourceType ===
            params.sourceRef.sourceType &&
          claim.sourceRef.sourceId ===
            params.sourceRef.sourceId
      )
      .sort(
        (a, b) => b.observedAt - a.observedAt
      )[0];

    let supersedesClaimId: string | undefined;
    let isCurrent = true;
    let historicalValidTo: number | undefined;
    let closeClaimId: string | undefined;

    if (
      priorCurrent &&
      priorCurrent.sourceRef.sourceVersionId !==
        params.sourceRef.sourceVersionId
    ) {
      if (
        params.observedAt >= priorCurrent.observedAt
      ) {
        supersedesClaimId = priorCurrent.id;
        closeClaimId = priorCurrent.id;
      } else {
        isCurrent = false;
        historicalValidTo = priorCurrent.observedAt;
      }
    }

    const claim: KnowledgeClaim = {
      id: claimId,
      fingerprint,
      accountId: params.accountId,
      subjectEntityId: subject.id,
      predicate,
      value: params.value,
      valueType: claimValueType(params.value),
      claimKind: params.claimKind,
      authority: clone(params.authority),
      sourceRef: clone(params.sourceRef),
      observedAt: params.observedAt,
      validFrom: params.validFrom,
      validTo: historicalValidTo,
      isCurrent,
      supersedesClaimId,
      createdAt: Date.now(),
    };

    await postgresCompanyKnowledgeRepository
      .saveClaimWithSupersession({
        claim,
        closeClaimId,
        closeValidTo: params.observedAt,
      });

    return claim;
  }

  public async recordEvent(params: {
    accountId: string;
    type: string;
    subjectEntityIds: string[];
    data?: Record<string, KnowledgeClaimValue>;
    sourceRef: KnowledgeSourceRef;
    occurredAt?: number;
    recordedAt: number;
    projectionRunId?: string;
    fingerprintParts?: unknown[];
  }): Promise<BusinessEvent> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.recordEvent(params);
    }

    for (const entityId of params.subjectEntityIds) {
      await this.requireEntity(params.accountId, entityId);
    }

    const fingerprint = shortHash([
      params.accountId,
      params.type,
      params.subjectEntityIds,
      params.sourceRef.sourceType,
      params.sourceRef.sourceId,
      params.sourceRef.sourceVersionId || null,
      params.sourceRef.tableId || null,
      params.sourceRef.rowIndex ?? null,
      params.occurredAt || null,
      params.fingerprintParts || [],
    ]);
    const id = 'evt_' + fingerprint;
    const existing =
      await postgresCompanyKnowledgeRepository.getEvent(
        params.accountId,
        id
      );
    if (existing) return existing;

    const event: BusinessEvent = {
      id,
      fingerprint,
      accountId: params.accountId,
      type: params.type.trim().toUpperCase(),
      subjectEntityIds: [...params.subjectEntityIds],
      data: clone(params.data || {}),
      sourceRef: clone(params.sourceRef),
      occurredAt: params.occurredAt,
      recordedAt: params.recordedAt,
      projectionRunId: params.projectionRunId,
    };
    await postgresCompanyKnowledgeRepository.saveEvent(event);
    return event;
  }

  public async getEntity(
    accountId: string,
    entityId: string
  ): Promise<CompanyEntity | null> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.getEntity(
        accountId,
        entityId
      );
    }
    return postgresCompanyKnowledgeRepository.getEntity(
      accountId,
      entityId
    );
  }

  public async requireEntity(
    accountId: string,
    entityId: string
  ): Promise<CompanyEntity> {
    const entity = await this.getEntity(
      accountId,
      entityId
    );
    if (!entity) {
      throw new CompanyKnowledgeAccessError(
        'ENTITY_NOT_FOUND',
        'Entity not found in the current account scope.'
      );
    }
    return entity;
  }

  public async listEntities(params: {
    accountId: string;
    type?: CompanyEntityType;
    search?: string;
    limit?: number;
  }): Promise<CompanyEntity[]> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.listEntities(params);
    }

    const limit = Math.max(
      1,
      Math.min(params.limit || 100, 500)
    );
    const search = normalizeEntityName(
      params.search || ''
    );
    const entities =
      await postgresCompanyKnowledgeRepository.listEntities({
        accountId: params.accountId,
        type: params.type,
        limit: search ? 1000 : limit,
      });

    return entities
      .filter(
        (entity) =>
          !search ||
          entity.normalizedName.includes(search) ||
          entity.identityKey.includes(search) ||
          entity.aliases.some((alias) =>
            normalizeEntityName(alias).includes(search)
          )
      )
      .slice(0, limit);
  }

  public async getRelationship(
    accountId: string,
    relationshipId: string
  ): Promise<CompanyRelationship | null> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.getRelationship(
        accountId,
        relationshipId
      );
    }
    return postgresCompanyKnowledgeRepository.getRelationship(
      accountId,
      relationshipId
    );
  }

  public async listRelationships(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    limit?: number;
  }): Promise<CompanyRelationship[]> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.listRelationships(params);
    }
    return postgresCompanyKnowledgeRepository.listRelationships(
      params
    );
  }

  public async getClaim(
    accountId: string,
    claimId: string
  ): Promise<KnowledgeClaim | null> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.getClaim(
        accountId,
        claimId
      );
    }
    return postgresCompanyKnowledgeRepository.getClaim(
      accountId,
      claimId
    );
  }

  public async listClaims(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    currentOnly?: boolean;
    limit?: number;
  }): Promise<KnowledgeClaim[]> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.listClaims(params);
    }
    return postgresCompanyKnowledgeRepository.listClaims(
      params
    );
  }

  public async getEvent(
    accountId: string,
    eventId: string
  ): Promise<BusinessEvent | null> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.getEvent(
        accountId,
        eventId
      );
    }
    return postgresCompanyKnowledgeRepository.getEvent(
      accountId,
      eventId
    );
  }

  public async listEvents(params: {
    accountId: string;
    entityId?: string;
    type?: string;
    since?: number;
    limit?: number;
  }): Promise<BusinessEvent[]> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.listEvents(params);
    }
    return postgresCompanyKnowledgeRepository.listEvents(
      params
    );
  }

  public async getProjectionRun(
    accountId: string,
    runId: string
  ): Promise<KnowledgeProjectionRun | null> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.getProjectionRun(
        accountId,
        runId
      );
    }
    return postgresCompanyKnowledgeRepository.getProjectionRun(
      accountId,
      runId
    );
  }

  public async requireProjectionRun(
    accountId: string,
    runId: string
  ): Promise<KnowledgeProjectionRun> {
    const run = await this.getProjectionRun(accountId, runId);
    if (!run) {
      throw new CompanyKnowledgeAccessError(
        'PROJECTION_RUN_NOT_FOUND',
        'Knowledge projection run not found in the current account scope.'
      );
    }
    return run;
  }

  public async listProjectionRuns(params: {
    accountId: string;
    sourceType?: 'DATASET' | 'DOCUMENT';
    sourceId?: string;
    limit?: number;
  }): Promise<KnowledgeProjectionRun[]> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.listProjectionRuns(
        params
      );
    }
    return postgresCompanyKnowledgeRepository.listProjectionRuns(
      params
    );
  }

  public async snapshotCounts(
    accountId: string
  ): Promise<KnowledgeSnapshotCounts> {
    if (!this.usesPostgres()) {
      return companyKnowledgeStore.snapshotCounts(accountId);
    }
    return postgresCompanyKnowledgeRepository.snapshotCounts(
      accountId
    );
  }
}

export const companyKnowledgePersistence =
  new CompanyKnowledgePersistence();
