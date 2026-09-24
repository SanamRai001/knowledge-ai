import crypto from 'crypto';
import {
  companyKnowledgePersistence,
} from '../companyKnowledge/companyKnowledgePersistence.js';
import { SOURCE_AUTHORITIES } from '../companyKnowledge/sourceAuthority.js';
import type {
  BusinessEvent,
  KnowledgeClaim,
  KnowledgeClaimValue,
  KnowledgeSourceRef,
} from '../companyKnowledge/types.js';
import {
  enqueueActionDiscoveryRefresh,
} from './actionDiscoveryWorker.js';
import {
  PostgresActionTransactionError,
  postgresActionRepository,
  postgresConfirmedActionTransactionRepository,
} from '../persistence/a3PostgresRepositories.js';
import type {
  ConfirmedActionTransactionInput,
} from '../persistence/a3Types.js';
import { actionPersistence } from './actionPersistence.js';
import {
  ActionExecutionError,
  actionExecutionService,
} from './actionExecutionService.js';
import type {
  ActionAuditEntry,
  ActionExecution,
  ActionExecutionMode,
  ActionProposal,
} from './types.js';

function shortHash(parts: unknown[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 20);
}

function id(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(10).toString('hex');
}

function valueType(
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

type AuthorizationContext = {
  mode: ActionExecutionMode;
  actor: string;
  actorRole?: string;
  automationPolicyId?: string;
  automationPolicyVersion?: number;
};

function sourceRefFor(
  proposal: ActionProposal,
  authorization: AuthorizationContext
): KnowledgeSourceRef {
  return {
    sourceType: 'USER',
    sourceId: 'confirmed-company-state',
    sourceVersionId: proposal.id,
    sourceVersionLabel: 'action ' + proposal.id,
    sourceName:
      authorization.mode === 'AUTOMATION_POLICY'
        ? 'Policy-authorized business action'
        : authorization.mode ===
            'AUTOMATION_COMPENSATION'
          ? 'Automation compensating action'
          : 'Confirmed business action',
    excerpt: proposal.instruction,
  };
}

function claimFor(params: {
  proposal: ActionProposal;
  mutation: ActionProposal['mutations'][number];
  accountId: string;
  now: number;
  sourceRef: KnowledgeSourceRef;
  supersedesClaimId?: string;
}): KnowledgeClaim {
  const fingerprint = shortHash([
    params.accountId,
    params.mutation.entityId,
    params.mutation.predicate,
    params.mutation.afterValue,
    'FACT',
    params.sourceRef.sourceType,
    params.sourceRef.sourceId,
    params.sourceRef.sourceVersionId || null,
    params.sourceRef.tableId || null,
    params.sourceRef.rowIndex ?? null,
    params.sourceRef.documentId || null,
    params.sourceRef.pageNumber ?? null,
  ]);

  return {
    id: 'clm_' + fingerprint,
    fingerprint,
    accountId: params.accountId,
    subjectEntityId: params.mutation.entityId,
    predicate: params.mutation.predicate
      .trim()
      .toUpperCase(),
    value: params.mutation.afterValue,
    valueType: valueType(
      params.mutation.afterValue
    ),
    claimKind: 'FACT',
    authority: {
      ...SOURCE_AUTHORITIES.USER_CONFIRMED,
    },
    sourceRef: structuredClone(params.sourceRef),
    observedAt: params.now,
    validFrom: params.now,
    isCurrent: true,
    supersedesClaimId: params.supersedesClaimId,
    createdAt: params.now,
  };
}

function eventFor(params: {
  proposal: ActionProposal;
  accountId: string;
  now: number;
  sourceRef: KnowledgeSourceRef;
}): BusinessEvent {
  const occurredAt =
    typeof params.proposal.eventData.occurredAt ===
    'number'
      ? params.proposal.eventData.occurredAt
      : params.now;
  const type =
    params.proposal.eventType ||
    'BUSINESS_ACTION_CONFIRMED';
  const data = {
    ...params.proposal.eventData,
    proposalId: params.proposal.id,
  };

  const fingerprint = shortHash([
    params.accountId,
    type,
    params.proposal.targetEntityIds,
    params.sourceRef.sourceType,
    params.sourceRef.sourceId,
    params.sourceRef.sourceVersionId || null,
    params.sourceRef.tableId || null,
    params.sourceRef.rowIndex ?? null,
    occurredAt || null,
    [params.proposal.id],
  ]);

  return {
    id: 'evt_' + fingerprint,
    fingerprint,
    accountId: params.accountId,
    type: type.trim().toUpperCase(),
    subjectEntityIds: [
      ...params.proposal.targetEntityIds,
    ],
    data,
    sourceRef: structuredClone(params.sourceRef),
    occurredAt,
    recordedAt: params.now,
  };
}

export async function preparePostgresConfirmedAction(params: {
  accountId: string;
  proposalId: string;
  now?: number;
  authorization?: {
    mode: ActionExecutionMode;
    actor: string;
    actorRole?: string;
    automationPolicyId?: string;
    automationPolicyVersion?: number;
  };
}): Promise<{
  proposal: ActionProposal;
  input: ConfirmedActionTransactionInput;
}> {
  const proposal =
    await actionPersistence.requireProposal(
      params.accountId,
      params.proposalId
    );
  const now = params.now ?? Date.now();
  const authorization: AuthorizationContext =
    params.authorization || {
      mode: 'MANUAL_CONFIRMATION',
      actor: 'user:explicit-confirmation',
    };

  if (proposal.status !== 'PROPOSED') {
    throw new ActionExecutionError(
      'ACTION_NOT_CONFIRMABLE',
      409,
      `Action proposal is ${proposal.status} and cannot be confirmed.`
    );
  }

  if (proposal.expiresAt <= now) {
    await actionPersistence.transitionProposal({
      accountId: params.accountId,
      proposalId: proposal.id,
      status: 'STALE',
      detail: 'Proposal expired before confirmation.',
    });
    throw new ActionExecutionError(
      'ACTION_EXPIRED',
      409,
      `Action proposal expired at ${new Date(
        proposal.expiresAt
      ).toISOString()}.`
    );
  }

  for (const mutation of proposal.mutations) {
    const entity =
      await companyKnowledgePersistence.requireEntity(
        params.accountId,
        mutation.entityId
      );
    if (entity.type !== mutation.entityType) {
      throw new ActionExecutionError(
        'ACTION_MUTATION_INVALID',
        422,
        'Action target entity type no longer matches the validated proposal.'
      );
    }
    if (mutation.operation !== 'SET') {
      throw new ActionExecutionError(
        'ACTION_MUTATION_INVALID',
        422,
        'Unsupported mutation operation.'
      );
    }
  }

  const sourceRef = sourceRefFor(
    proposal,
    authorization
  );
  const claimsToClose: Array<{
    claimId: string;
    validTo: number;
  }> = [];
  const claimsToInsert: KnowledgeClaim[] = [];

  for (const mutation of proposal.mutations) {
    const currentClaims =
      await companyKnowledgePersistence.listClaims({
        accountId: params.accountId,
        entityId: mutation.entityId,
        predicate: mutation.predicate,
        currentOnly: true,
        limit: 500,
      });

    const priorConfirmed = currentClaims
      .filter(
        (claim) =>
          claim.sourceRef.sourceType === 'USER' &&
          claim.sourceRef.sourceId ===
            'confirmed-company-state'
      )
      .sort(
        (left, right) =>
          right.observedAt - left.observedAt ||
          right.createdAt - left.createdAt
      )[0];

    if (
      priorConfirmed &&
      priorConfirmed.sourceRef.sourceVersionId !==
        proposal.id
    ) {
      claimsToClose.push({
        claimId: priorConfirmed.id,
        validTo: now,
      });
    }

    claimsToInsert.push(
      claimFor({
        proposal,
        mutation,
        accountId: params.accountId,
        now,
        sourceRef,
        supersedesClaimId:
          priorConfirmed?.sourceRef
            .sourceVersionId !== proposal.id
            ? priorConfirmed?.id
            : undefined,
      })
    );
  }

  const event = eventFor({
    proposal,
    accountId: params.accountId,
    now,
    sourceRef,
  });

  const execution: ActionExecution = {
    id: id('exe'),
    accountId: params.accountId,
    proposalId: proposal.id,
    intent: proposal.intent,
    executionMode: authorization.mode,
    authorizedBy: authorization.actor,
    authorizedByRole: authorization.actorRole,
    automationPolicyId:
      authorization.automationPolicyId,
    automationPolicyVersion:
      authorization.automationPolicyVersion,
    claimIds: claimsToInsert.map(
      (claim) => claim.id
    ),
    eventIds: [event.id],
    downstreamAnalysisRunIds: [],
    downstreamWarnings: [],
    executedAt: now,
  };

  const audit: ActionAuditEntry = {
    id: id('aud'),
    accountId: params.accountId,
    proposalId: proposal.id,
    action: 'CONFIRMED',
    timestamp: now,
    detail:
      (authorization.mode === 'AUTOMATION_POLICY'
        ? 'Automation policy authorized this proposal without a manual confirm click. '
        : authorization.mode ===
            'AUTOMATION_COMPENSATION'
          ? 'An authorized operator executed a compensating automation action. '
          : 'User explicitly confirmed the proposal. ') +
      'Authorization actor: ' +
      authorization.actor +
      (authorization.automationPolicyVersion
        ? '; policy version: ' +
          String(
            authorization.automationPolicyVersion
          )
        : '') +
      '. USER_CONFIRMED company-state claims and audit event were committed transactionally.',
    executionId: execution.id,
  };

  return {
    proposal,
    input: {
      accountId: params.accountId,
      proposalId: proposal.id,
      expectedProposalStatus: 'PROPOSED',
      claimsToClose,
      claimsToInsert,
      eventToInsert: event,
      execution,
      auditEntry: audit,
      confirmedAt: now,
    },
  };
}

export class ActionRuntimeExecutionService {
  public async confirm(params: {
    accountId: string;
    proposalId: string;
    now?: number;
    authorization?: {
      mode: ActionExecutionMode;
      actor: string;
      actorRole?: string;
      automationPolicyId?: string;
      automationPolicyVersion?: number;
    };
  }): Promise<{
    proposal: ActionProposal;
    execution: ActionExecution;
  }> {
    if (!actionPersistence.usesPostgres()) {
      return actionExecutionService.confirm(params);
    }

    const existingExecution =
      await actionPersistence.getExecutionByProposal(
        params.accountId,
        params.proposalId
      );
    if (existingExecution) {
      const proposal =
        await actionPersistence.requireProposal(
          params.accountId,
          params.proposalId
        );

      return {
        proposal,
        execution:
          await this.finalizeCommittedPostgresAction({
            accountId:
              params.accountId,
            proposal,
            execution:
              existingExecution,
            idempotentReplay: true,
          }),
      };
    }

    const prepared =
      await preparePostgresConfirmedAction(
        params
      );
    const proposal = prepared.proposal;

    let committed;
    try {
      committed =
        await postgresConfirmedActionTransactionRepository.commitConfirmedAction(
          prepared.input
        );
    } catch (error) {
      if (
        error instanceof
          PostgresActionTransactionError &&
        error.code === 'ACTION_STALE'
      ) {
        await actionPersistence.transitionProposal({
          accountId: params.accountId,
          proposalId: proposal.id,
          status: 'STALE',
          detail:
            'Effective state changed after the proposal was created. The relational confirmation transaction was rolled back and a fresh proposal is required.',
        });
        throw new ActionExecutionError(
          'ACTION_STALE',
          409,
          'Current company state changed after this proposal was created. Review a fresh proposal before writing.'
        );
      }

      if (
        error instanceof
        PostgresActionTransactionError
      ) {
        if (error.code === 'ACTION_NOT_CONFIRMABLE') {
          throw new ActionExecutionError(
            'ACTION_NOT_CONFIRMABLE',
            error.statusCode,
            error.message
          );
        }
      }
      throw error;
    }

    return {
      proposal: committed.proposal,
      execution:
        await this.finalizeCommittedPostgresAction({
          accountId:
            params.accountId,
          proposal:
            committed.proposal,
          execution:
            committed.execution,
          idempotentReplay:
            committed.idempotentReplay,
        }),
    };
  }

  public async finalizeCommittedPostgresAction(params: {
    accountId: string;
    proposal: ActionProposal;
    execution: ActionExecution;
    idempotentReplay?: boolean;
  }): Promise<ActionExecution> {
    const datasetIds =
      await this.collectDownstreamDatasetIds({
        accountId: params.accountId,
        proposal: params.proposal,
      });

    for (const datasetId of datasetIds) {
      try {
        await enqueueActionDiscoveryRefresh({
          accountId:
            params.accountId,
          executionId:
            params.execution.id,
          proposalId:
            params.proposal.id,
          datasetId,
          referenceTime:
            params.execution.executedAt,
        });
      } catch (error: any) {
        await postgresActionRepository
          .appendExecutionWarning({
            accountId:
              params.accountId,
            executionId:
              params.execution.id,
            warning:
              'Discovery refresh enqueue failed for dataset ' +
              datasetId +
              ': ' +
              (error?.message ||
                'unknown error'),
          })
          .catch(() => undefined);
      }
    }

    return (
      (await postgresActionRepository
        .getExecution(
          params.accountId,
          params.execution.id
        )) ||
      params.execution
    );
  }

  public async cancel(params: {
    accountId: string;
    proposalId: string;
  }): Promise<ActionProposal> {
    if (!actionPersistence.usesPostgres()) {
      return actionExecutionService.cancel(params);
    }

    const proposal =
      await actionPersistence.requireProposal(
        params.accountId,
        params.proposalId
      );

    if (proposal.status === 'CONFIRMED') {
      throw new ActionExecutionError(
        'ACTION_NOT_CONFIRMABLE',
        409,
        'A confirmed action cannot be cancelled. A compensating action is required.'
      );
    }
    if (proposal.status === 'CANCELLED') {
      return proposal;
    }

    return actionPersistence.transitionProposal({
      accountId: params.accountId,
      proposalId: proposal.id,
      status: 'CANCELLED',
      detail:
        'User cancelled the proposed change before execution.',
    });
  }

  private async collectDownstreamDatasetIds(params: {
    accountId: string;
    proposal: ActionProposal;
  }): Promise<string[]> {
    const datasetIds =
      new Set<string>();

    for (
      const entityId of
      params.proposal.targetEntityIds
    ) {
      const entity =
        await companyKnowledgePersistence
          .getEntity(
            params.accountId,
            entityId
          );
      for (
        const source of
        entity?.sourceRefs || []
      ) {
        if (
          source.sourceType ===
          'DATASET'
        ) {
          datasetIds.add(
            source.sourceId
          );
        }
      }
    }

    for (
      const precondition of
      params.proposal.preconditions
    ) {
      if (
        !precondition.effectiveClaimId
      ) {
        continue;
      }

      const claim =
        await companyKnowledgePersistence
          .getClaim(
            params.accountId,
            precondition.effectiveClaimId
          );

      if (
        claim?.sourceRef.sourceType ===
        'DATASET'
      ) {
        datasetIds.add(
          claim.sourceRef.sourceId
        );
      }
    }

    return Array.from(
      datasetIds
    ).sort();
  }
}

export const actionRuntimeExecutionService =
  new ActionRuntimeExecutionService();
