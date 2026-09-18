import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
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

const DATA_DIR = path.join(process.cwd(), 'data');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'company-knowledge.json');

type PersistedCompanyKnowledgeState = {
  entities: CompanyEntity[];
  relationships: CompanyRelationship[];
  claims: KnowledgeClaim[];
  events: BusinessEvent[];
  projectionRuns: KnowledgeProjectionRun[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeEntityName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return 'DATE';
  return 'TEXT';
}

export class CompanyKnowledgeAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code:
    | 'ENTITY_NOT_FOUND'
    | 'RELATIONSHIP_NOT_FOUND'
    | 'CLAIM_NOT_FOUND'
    | 'EVENT_NOT_FOUND'
    | 'PROJECTION_RUN_NOT_FOUND';

  constructor(
    code:
      | 'ENTITY_NOT_FOUND'
      | 'RELATIONSHIP_NOT_FOUND'
      | 'CLAIM_NOT_FOUND'
      | 'EVENT_NOT_FOUND'
      | 'PROJECTION_RUN_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'CompanyKnowledgeAccessError';
    this.code = code;
  }
}

export class CompanyKnowledgeStore {
  private entities = new Map<string, CompanyEntity>();
  private relationships = new Map<string, CompanyRelationship>();
  private claims = new Map<string, KnowledgeClaim>();
  private events = new Map<string, BusinessEvent>();
  private projectionRuns = new Map<string, KnowledgeProjectionRun>();
  private batchDepth = 0;
  private dirty = false;

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(KNOWLEDGE_FILE)) return;

      const parsed = JSON.parse(
        fs.readFileSync(KNOWLEDGE_FILE, 'utf8')
      ) as Partial<PersistedCompanyKnowledgeState>;

      for (const entity of parsed.entities || []) {
        this.entities.set(entity.id, entity);
      }
      for (const relationship of parsed.relationships || []) {
        this.relationships.set(relationship.id, relationship);
      }
      for (const claim of parsed.claims || []) {
        this.claims.set(claim.id, claim);
      }
      for (const event of parsed.events || []) {
        this.events.set(event.id, event);
      }
      for (const run of parsed.projectionRuns || []) {
        this.projectionRuns.set(run.id, run);
      }
    } catch (error) {
      console.warn(
        'Could not load company-knowledge runtime state; starting empty:',
        error
      );
    }
  }

  private save(): void {
    if (this.batchDepth > 0) {
      this.dirty = true;
      return;
    }

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const state: PersistedCompanyKnowledgeState = {
      entities: Array.from(this.entities.values()),
      relationships: Array.from(this.relationships.values()),
      claims: Array.from(this.claims.values()).slice(-50000),
      events: Array.from(this.events.values()).slice(-50000),
      projectionRuns: Array.from(this.projectionRuns.values()).slice(-2000),
    };

    const temporary = KNOWLEDGE_FILE + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(temporary, KNOWLEDGE_FILE);
    this.dirty = false;
  }

  public withBatch<T>(operation: () => T): T {
    this.batchDepth += 1;
    try {
      return operation();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.dirty) {
        this.save();
      }
    }
  }

  public saveProjectionRun(
    run: KnowledgeProjectionRun
  ): KnowledgeProjectionRun {
    this.projectionRuns.set(run.id, clone(run));
    this.save();
    return clone(run);
  }

  public upsertEntity(params: {
    accountId: string;
    type: CompanyEntityType;
    canonicalName: string;
    identityKey?: string;
    aliases?: string[];
    sourceRef: KnowledgeSourceRef;
    observedAt: number;
  }): CompanyEntity {
    const normalizedName = normalizeEntityName(params.canonicalName);
    const identityKey = normalizeEntityName(
      params.identityKey || params.canonicalName
    );
    if (!normalizedName || !identityKey) {
      throw new Error('Entity name and identity key cannot be empty.');
    }

    const id =
      'ent_' +
      shortHash([params.accountId, params.type, identityKey]);
    const existing = this.entities.get(id);

    if (existing && existing.accountId === params.accountId) {
      const aliases = new Set(existing.aliases);
      aliases.add(existing.canonicalName);
      aliases.add(params.canonicalName);
      for (const alias of params.aliases || []) {
        if (alias.trim()) aliases.add(alias.trim());
      }

      const shouldImproveDisplayName =
        normalizeEntityName(existing.canonicalName) === existing.identityKey &&
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
          (alias) => normalizeEntityName(alias) !== normalizedName
        ),
        sourceRefs: mergeSourceRefs(existing.sourceRefs, [params.sourceRef]),
        updatedAt: Date.now(),
        lastObservedAt: Math.max(existing.lastObservedAt, params.observedAt),
      };
      this.entities.set(id, updated);
      this.save();
      return clone(updated);
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
        new Set((params.aliases || []).map((alias) => alias.trim()).filter(Boolean))
      ).filter((alias) => normalizeEntityName(alias) !== normalizedName),
      sourceRefs: [clone(params.sourceRef)],
      createdAt: now,
      updatedAt: now,
      firstObservedAt: params.observedAt,
      lastObservedAt: params.observedAt,
    };

    this.entities.set(entity.id, entity);
    this.save();
    return clone(entity);
  }

  public upsertRelationship(params: {
    accountId: string;
    subjectEntityId: string;
    predicate: string;
    objectEntityId: string;
    claimKind: KnowledgeClaimKind;
    authority: SourceAuthority;
    sourceRef: KnowledgeSourceRef;
    observedAt: number;
  }): CompanyRelationship {
    const subject = this.requireEntity(params.accountId, params.subjectEntityId);
    const object = this.requireEntity(params.accountId, params.objectEntityId);
    const predicate = params.predicate.trim().toUpperCase();
    if (!predicate) throw new Error('Relationship predicate is required.');

    const fingerprint = shortHash([
      params.accountId,
      subject.id,
      predicate,
      object.id,
      params.claimKind,
    ]);

    const existing = Array.from(this.relationships.values()).find(
      (relationship) =>
        relationship.accountId === params.accountId &&
        relationship.fingerprint === fingerprint
    );

    if (existing) {
      const sourceAlreadyPresent = existing.sourceRefs.some(
        (source) => sourceRefKey(source) === sourceRefKey(params.sourceRef)
      );
      const updated: CompanyRelationship = {
        ...existing,
        authority:
          params.authority.rank > existing.authority.rank
            ? clone(params.authority)
            : existing.authority,
        sourceRefs: mergeSourceRefs(existing.sourceRefs, [params.sourceRef]),
        lastObservedAt: Math.max(existing.lastObservedAt, params.observedAt),
        occurrenceCount:
          existing.occurrenceCount + (sourceAlreadyPresent ? 0 : 1),
        updatedAt: Date.now(),
      };
      this.relationships.set(updated.id, updated);
      this.save();
      return clone(updated);
    }

    const now = Date.now();
    const relationship: CompanyRelationship = {
      id: 'rel_' + fingerprint,
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

    this.relationships.set(relationship.id, relationship);
    this.save();
    return clone(relationship);
  }

  public recordClaim(params: {
    accountId: string;
    subjectEntityId: string;
    predicate: string;
    value: KnowledgeClaimValue;
    claimKind: KnowledgeClaimKind;
    authority: SourceAuthority;
    sourceRef: KnowledgeSourceRef;
    observedAt: number;
    validFrom?: number;
  }): KnowledgeClaim {
    const subject = this.requireEntity(params.accountId, params.subjectEntityId);
    const predicate = params.predicate.trim().toUpperCase();
    if (!predicate) throw new Error('Claim predicate is required.');

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

    const duplicate = Array.from(this.claims.values()).find(
      (claim) =>
        claim.accountId === params.accountId &&
        claim.fingerprint === fingerprint
    );
    if (duplicate) return clone(duplicate);

    let supersedesClaimId: string | undefined;

    const priorCurrent = Array.from(this.claims.values())
      .filter(
        (claim) =>
          claim.accountId === params.accountId &&
          claim.subjectEntityId === subject.id &&
          claim.predicate === predicate &&
          claim.isCurrent &&
          claim.sourceRef.sourceType === params.sourceRef.sourceType &&
          claim.sourceRef.sourceId === params.sourceRef.sourceId
      )
      .sort((a, b) => b.observedAt - a.observedAt)[0];

    if (
      priorCurrent &&
      priorCurrent.sourceRef.sourceVersionId !==
        params.sourceRef.sourceVersionId
    ) {
      const closed: KnowledgeClaim = {
        ...priorCurrent,
        isCurrent: false,
        validTo: params.observedAt,
      };
      this.claims.set(closed.id, closed);
      supersedesClaimId = closed.id;
    }

    const claim: KnowledgeClaim = {
      id: 'clm_' + fingerprint,
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
      isCurrent: true,
      supersedesClaimId,
      createdAt: Date.now(),
    };

    this.claims.set(claim.id, claim);
    this.save();
    return clone(claim);
  }

  public recordEvent(params: {
    accountId: string;
    type: string;
    subjectEntityIds: string[];
    data?: Record<string, KnowledgeClaimValue>;
    sourceRef: KnowledgeSourceRef;
    occurredAt?: number;
    recordedAt: number;
    projectionRunId?: string;
    fingerprintParts?: unknown[];
  }): BusinessEvent {
    for (const entityId of params.subjectEntityIds) {
      this.requireEntity(params.accountId, entityId);
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

    const existing = Array.from(this.events.values()).find(
      (event) =>
        event.accountId === params.accountId &&
        event.fingerprint === fingerprint
    );
    if (existing) return clone(existing);

    const event: BusinessEvent = {
      id: 'evt_' + fingerprint,
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

    this.events.set(event.id, event);
    this.save();
    return clone(event);
  }

  public listEntities(params: {
    accountId: string;
    type?: CompanyEntityType;
    search?: string;
    limit?: number;
  }): CompanyEntity[] {
    const search = normalizeEntityName(params.search || '');
    const limit = Math.max(1, Math.min(params.limit || 100, 500));

    return Array.from(this.entities.values())
      .filter(
        (entity) =>
          entity.accountId === params.accountId &&
          (!params.type || entity.type === params.type) &&
          (!search ||
            entity.normalizedName.includes(search) ||
            entity.identityKey.includes(search) ||
            entity.aliases.some((alias) =>
              normalizeEntityName(alias).includes(search)
            ))
      )
      .sort(
        (a, b) =>
          b.lastObservedAt - a.lastObservedAt ||
          a.canonicalName.localeCompare(b.canonicalName)
      )
      .slice(0, limit)
      .map(clone);
  }

  public getEntity(accountId: string, entityId: string): CompanyEntity | null {
    const entity = this.entities.get(entityId);
    if (!entity || entity.accountId !== accountId) return null;
    return clone(entity);
  }

  public requireEntity(accountId: string, entityId: string): CompanyEntity {
    const entity = this.getEntity(accountId, entityId);
    if (!entity) {
      throw new CompanyKnowledgeAccessError(
        'ENTITY_NOT_FOUND',
        'Entity not found in the current account scope.'
      );
    }
    return entity;
  }

  public listRelationships(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    limit?: number;
  }): CompanyRelationship[] {
    if (params.entityId) {
      this.requireEntity(params.accountId, params.entityId);
    }

    const predicate = params.predicate?.trim().toUpperCase();
    const limit = Math.max(1, Math.min(params.limit || 100, 500));

    return Array.from(this.relationships.values())
      .filter(
        (relationship) =>
          relationship.accountId === params.accountId &&
          (!params.entityId ||
            relationship.subjectEntityId === params.entityId ||
            relationship.objectEntityId === params.entityId) &&
          (!predicate || relationship.predicate === predicate)
      )
      .sort((a, b) => b.lastObservedAt - a.lastObservedAt)
      .slice(0, limit)
      .map(clone);
  }

  public listClaims(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    currentOnly?: boolean;
    limit?: number;
  }): KnowledgeClaim[] {
    if (params.entityId) {
      this.requireEntity(params.accountId, params.entityId);
    }

    const predicate = params.predicate?.trim().toUpperCase();
    const limit = Math.max(1, Math.min(params.limit || 200, 1000));

    return Array.from(this.claims.values())
      .filter(
        (claim) =>
          claim.accountId === params.accountId &&
          (!params.entityId || claim.subjectEntityId === params.entityId) &&
          (!predicate || claim.predicate === predicate) &&
          (params.currentOnly === false || claim.isCurrent)
      )
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, limit)
      .map(clone);
  }

  public listEvents(params: {
    accountId: string;
    entityId?: string;
    type?: string;
    since?: number;
    limit?: number;
  }): BusinessEvent[] {
    if (params.entityId) {
      this.requireEntity(params.accountId, params.entityId);
    }

    const type = params.type?.trim().toUpperCase();
    const limit = Math.max(1, Math.min(params.limit || 200, 1000));

    return Array.from(this.events.values())
      .filter(
        (event) =>
          event.accountId === params.accountId &&
          (!params.entityId || event.subjectEntityIds.includes(params.entityId)) &&
          (!type || event.type === type) &&
          (params.since === undefined ||
            Math.max(event.occurredAt || 0, event.recordedAt) >= params.since)
      )
      .sort(
        (a, b) =>
          (b.occurredAt || b.recordedAt) -
          (a.occurredAt || a.recordedAt)
      )
      .slice(0, limit)
      .map(clone);
  }

  public listProjectionRuns(params: {
    accountId: string;
    sourceType?: 'DATASET' | 'DOCUMENT';
    sourceId?: string;
    limit?: number;
  }): KnowledgeProjectionRun[] {
    const limit = Math.max(1, Math.min(params.limit || 100, 500));

    return Array.from(this.projectionRuns.values())
      .filter(
        (run) =>
          run.accountId === params.accountId &&
          (!params.sourceType || run.sourceType === params.sourceType) &&
          (!params.sourceId || run.sourceId === params.sourceId)
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map(clone);
  }

  public snapshotCounts(accountId: string): KnowledgeSnapshotCounts {
    return {
      entities: Array.from(this.entities.values()).filter(
        (entity) => entity.accountId === accountId
      ).length,
      relationships: Array.from(this.relationships.values()).filter(
        (relationship) => relationship.accountId === accountId
      ).length,
      currentClaims: Array.from(this.claims.values()).filter(
        (claim) => claim.accountId === accountId && claim.isCurrent
      ).length,
      events: Array.from(this.events.values()).filter(
        (event) => event.accountId === accountId
      ).length,
    };
  }
}

export const companyKnowledgeStore = new CompanyKnowledgeStore();
