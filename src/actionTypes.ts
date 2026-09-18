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

export interface ActionTargetCandidate {
  entityId: string;
  entityType: string;
  label: string;
  reason: string;
}

export interface ProposedMutation {
  entityId: string;
  entityType: string;
  entityLabel: string;
  predicate: string;
  operation: 'SET';
  beforeValue: string | number | boolean | null;
  afterValue: string | number | boolean | null;
  valueSource: 'USER_PROVIDED' | 'DETERMINISTIC_CALCULATION';
  explanation: string;
}

export interface ActionProposal {
  id: string;
  accountId: string;
  instruction: string;
  intent: ActionIntent;
  status: ActionProposalStatus;
  parserSource: 'DETERMINISTIC' | 'LLM_ASSISTED';
  parsedInput: {
    intent: ActionIntent;
    customerReference?: string;
    orderReference?: string;
    productReference?: string;
    quantity?: number;
    amount?: number;
    status?: string;
    occurredAt?: number;
    rawDateText?: string;
  };
  targetEntityIds: string[];
  targetCandidates?: ActionTargetCandidate[];
  needsInputReason?: string;
  mutations: ProposedMutation[];
  preconditions: Array<{
    entityId: string;
    predicate: string;
    effectiveClaimId?: string;
    effectiveValue: string | number | boolean | null;
    authority?: {
      level: string;
      rank: number;
      reason: string;
    };
  }>;
  eventType?: string;
  eventData: Record<string, string | number | boolean | null>;
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

export interface ActionExecution {
  id: string;
  accountId: string;
  proposalId: string;
  intent: ActionIntent;
  claimIds: string[];
  eventIds: string[];
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
