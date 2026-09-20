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
  ActionProposalStatus,
} from '../actions/types.js';

export interface CompanyKnowledgeRepository {
  getEntity(
    accountId: string,
    entityId: string
  ): Promise<CompanyEntity | null>;
  listEntities(params: {
    accountId: string;
    type?: CompanyEntity['type'];
    limit?: number;
  }): Promise<CompanyEntity[]>;
  saveEntity(entity: CompanyEntity): Promise<void>;

  getRelationship(
    accountId: string,
    relationshipId: string
  ): Promise<CompanyRelationship | null>;
  saveRelationship(
    relationship: CompanyRelationship
  ): Promise<void>;
  listRelationships(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    limit?: number;
  }): Promise<CompanyRelationship[]>;

  getClaim(
    accountId: string,
    claimId: string
  ): Promise<KnowledgeClaim | null>;
  listClaims(params: {
    accountId: string;
    entityId?: string;
    predicate?: string;
    currentOnly?: boolean;
    limit?: number;
  }): Promise<KnowledgeClaim[]>;
  saveClaim(claim: KnowledgeClaim): Promise<void>;
  closeClaim(params: {
    accountId: string;
    claimId: string;
    validTo: number;
  }): Promise<void>;

  getEvent(
    accountId: string,
    eventId: string
  ): Promise<BusinessEvent | null>;
  listEvents(params: {
    accountId: string;
    entityId?: string;
    type?: string;
    since?: number;
    limit?: number;
  }): Promise<BusinessEvent[]>;
  saveEvent(event: BusinessEvent): Promise<void>;

  getProjectionRun(
    accountId: string,
    runId: string
  ): Promise<KnowledgeProjectionRun | null>;
  saveProjectionRun(
    run: KnowledgeProjectionRun
  ): Promise<void>;
  listProjectionRuns(params: {
    accountId: string;
    sourceType?: KnowledgeProjectionRun['sourceType'];
    sourceId?: string;
    limit?: number;
  }): Promise<KnowledgeProjectionRun[]>;
  snapshotCounts(accountId: string): Promise<{
    entities: number;
    relationships: number;
    currentClaims: number;
    events: number;
  }>;
}

export interface ActionRepository {
  getProposal(
    accountId: string,
    proposalId: string
  ): Promise<ActionProposal | null>;
  saveProposal(proposal: ActionProposal): Promise<void>;
  listProposals(params: {
    accountId: string;
    status?: ActionProposalStatus;
    limit?: number;
  }): Promise<ActionProposal[]>;
  transitionProposal(params: {
    accountId: string;
    proposalId: string;
    status: ActionProposalStatus;
    timestamp: number;
    executionId?: string;
    failureReason?: string;
  }): Promise<ActionProposal>;

  getExecutionByProposal(
    accountId: string,
    proposalId: string
  ): Promise<ActionExecution | null>;
  saveExecution(execution: ActionExecution): Promise<void>;

  saveAudit(entry: ActionAuditEntry): Promise<void>;
  listAudit(params: {
    accountId: string;
    proposalId?: string;
    limit?: number;
  }): Promise<ActionAuditEntry[]>;
}

export interface ConfirmedActionTransactionInput {
  accountId: string;
  proposalId: string;
  expectedProposalStatus: 'PROPOSED';
  claimsToClose: Array<{
    claimId: string;
    validTo: number;
  }>;
  claimsToInsert: KnowledgeClaim[];
  eventToInsert: BusinessEvent;
  execution: ActionExecution;
  auditEntry: ActionAuditEntry;
  confirmedAt: number;
}

export interface ConfirmedActionTransactionResult {
  proposal: ActionProposal;
  execution: ActionExecution;
  claims: KnowledgeClaim[];
  event: BusinessEvent;
  auditEntry: ActionAuditEntry;
  idempotentReplay: boolean;
}

export interface ConfirmedActionTransactionRepository {
  commitConfirmedAction(
    input: ConfirmedActionTransactionInput
  ): Promise<ConfirmedActionTransactionResult>;
}
