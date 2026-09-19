import fs from 'fs';
import path from 'path';
import type {
  BusinessEvent,
  CompanyEntity,
  CompanyRelationship,
  KnowledgeClaim,
  KnowledgeProjectionRun,
} from '../companyKnowledge/types.js';
import type {
  ActionAuditEntry,
  ActionExecution,
  ActionProposal,
} from '../actions/types.js';
import {
  postgresActionRepository,
  postgresCompanyKnowledgeRepository,
} from './a3PostgresRepositories.js';
import { postgresPool } from './postgres.js';

type LegacyKnowledgeState = {
  entities?: CompanyEntity[];
  relationships?: CompanyRelationship[];
  claims?: KnowledgeClaim[];
  events?: BusinessEvent[];
  projectionRuns?: KnowledgeProjectionRun[];
};

type LegacyActionState = {
  proposals?: ActionProposal[];
  executions?: ActionExecution[];
  auditEntries?: ActionAuditEntry[];
};

export interface LegacyA3Snapshot {
  dataDir: string;
  entities: CompanyEntity[];
  relationships: CompanyRelationship[];
  claims: KnowledgeClaim[];
  events: BusinessEvent[];
  projectionRuns: KnowledgeProjectionRun[];
  proposals: ActionProposal[];
  executions: ActionExecution[];
  auditEntries: ActionAuditEntry[];
}

export interface LegacyA3Conflict {
  kind:
    | 'ACCOUNT'
    | 'ENTITY'
    | 'RELATIONSHIP'
    | 'CLAIM'
    | 'EVENT'
    | 'PROJECTION_RUN'
    | 'ACTION_PROPOSAL'
    | 'ACTION_EXECUTION'
    | 'ACTION_AUDIT';
  id: string;
  message: string;
}

export interface LegacyA3ImportReport {
  dryRun: boolean;
  sourceDataDir: string;
  counts: Record<
    | 'entities'
    | 'relationships'
    | 'claims'
    | 'events'
    | 'projectionRuns'
    | 'proposals'
    | 'executions'
    | 'auditEntries',
    number
  >;
  imported: Record<
    | 'entities'
    | 'relationships'
    | 'claims'
    | 'events'
    | 'projectionRuns'
    | 'proposals'
    | 'executions'
    | 'auditEntries',
    number
  >;
  skippedExisting: number;
  conflicts: LegacyA3Conflict[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function comparable(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    nested === undefined ? null : nested
  );
}

function sameEntity(
  left: CompanyEntity,
  right: CompanyEntity
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.type === right.type &&
    left.identityKey === right.identityKey &&
    left.canonicalName === right.canonicalName
  );
}

function sameRelationship(
  left: CompanyRelationship,
  right: CompanyRelationship
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.fingerprint === right.fingerprint &&
    left.subjectEntityId === right.subjectEntityId &&
    left.objectEntityId === right.objectEntityId &&
    left.predicate === right.predicate
  );
}

function sameClaim(
  left: KnowledgeClaim,
  right: KnowledgeClaim
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.fingerprint === right.fingerprint &&
    left.subjectEntityId === right.subjectEntityId &&
    left.predicate === right.predicate &&
    comparable(left.value) === comparable(right.value) &&
    left.isCurrent === right.isCurrent &&
    (left.supersedesClaimId || null) ===
      (right.supersedesClaimId || null)
  );
}

function sameEvent(
  left: BusinessEvent,
  right: BusinessEvent
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.fingerprint === right.fingerprint &&
    left.type === right.type &&
    comparable(left.subjectEntityIds) ===
      comparable(right.subjectEntityIds) &&
    comparable(left.data) === comparable(right.data)
  );
}

function sameProjectionRun(
  left: KnowledgeProjectionRun,
  right: KnowledgeProjectionRun
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.sourceType === right.sourceType &&
    left.sourceId === right.sourceId &&
    left.status === right.status
  );
}

function sameProposal(
  left: ActionProposal,
  right: ActionProposal
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.instruction === right.instruction &&
    left.intent === right.intent &&
    left.status === right.status &&
    comparable(left.mutations) === comparable(right.mutations) &&
    comparable(left.preconditions) ===
      comparable(right.preconditions)
  );
}

function sameExecution(
  left: ActionExecution,
  right: ActionExecution
): boolean {
  return (
    left.id === right.id &&
    left.accountId === right.accountId &&
    left.proposalId === right.proposalId &&
    left.intent === right.intent &&
    comparable(left.claimIds) === comparable(right.claimIds) &&
    comparable(left.eventIds) === comparable(right.eventIds) &&
    left.executedAt === right.executedAt
  );
}

export function readLegacyA3Snapshot(
  dataDir = path.join(process.cwd(), 'data')
): LegacyA3Snapshot {
  const knowledge = readJson<LegacyKnowledgeState>(
    path.join(dataDir, 'company-knowledge.json'),
    {}
  );
  const actions = readJson<LegacyActionState>(
    path.join(dataDir, 'company-actions.json'),
    {}
  );

  return {
    dataDir,
    entities: (knowledge.entities || []).map(clone),
    relationships: (knowledge.relationships || []).map(clone),
    claims: (knowledge.claims || []).map(clone),
    events: (knowledge.events || []).map(clone),
    projectionRuns: (knowledge.projectionRuns || []).map(clone),
    proposals: (actions.proposals || []).map(clone),
    executions: (actions.executions || []).map(clone),
    auditEntries: (actions.auditEntries || []).map(clone),
  };
}

function reportFor(
  snapshot: LegacyA3Snapshot,
  dryRun: boolean
): LegacyA3ImportReport {
  return {
    dryRun,
    sourceDataDir: snapshot.dataDir,
    counts: {
      entities: snapshot.entities.length,
      relationships: snapshot.relationships.length,
      claims: snapshot.claims.length,
      events: snapshot.events.length,
      projectionRuns: snapshot.projectionRuns.length,
      proposals: snapshot.proposals.length,
      executions: snapshot.executions.length,
      auditEntries: snapshot.auditEntries.length,
    },
    imported: {
      entities: 0,
      relationships: 0,
      claims: 0,
      events: 0,
      projectionRuns: 0,
      proposals: 0,
      executions: 0,
      auditEntries: 0,
    },
    skippedExisting: 0,
    conflicts: [],
  };
}

async function knownAccounts(
  snapshot: LegacyA3Snapshot
): Promise<Set<string>> {
  const accountIds = new Set<string>();
  for (const collection of [
    snapshot.entities,
    snapshot.relationships,
    snapshot.claims,
    snapshot.events,
    snapshot.projectionRuns,
    snapshot.proposals,
    snapshot.executions,
    snapshot.auditEntries,
  ]) {
    for (const item of collection as Array<{ accountId: string }>) {
      accountIds.add(item.accountId);
    }
  }

  const known = new Set<string>();
  for (const accountId of accountIds) {
    const result = await postgresPool().query(
      'SELECT 1 FROM accounts WHERE id = $1',
      [accountId]
    );
    if (result.rowCount) known.add(accountId);
  }
  return known;
}

function validateSnapshot(
  snapshot: LegacyA3Snapshot,
  known: Set<string>,
  report: LegacyA3ImportReport
): void {
  const entities = new Map(
    snapshot.entities.map((item) => [item.id, item])
  );
  const proposals = new Map(
    snapshot.proposals.map((item) => [item.id, item])
  );
  const claims = new Map(
    snapshot.claims.map((item) => [item.id, item])
  );
  const events = new Map(
    snapshot.events.map((item) => [item.id, item])
  );

  const checkAccount = (kind: LegacyA3Conflict['kind'], item: {
    id: string;
    accountId: string;
  }) => {
    if (!known.has(item.accountId)) {
      report.conflicts.push({
        kind,
        id: item.id,
        message:
          'Account ' +
          item.accountId +
          ' must exist from the A2 metadata import before A3 records are imported.',
      });
    }
  };

  for (const entity of snapshot.entities) {
    checkAccount('ENTITY', entity);
  }

  for (const relationship of snapshot.relationships) {
    checkAccount('RELATIONSHIP', relationship);
    const subject = entities.get(relationship.subjectEntityId);
    const object = entities.get(relationship.objectEntityId);
    if (
      !subject ||
      !object ||
      subject.accountId !== relationship.accountId ||
      object.accountId !== relationship.accountId
    ) {
      report.conflicts.push({
        kind: 'RELATIONSHIP',
        id: relationship.id,
        message:
          'Relationship subject/object must exist in the same account.',
      });
    }
  }

  for (const claim of snapshot.claims) {
    checkAccount('CLAIM', claim);
    const subject = entities.get(claim.subjectEntityId);
    if (!subject || subject.accountId !== claim.accountId) {
      report.conflicts.push({
        kind: 'CLAIM',
        id: claim.id,
        message:
          'Claim subject must exist in the same account.',
      });
    }
  }

  for (const run of snapshot.projectionRuns) {
    checkAccount('PROJECTION_RUN', run);
  }

  for (const event of snapshot.events) {
    checkAccount('EVENT', event);
    if (
      event.subjectEntityIds.some((id) => {
        const entity = entities.get(id);
        return !entity || entity.accountId !== event.accountId;
      })
    ) {
      report.conflicts.push({
        kind: 'EVENT',
        id: event.id,
        message:
          'BusinessEvent subjects must exist in the same account.',
      });
    }
  }

  for (const proposal of snapshot.proposals) {
    checkAccount('ACTION_PROPOSAL', proposal);
    if (
      proposal.targetEntityIds.some((id) => {
        const entity = entities.get(id);
        return !entity || entity.accountId !== proposal.accountId;
      })
    ) {
      report.conflicts.push({
        kind: 'ACTION_PROPOSAL',
        id: proposal.id,
        message:
          'Action proposal targets must exist in the same account.',
      });
    }
  }

  for (const execution of snapshot.executions) {
    checkAccount('ACTION_EXECUTION', execution);
    const proposal = proposals.get(execution.proposalId);
    if (!proposal || proposal.accountId !== execution.accountId) {
      report.conflicts.push({
        kind: 'ACTION_EXECUTION',
        id: execution.id,
        message:
          'Action execution proposal must exist in the same account.',
      });
    }
    if (
      execution.claimIds.some((id) => {
        const claim = claims.get(id);
        return !claim || claim.accountId !== execution.accountId;
      }) ||
      execution.eventIds.some((id) => {
        const event = events.get(id);
        return !event || event.accountId !== execution.accountId;
      })
    ) {
      report.conflicts.push({
        kind: 'ACTION_EXECUTION',
        id: execution.id,
        message:
          'Action execution claims/events must exist in the same account.',
      });
    }
  }

  for (const audit of snapshot.auditEntries) {
    checkAccount('ACTION_AUDIT', audit);
    const proposal = proposals.get(audit.proposalId);
    if (!proposal || proposal.accountId !== audit.accountId) {
      report.conflicts.push({
        kind: 'ACTION_AUDIT',
        id: audit.id,
        message:
          'Action audit proposal must exist in the same account.',
      });
    }
  }
}

export async function importLegacyA3(params: {
  dataDir?: string;
  dryRun?: boolean;
  snapshot?: LegacyA3Snapshot;
} = {}): Promise<LegacyA3ImportReport> {
  const snapshot =
    params.snapshot || readLegacyA3Snapshot(params.dataDir);
  const report = reportFor(snapshot, Boolean(params.dryRun));
  const accounts = await knownAccounts(snapshot);
  validateSnapshot(snapshot, accounts, report);

  if (params.dryRun || report.conflicts.length > 0) {
    return report;
  }

  for (const entity of snapshot.entities) {
    const existing =
      await postgresCompanyKnowledgeRepository.getEntity(
        entity.accountId,
        entity.id
      );
    if (existing) {
      if (!sameEntity(existing, entity)) {
        report.conflicts.push({
          kind: 'ENTITY',
          id: entity.id,
          message:
            'Entity already exists with different identity metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresCompanyKnowledgeRepository.saveEntity(entity);
    report.imported.entities += 1;
  }

  for (const run of snapshot.projectionRuns) {
    const existing =
      await postgresCompanyKnowledgeRepository.getProjectionRun(
        run.accountId,
        run.id
      );
    if (existing) {
      if (!sameProjectionRun(existing, run)) {
        report.conflicts.push({
          kind: 'PROJECTION_RUN',
          id: run.id,
          message:
            'Projection run already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresCompanyKnowledgeRepository.saveProjectionRun(run);
    report.imported.projectionRuns += 1;
  }

  for (const relationship of snapshot.relationships) {
    const existing =
      await postgresCompanyKnowledgeRepository.getRelationship(
        relationship.accountId,
        relationship.id
      );
    if (existing) {
      if (!sameRelationship(existing, relationship)) {
        report.conflicts.push({
          kind: 'RELATIONSHIP',
          id: relationship.id,
          message:
            'Relationship already exists with different identity metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresCompanyKnowledgeRepository.saveRelationship(
      relationship
    );
    report.imported.relationships += 1;
  }

  const orderedClaims = [...snapshot.claims].sort(
    (a, b) =>
      a.createdAt - b.createdAt ||
      a.observedAt - b.observedAt ||
      a.id.localeCompare(b.id)
  );
  for (const claim of orderedClaims) {
    const existing =
      await postgresCompanyKnowledgeRepository.getClaim(
        claim.accountId,
        claim.id
      );
    if (existing) {
      if (!sameClaim(existing, claim)) {
        report.conflicts.push({
          kind: 'CLAIM',
          id: claim.id,
          message:
            'Claim already exists with different identity/state metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresCompanyKnowledgeRepository.saveClaim(claim);
    report.imported.claims += 1;
  }

  for (const event of snapshot.events) {
    const existing =
      await postgresCompanyKnowledgeRepository.getEvent(
        event.accountId,
        event.id
      );
    if (existing) {
      if (!sameEvent(existing, event)) {
        report.conflicts.push({
          kind: 'EVENT',
          id: event.id,
          message:
            'BusinessEvent already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresCompanyKnowledgeRepository.saveEvent(event);
    report.imported.events += 1;
  }

  for (const proposal of snapshot.proposals) {
    const existing = await postgresActionRepository.getProposal(
      proposal.accountId,
      proposal.id
    );
    if (existing) {
      if (!sameProposal(existing, proposal)) {
        report.conflicts.push({
          kind: 'ACTION_PROPOSAL',
          id: proposal.id,
          message:
            'Action proposal already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresActionRepository.saveProposal({
      ...proposal,
      executionId: undefined,
    });
    report.imported.proposals += 1;
  }

  for (const execution of snapshot.executions) {
    const existing =
      await postgresActionRepository.getExecutionByProposal(
        execution.accountId,
        execution.proposalId
      );
    if (existing) {
      if (!sameExecution(existing, execution)) {
        report.conflicts.push({
          kind: 'ACTION_EXECUTION',
          id: execution.id,
          message:
            'Action execution already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresActionRepository.saveExecution(execution);
    report.imported.executions += 1;
  }

  for (const proposal of snapshot.proposals) {
    if (!proposal.executionId) continue;
    const execution = snapshot.executions.find(
      (item) =>
        item.id === proposal.executionId &&
        item.accountId === proposal.accountId
    );
    if (!execution) {
      report.conflicts.push({
        kind: 'ACTION_PROPOSAL',
        id: proposal.id,
        message:
          'Proposal references an execution that is absent from the legacy action file.',
      });
      continue;
    }

    await postgresPool().query(
      `UPDATE action_proposals
       SET execution_id = $3
       WHERE account_id = $1 AND id = $2`,
      [
        proposal.accountId,
        proposal.id,
        proposal.executionId,
      ]
    );
  }

  for (const audit of snapshot.auditEntries) {
    const existing = await postgresPool().query(
      `SELECT * FROM action_audit_entries
       WHERE account_id = $1 AND id = $2`,
      [audit.accountId, audit.id]
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      const same =
        row.proposal_id === audit.proposalId &&
        row.action === audit.action &&
        row.detail === audit.detail &&
        (row.execution_id || undefined) ===
          audit.executionId;
      if (!same) {
        report.conflicts.push({
          kind: 'ACTION_AUDIT',
          id: audit.id,
          message:
            'Action audit entry already exists with different metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }

    await postgresActionRepository.saveAudit(audit);
    report.imported.auditEntries += 1;
  }

  return report;
}
