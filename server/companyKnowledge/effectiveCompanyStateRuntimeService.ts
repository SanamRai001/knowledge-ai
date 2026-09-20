import type {
  KnowledgeClaim,
  KnowledgeClaimValue,
} from './types.js';
import {
  EffectiveStateError,
  type EffectiveKnowledgeResolution,
  effectiveCompanyStateService,
} from './effectiveCompanyStateService.js';
import { companyKnowledgePersistence } from './companyKnowledgePersistence.js';

function valueKey(value: KnowledgeClaimValue): string {
  return JSON.stringify(value);
}

export class EffectiveCompanyStateRuntimeService {
  public async resolve(
    accountId: string,
    entityId: string,
    predicate: string
  ): Promise<EffectiveKnowledgeResolution> {
    if (!companyKnowledgePersistence.usesPostgres()) {
      return effectiveCompanyStateService.resolve(
        accountId,
        entityId,
        predicate
      );
    }

    await companyKnowledgePersistence.requireEntity(
      accountId,
      entityId
    );

    const normalizedPredicate = predicate
      .trim()
      .toUpperCase();
    const claims = await companyKnowledgePersistence.listClaims({
      accountId,
      entityId,
      predicate: normalizedPredicate,
      currentOnly: true,
      limit: 200,
    });

    if (claims.length === 0) {
      return {
        status: 'MISSING',
        entityId,
        predicate: normalizedPredicate,
        currentClaims: [],
      };
    }

    const highestAuthorityRank = Math.max(
      ...claims.map((claim) => claim.authority.rank)
    );
    const highest = claims.filter(
      (claim) =>
        claim.authority.rank === highestAuthorityRank
    );

    const valueGroups = new Map<
      string,
      KnowledgeClaim[]
    >();
    for (const claim of highest) {
      const key = valueKey(claim.value);
      const group = valueGroups.get(key) || [];
      group.push(claim);
      valueGroups.set(key, group);
    }

    if (valueGroups.size !== 1) {
      return {
        status: 'CONFLICT',
        entityId,
        predicate: normalizedPredicate,
        currentClaims: claims,
        highestAuthorityRank,
        highestAuthorityClaims: highest,
      };
    }

    const equivalent =
      Array.from(valueGroups.values())[0];
    const effectiveClaim = [...equivalent].sort(
      (left, right) =>
        right.observedAt - left.observedAt ||
        right.createdAt - left.createdAt
    )[0];

    return {
      status: 'RESOLVED',
      entityId,
      predicate: normalizedPredicate,
      value: effectiveClaim.value,
      effectiveClaim,
      equivalentClaimIds: equivalent.map(
        (claim) => claim.id
      ),
      currentClaims: claims,
    };
  }

  public async requireNumber(
    accountId: string,
    entityId: string,
    predicate: string
  ): Promise<{ value: number; claim: KnowledgeClaim }> {
    const resolution = await this.resolve(
      accountId,
      entityId,
      predicate
    );

    if (resolution.status === 'MISSING') {
      throw new EffectiveStateError(
        'STATE_MISSING',
        `No current ${predicate} value is available for the target entity.`
      );
    }
    if (resolution.status === 'CONFLICT') {
      throw new EffectiveStateError(
        'STATE_CONFLICT',
        `Current ${predicate} has conflicting values at the same highest authority.`
      );
    }
    if (typeof resolution.value !== 'number') {
      throw new EffectiveStateError(
        'STATE_TYPE_MISMATCH',
        `Current ${predicate} is not numeric.`
      );
    }

    return {
      value: resolution.value,
      claim: resolution.effectiveClaim,
    };
  }
}

export const effectiveCompanyStateRuntimeService =
  new EffectiveCompanyStateRuntimeService();
