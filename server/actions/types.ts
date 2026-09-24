import {
  KnowledgeClaimValue,
  SourceAuthority,
} from '../companyKnowledge/types.js';

export type ActionIntent =
  | 'RECORD_PAYMENT'
  | 'RECEIVE_INVENTORY'
  | 'UPDATE_STATUS'
  | 'CREATE_ORDER';

export type ActionProposalStatus =
  | 'PROPOSED'
  | 'NEEDS_INPUT'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'STALE'
  | 'FAILED';

export type ActionParserSource = 'DETERMINISTIC' | 'LLM_ASSISTED';

export interface ActionTargetCandidate {
  entityId: string;
  entityType: string;
  label: string;
  reason: string;
}

export interface ActionPrecondition {
  entityId: string;
  predicate: string;
  effectiveClaimId?: string;
  effectiveValue: KnowledgeClaimValue;
  authority?: SourceAuthority;
}

export interface ProposedMutation {
  entityId: string;
  entityType: string;
  entityLabel: string;
  predicate: string;
  operation: 'SET';
  beforeValue: KnowledgeClaimValue;
  afterValue: KnowledgeClaimValue;
  valueSource: 'USER_PROVIDED' | 'DETERMINISTIC_CALCULATION';
  explanation: string;
}

export interface ParsedActionInput {
  intent: ActionIntent;
  customerReference?: string;
  orderReference?: string;
  productReference?: string;
  quantity?: number;
  amount?: number;
  status?: string;
  occurredAt?: number;
  rawDateText?: string;
}

export interface ActionProposal {
  id: string;
  accountId: string;
  instruction: string;
  intent: ActionIntent;
  status: ActionProposalStatus;
  parserSource: ActionParserSource;
  parsedInput: ParsedActionInput;
  targetEntityIds: string[];
  targetCandidates?: ActionTargetCandidate[];
  needsInputReason?: string;
  mutations: ProposedMutation[];
  preconditions: ActionPrecondition[];
  eventType?: string;
  eventData: Record<string, KnowledgeClaimValue>;
  calculationSummary?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  confirmedAt?: number;
  cancelledAt?: number;
  staleAt?: number;
  failedAt?: number;
  failureReason?: string;
  executionId?: string;
}

export type ActionExecutionMode =
  | 'MANUAL_CONFIRMATION'
  | 'AUTOMATION_POLICY'
  | 'AUTOMATION_COMPENSATION';

export interface ActionExecution {
  id: string;
  accountId: string;
  proposalId: string;
  intent: ActionIntent;
  executionMode?: ActionExecutionMode;
  authorizedBy?: string;
  authorizedByRole?: string;
  automationPolicyId?: string;
  automationPolicyVersion?: number;
  claimIds: string[];
  eventIds: string[];
  downstreamDiscoveryJobIds?: string[];
  downstreamAnalysisRunIds?: string[];
  downstreamWarnings?: string[];
  executedAt: number;
}

export interface ActionAuditEntry {
  id: string;
  accountId: string;
  proposalId: string;
  action:
    | 'PROPOSED'
    | 'NEEDS_INPUT'
    | 'CONFIRMED'
    | 'CANCELLED'
    | 'STALE'
    | 'FAILED';
  timestamp: number;
  detail: string;
  executionId?: string;
}

export interface ActionInterpretationResult {
  proposal: ActionProposal;
  effectiveParser: ActionParserSource;
}
