import { companyKnowledgePersistence } from './companyKnowledgePersistence.js';
import { KnowledgeChangeError } from './companyKnowledgeChangeService.js';
import {
  KnowledgeChangeReport,
  KnowledgeChangesSince,
  KnowledgeClaim,
  KnowledgeClaimValue,
} from './types.js';

function setDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return Array.from(new Set(left)).filter((value) => !rightSet.has(value));
}

function valueKey(value: KnowledgeClaimValue): string {
  return JSON.stringify(value);
}

function uniqueValues(claims: KnowledgeClaim[]): KnowledgeClaimValue[] {
  return Array.from(
    new Map(
      claims.map((claim) => [valueKey(claim.value), claim.value])
    ).values()
  );
}

function claimGroups(claims: KnowledgeClaim[]): Map<string, KnowledgeClaim[]> {
  const groups = new Map<string, KnowledgeClaim[]>();

  for (const claim of claims) {
    const key = claim.subjectEntityId + '|' + claim.predicate;
    const group = groups.get(key) || [];
    group.push(claim);
    groups.set(key, group);
  }

  return groups;
}

function sameValueSet(
  left: KnowledgeClaimValue[],
  right: KnowledgeClaimValue[]
): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(valueKey));
  return left.every((value) => rightKeys.has(valueKey(value)));
}

export class CompanyKnowledgeChangeRuntimeService {
  public async compareProjectionRuns(params: {
    accountId: string;
    fromRunId: string;
    toRunId: string;
  }): Promise<KnowledgeChangeReport> {
    const fromRun = await companyKnowledgePersistence.requireProjectionRun(
      params.accountId,
      params.fromRunId
    );
    const toRun = await companyKnowledgePersistence.requireProjectionRun(
      params.accountId,
      params.toRunId
    );

    if (
      fromRun.sourceType !== toRun.sourceType ||
      fromRun.sourceId !== toRun.sourceId
    ) {
      throw new KnowledgeChangeError(
        'INCOMPATIBLE_PROJECTION_RUNS',
        'What changed? comparisons require projection runs from the same source scope.'
      );
    }

    if (
      fromRun.completedAt === undefined ||
      toRun.completedAt === undefined ||
      fromRun.status !== 'COMPLETED' ||
      toRun.status !== 'COMPLETED'
    ) {
      throw new KnowledgeChangeError(
        'INVALID_CHANGE_WINDOW',
        'Both projection runs must be completed before they can be compared.'
      );
    }

    const fromClaims = (
      await Promise.all(
        fromRun.claimIds.map((id) =>
          companyKnowledgePersistence.getClaim(
            params.accountId,
            id
          )
        )
      )
    ).filter(
      (claim): claim is KnowledgeClaim => Boolean(claim)
    );
    const toClaims = (
      await Promise.all(
        toRun.claimIds.map((id) =>
          companyKnowledgePersistence.getClaim(
            params.accountId,
            id
          )
        )
      )
    ).filter(
      (claim): claim is KnowledgeClaim => Boolean(claim)
    );

    const fromGroups = claimGroups(fromClaims);
    const toGroups = claimGroups(toClaims);
    const claimKeys = new Set([
      ...Array.from(fromGroups.keys()),
      ...Array.from(toGroups.keys()),
    ]);

    const claimChanges: KnowledgeChangeReport['claimChanges'] = [];

    for (const key of claimKeys) {
      const previous = fromGroups.get(key) || [];
      const current = toGroups.get(key) || [];
      const previousValues = uniqueValues(previous);
      const currentValues = uniqueValues(current);

      if (
        previous.length > 0 &&
        current.length > 0 &&
        sameValueSet(previousValues, currentValues)
      ) {
        continue;
      }

      const sample = current[0] || previous[0];
      if (!sample) continue;

      claimChanges.push({
        subjectEntityId: sample.subjectEntityId,
        predicate: sample.predicate,
        changeType:
          previous.length === 0
            ? 'ADDED'
            : current.length === 0
              ? 'REMOVED'
              : 'CHANGED',
        previousClaimIds: previous.map((claim) => claim.id),
        currentClaimIds: current.map((claim) => claim.id),
        previousValues,
        currentValues,
      });
    }

    return {
      accountId: params.accountId,
      sourceType: fromRun.sourceType,
      sourceId: fromRun.sourceId,
      fromRunId: fromRun.id,
      toRunId: toRun.id,
      fromSourceVersionId: fromRun.sourceVersionId,
      toSourceVersionId: toRun.sourceVersionId,
      fromSourceVersionLabel: fromRun.sourceVersionLabel,
      toSourceVersionLabel: toRun.sourceVersionLabel,
      addedEntityIds: setDifference(toRun.entityIds, fromRun.entityIds),
      removedEntityIds: setDifference(fromRun.entityIds, toRun.entityIds),
      addedRelationshipIds: setDifference(
        toRun.relationshipIds,
        fromRun.relationshipIds
      ),
      removedRelationshipIds: setDifference(
        fromRun.relationshipIds,
        toRun.relationshipIds
      ),
      claimChanges: claimChanges.sort(
        (left, right) =>
          left.subjectEntityId.localeCompare(right.subjectEntityId) ||
          left.predicate.localeCompare(right.predicate)
      ),
      newEventIds: setDifference(toRun.eventIds, fromRun.eventIds),
      generatedAt: Date.now(),
    };
  }

  public async changesSince(params: {
    accountId: string;
    since: number;
  }): Promise<KnowledgeChangesSince> {
    if (!Number.isFinite(params.since) || params.since < 0) {
      throw new KnowledgeChangeError(
        'INVALID_CHANGE_WINDOW',
        'since must be a valid timestamp.'
      );
    }

    const runs = (
      await companyKnowledgePersistence.listProjectionRuns({
        accountId: params.accountId,
        limit: 500,
      })
    ).filter(
        (run) =>
          run.startedAt >= params.since ||
          (run.completedAt !== undefined && run.completedAt >= params.since)
      );

    const events = await companyKnowledgePersistence.listEvents({
      accountId: params.accountId,
      since: params.since,
      limit: 1000,
    });

    const claims = (
      await companyKnowledgePersistence.listClaims({
        accountId: params.accountId,
        currentOnly: false,
        limit: 1000,
      })
    ).filter(
      (claim) => claim.observedAt >= params.since
    );

    const entities = (
      await companyKnowledgePersistence.listEntities({
        accountId: params.accountId,
        limit: 500,
      })
    ).filter(
      (entity) => entity.lastObservedAt >= params.since
    );

    return {
      accountId: params.accountId,
      since: params.since,
      projectionRunIds: runs.map((run) => run.id),
      eventIds: events.map((event) => event.id),
      claimIds: claims.map((claim) => claim.id),
      entityIdsObserved: entities.map((entity) => entity.id),
    };
  }
}

export const companyKnowledgeChangeRuntimeService =
  new CompanyKnowledgeChangeRuntimeService();
