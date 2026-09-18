import crypto from 'crypto';
import { companyKnowledgeStore } from './companyKnowledgeStore.js';
import {
  KnowledgeClaim,
  KnowledgeClaimValue,
  KnowledgeConflict,
} from './types.js';

function valueKey(value: KnowledgeClaimValue): string {
  return JSON.stringify(value);
}

function conflictId(
  accountId: string,
  subjectEntityId: string,
  predicate: string
): string {
  return (
    'cnf_' +
    crypto
      .createHash('sha256')
      .update(JSON.stringify([accountId, subjectEntityId, predicate]))
      .digest('hex')
      .slice(0, 20)
  );
}

export class KnowledgeConflictService {
  public listConflicts(params: {
    accountId: string;
    entityId?: string;
    limit?: number;
  }): KnowledgeConflict[] {
    if (params.entityId) {
      companyKnowledgeStore.requireEntity(params.accountId, params.entityId);
    }

    const claims = companyKnowledgeStore.listClaims({
      accountId: params.accountId,
      entityId: params.entityId,
      currentOnly: true,
      limit: 1000,
    });

    const groups = new Map<string, KnowledgeClaim[]>();

    for (const claim of claims) {
      const key = claim.subjectEntityId + '|' + claim.predicate;
      const group = groups.get(key) || [];
      group.push(claim);
      groups.set(key, group);
    }

    const conflicts: KnowledgeConflict[] = [];

    for (const group of groups.values()) {
      if (group.length < 2) continue;

      const distinctValues = Array.from(
        new Map(
          group.map((claim) => [valueKey(claim.value), claim.value])
        ).values()
      );
      if (distinctValues.length < 2) continue;

      const highestAuthorityRank = Math.max(
        ...group.map((claim) => claim.authority.rank)
      );
      const highest = group.filter(
        (claim) => claim.authority.rank === highestAuthorityRank
      );

      const highestDistinctValues = new Set(
        highest.map((claim) => valueKey(claim.value))
      );

      const preferredClaimId =
        highest.length >= 1 && highestDistinctValues.size === 1
          ? highest[0].id
          : undefined;

      conflicts.push({
        id: conflictId(
          params.accountId,
          group[0].subjectEntityId,
          group[0].predicate
        ),
        accountId: params.accountId,
        subjectEntityId: group[0].subjectEntityId,
        predicate: group[0].predicate,
        claimIds: group.map((claim) => claim.id),
        distinctValues,
        highestAuthorityRank,
        preferredClaimId,
        resolution: preferredClaimId
          ? 'HIGHER_AUTHORITY_AVAILABLE'
          : 'AUTHORITY_TIE',
      });
    }

    return conflicts
      .sort(
        (left, right) =>
          right.highestAuthorityRank - left.highestAuthorityRank ||
          left.predicate.localeCompare(right.predicate)
      )
      .slice(0, Math.max(1, Math.min(params.limit || 100, 500)));
  }
}

export const knowledgeConflictService = new KnowledgeConflictService();
