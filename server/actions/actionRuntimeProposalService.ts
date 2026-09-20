import {
  normalizeEntityName,
} from '../companyKnowledge/companyKnowledgeStore.js';
import { companyKnowledgePersistence } from '../companyKnowledge/companyKnowledgePersistence.js';
import {
  CompanyEntity,
  CompanyEntityType,
  KnowledgeClaimValue,
} from '../companyKnowledge/types.js';
import { actionPersistence } from './actionPersistence.js';
import {
  type EffectiveKnowledgeResolution,
} from '../companyKnowledge/effectiveCompanyStateService.js';
import { effectiveCompanyStateRuntimeService } from '../companyKnowledge/effectiveCompanyStateRuntimeService.js';
import {
  ActionParserSource,
  ActionProposal,
  ActionTargetCandidate,
  ParsedActionInput,
  ProposedMutation,
} from './types.js';

const PROPOSAL_TTL_MS = 30 * 60 * 1000;

const ALLOWED_ORDER_STATUSES = new Set([
  'OPEN',
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'READY',
  'SERVED',
  'PARTIAL',
  'PAID',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
]);

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function entityCandidate(entity: CompanyEntity, reason: string): ActionTargetCandidate {
  return {
    entityId: entity.id,
    entityType: entity.type,
    label: entity.canonicalName,
    reason,
  };
}

async function exactEntityMatches(
  accountId: string,
  type: CompanyEntityType,
  reference: string
): Promise<CompanyEntity[]> {
  const normalized = normalizeEntityName(reference);
  if (!normalized) return [];

  return (
    await companyKnowledgePersistence.listEntities({
      accountId,
      type,
      search: reference,
      limit: 100,
    })
  ).filter(
    (entity) =>
      entity.identityKey === normalized ||
      entity.normalizedName === normalized ||
      entity.aliases.some(
        (alias) =>
          normalizeEntityName(alias) === normalized
      )
  );
}

async function broaderEntityCandidates(
  accountId: string,
  type: CompanyEntityType,
  reference: string
): Promise<CompanyEntity[]> {
  return companyKnowledgePersistence.listEntities({
    accountId,
    type,
    search: reference,
    limit: 20,
  });
}

function preconditionFromResolution(
  resolution: EffectiveKnowledgeResolution
): ActionProposal['preconditions'][number] {
  if (resolution.status === 'RESOLVED') {
    return {
      entityId: resolution.entityId,
      predicate: resolution.predicate,
      effectiveClaimId: resolution.effectiveClaim.id,
      effectiveValue: resolution.value,
      authority: resolution.effectiveClaim.authority,
    };
  }

  return {
    entityId: resolution.entityId,
    predicate: resolution.predicate,
    effectiveValue: null,
  };
}

export class ActionProposalError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'ACTION_NOT_SUPPORTED'
    | 'INVALID_ACTION_VALUE'
    | 'OVERPAYMENT_NOT_SUPPORTED'
    | 'INVALID_STATUS';

  constructor(
    code:
      | 'ACTION_NOT_SUPPORTED'
      | 'INVALID_ACTION_VALUE'
      | 'OVERPAYMENT_NOT_SUPPORTED'
      | 'INVALID_STATUS',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ActionProposalError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ActionRuntimeProposalService {
  public async createFromParsed(params: {
    accountId: string;
    instruction: string;
    parsed: ParsedActionInput;
    parserSource: ActionParserSource;
    now?: number;
  }): Promise<ActionProposal> {
    const now = params.now ?? Date.now();

    switch (params.parsed.intent) {
      case 'RECORD_PAYMENT':
        return this.proposePayment(params, now);
      case 'RECEIVE_INVENTORY':
        return this.proposeInventoryReceipt(params, now);
      case 'UPDATE_STATUS':
        return this.proposeStatusUpdate(params, now);
      default:
        throw new ActionProposalError(
          'ACTION_NOT_SUPPORTED',
          422,
          'This action type is not executable yet.'
        );
    }
  }

  private async needsInput(params: {
    accountId: string;
    instruction: string;
    parsed: ParsedActionInput;
    parserSource: ActionParserSource;
    now: number;
    reason: string;
    candidates?: ActionTargetCandidate[];
  }): ActionProposal {
    return actionPersistence.createProposal({
      accountId: params.accountId,
      instruction: params.instruction,
      intent: params.parsed.intent,
      status: 'NEEDS_INPUT',
      parserSource: params.parserSource,
      parsedInput: params.parsed,
      targetEntityIds: [],
      targetCandidates: params.candidates,
      needsInputReason: params.reason,
      mutations: [],
      preconditions: [],
      eventData: {},
      expiresAt: params.now + PROPOSAL_TTL_MS,
    });
  }

  private async proposed(params: {
    accountId: string;
    instruction: string;
    parsed: ParsedActionInput;
    parserSource: ActionParserSource;
    now: number;
    targetEntityIds: string[];
    mutations: ProposedMutation[];
    preconditions: ActionProposal['preconditions'];
    eventType: string;
    eventData: Record<string, KnowledgeClaimValue>;
    calculationSummary: string;
  }): ActionProposal {
    return actionPersistence.createProposal({
      accountId: params.accountId,
      instruction: params.instruction,
      intent: params.parsed.intent,
      status: 'PROPOSED',
      parserSource: params.parserSource,
      parsedInput: params.parsed,
      targetEntityIds: params.targetEntityIds,
      mutations: params.mutations,
      preconditions: params.preconditions,
      eventType: params.eventType,
      eventData: params.eventData,
      calculationSummary: params.calculationSummary,
      expiresAt: params.now + PROPOSAL_TTL_MS,
    });
  }

  private async resolveSingleEntity(params: {
    accountId: string;
    type: CompanyEntityType;
    reference: string;
  }): Promise<
    | { status: 'RESOLVED'; entity: CompanyEntity }
    | { status: 'NEEDS_INPUT'; candidates: ActionTargetCandidate[]; reason: string }
  > {
    const exact = await exactEntityMatches(
      params.accountId,
      params.type,
      params.reference
    );

    if (exact.length === 1) {
      return { status: 'RESOLVED', entity: exact[0] };
    }

    const broader =
      exact.length > 1
        ? exact
        : await broaderEntityCandidates(
            params.accountId,
            params.type,
            params.reference
          );

    return {
      status: 'NEEDS_INPUT',
      candidates: broader.map((entity) =>
        entityCandidate(
          entity,
          exact.length > 1
            ? 'Multiple entities have this exact name/alias.'
            : 'Possible match; exact identity was not proven.'
        )
      ),
      reason:
        broader.length === 0
          ? `No ${params.type.toLowerCase()} matched "${params.reference}".`
          : `The reference "${params.reference}" is ambiguous. Choose the intended ${params.type.toLowerCase()}.`,
    };
  }

  private async resolvePaymentOrder(params: {
    accountId: string;
    parsed: ParsedActionInput;
  }): Promise<
    | { status: 'RESOLVED'; order: CompanyEntity; customer?: CompanyEntity }
    | { status: 'NEEDS_INPUT'; candidates: ActionTargetCandidate[]; reason: string }
  > {
    if (params.parsed.orderReference) {
      const order = await this.resolveSingleEntity({
        accountId: params.accountId,
        type: 'ORDER',
        reference: params.parsed.orderReference,
      });
      if (order.status === 'NEEDS_INPUT') return order;
      return { status: 'RESOLVED', order: order.entity };
    }

    if (!params.parsed.customerReference) {
      return {
        status: 'NEEDS_INPUT',
        candidates: [],
        reason: 'A customer or order reference is required for a payment.',
      };
    }

    const customer = await this.resolveSingleEntity({
      accountId: params.accountId,
      type: 'CUSTOMER',
      reference: params.parsed.customerReference,
    });
    if (customer.status === 'NEEDS_INPUT') return customer;

    const placed = (
      await companyKnowledgePersistence.listRelationships({
        accountId: params.accountId,
        entityId: customer.entity.id,
        predicate: 'PLACED',
        limit: 100,
      })
    ).filter(
        (relationship) =>
          relationship.subjectEntityId === customer.entity.id
      );

    const openOrders: Array<{ order: CompanyEntity; balance: number }> = [];

    for (const relationship of placed) {
      const order = await companyKnowledgePersistence.getEntity(
        params.accountId,
        relationship.objectEntityId
      );
      if (!order || order.type !== 'ORDER') continue;

      const balance =
        await effectiveCompanyStateRuntimeService.resolve(
          params.accountId,
          order.id,
          'BALANCE_DUE'
        );
      if (
        balance.status === 'RESOLVED' &&
        typeof balance.value === 'number' &&
        balance.value > 0
      ) {
        openOrders.push({ order, balance: balance.value });
      }
    }

    if (openOrders.length === 1) {
      return {
        status: 'RESOLVED',
        order: openOrders[0].order,
        customer: customer.entity,
      };
    }

    const candidates =
      openOrders.length > 0
        ? openOrders.map(({ order, balance }) =>
            entityCandidate(
              order,
              'Outstanding balance: ' + String(balance)
            )
          )
        : (
            await Promise.all(
              placed.map((relationship) =>
                companyKnowledgePersistence.getEntity(
                  params.accountId,
                  relationship.objectEntityId
                )
              )
            )
          )
            .filter(
              (entity): entity is CompanyEntity =>
                Boolean(entity && entity.type === 'ORDER')
            )
            .map((order) =>
              entityCandidate(
                order,
                'Order placed by this customer.'
              )
            );

    return {
      status: 'NEEDS_INPUT',
      candidates,
      reason:
        candidates.length === 0
          ? `No linked order with a usable outstanding balance was found for ${customer.entity.canonicalName}.`
          : `${customer.entity.canonicalName} has multiple possible orders. Choose which order received the payment.`,
    };
  }

  private async proposePayment(
    params: {
      accountId: string;
      instruction: string;
      parsed: ParsedActionInput;
      parserSource: ActionParserSource;
    },
    now: number
  ): Promise<ActionProposal> {
    const amount = params.parsed.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new ActionProposalError(
        'INVALID_ACTION_VALUE',
        422,
        'Payment amount must be greater than zero.'
      );
    }

    const target = await this.resolvePaymentOrder({
      accountId: params.accountId,
      parsed: params.parsed,
    });

    if (target.status === 'NEEDS_INPUT') {
      return this.needsInput({
        ...params,
        now,
        reason: target.reason,
        candidates: target.candidates,
      });
    }

    const balance = await effectiveCompanyStateRuntimeService.resolve(
      params.accountId,
      target.order.id,
      'BALANCE_DUE'
    );

    if (balance.status !== 'RESOLVED' || typeof balance.value !== 'number') {
      return this.needsInput({
        ...params,
        now,
        reason:
          balance.status === 'CONFLICT'
            ? 'The order has conflicting highest-authority balance values. Resolve the conflict before recording a payment.'
            : 'The order does not have a usable current balance due.',
        candidates: [
          entityCandidate(target.order, 'Payment target order.'),
        ],
      });
    }

    if (amount > balance.value) {
      throw new ActionProposalError(
        'OVERPAYMENT_NOT_SUPPORTED',
        422,
        `Payment ${amount} exceeds the current balance due of ${balance.value}. Overpayments are not supported yet.`
      );
    }

    const newBalance = roundMoney(balance.value - amount);
    const mutations: ProposedMutation[] = [
      {
        entityId: target.order.id,
        entityType: target.order.type,
        entityLabel: target.order.canonicalName,
        predicate: 'BALANCE_DUE',
        operation: 'SET',
        beforeValue: balance.value,
        afterValue: newBalance,
        valueSource: 'DETERMINISTIC_CALCULATION',
        explanation:
          'New balance = current effective balance - confirmed payment.',
      },
    ];
    const preconditions: ActionProposal['preconditions'] = [
      preconditionFromResolution(balance),
    ];

    const paid = await effectiveCompanyStateRuntimeService.resolve(
      params.accountId,
      target.order.id,
      'PAID_AMOUNT'
    );
    const total = await effectiveCompanyStateRuntimeService.resolve(
      params.accountId,
      target.order.id,
      'TOTAL_AMOUNT'
    );

    let priorPaid: number | null = null;
    if (paid.status === 'RESOLVED' && typeof paid.value === 'number') {
      priorPaid = paid.value;
      preconditions.push(preconditionFromResolution(paid));
    } else if (
      paid.status === 'MISSING' &&
      total.status === 'RESOLVED' &&
      typeof total.value === 'number' &&
      total.value >= balance.value
    ) {
      priorPaid = roundMoney(total.value - balance.value);
      preconditions.push(preconditionFromResolution(total));
      preconditions.push(preconditionFromResolution(paid));
    }

    if (priorPaid !== null) {
      mutations.push({
        entityId: target.order.id,
        entityType: target.order.type,
        entityLabel: target.order.canonicalName,
        predicate: 'PAID_AMOUNT',
        operation: 'SET',
        beforeValue: priorPaid,
        afterValue: roundMoney(priorPaid + amount),
        valueSource: 'DETERMINISTIC_CALCULATION',
        explanation:
          'New paid amount = current/derived paid amount + confirmed payment.',
      });
    }

    return this.proposed({
      ...params,
      now,
      targetEntityIds: [
        target.order.id,
        ...(target.customer ? [target.customer.id] : []),
      ],
      mutations,
      preconditions,
      eventType: 'PAYMENT_RECEIVED',
      eventData: {
        paymentAmount: amount,
        previousBalance: balance.value,
        newBalance,
        orderId: target.order.id,
        customerId: target.customer?.id || null,
        occurredAt: params.parsed.occurredAt || now,
      },
      calculationSummary:
        'Subtract ' +
        String(amount) +
        ' from balance due ' +
        String(balance.value) +
        ' to produce ' +
        String(newBalance) +
        '.',
    });
  }

  private async proposeInventoryReceipt(
    params: {
      accountId: string;
      instruction: string;
      parsed: ParsedActionInput;
      parserSource: ActionParserSource;
    },
    now: number
  ): Promise<ActionProposal> {
    const quantity = params.parsed.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      throw new ActionProposalError(
        'INVALID_ACTION_VALUE',
        422,
        'Received inventory quantity must be greater than zero.'
      );
    }
    if (!params.parsed.productReference) {
      return this.needsInput({
        ...params,
        now,
        reason: 'A product reference is required for inventory receipt.',
      });
    }

    const product = await this.resolveSingleEntity({
      accountId: params.accountId,
      type: 'PRODUCT',
      reference: params.parsed.productReference,
    });
    if (product.status === 'NEEDS_INPUT') {
      return this.needsInput({
        ...params,
        now,
        reason: product.reason,
        candidates: product.candidates,
      });
    }

    const stock = await effectiveCompanyStateRuntimeService.resolve(
      params.accountId,
      product.entity.id,
      'CURRENT_STOCK'
    );
    if (stock.status !== 'RESOLVED' || typeof stock.value !== 'number') {
      return this.needsInput({
        ...params,
        now,
        reason:
          stock.status === 'CONFLICT'
            ? 'The product has conflicting highest-authority stock values. Resolve the conflict before receiving inventory.'
            : 'The product does not have a usable current-stock observation yet.',
        candidates: [
          entityCandidate(product.entity, 'Inventory target product.'),
        ],
      });
    }

    const afterStock = stock.value + quantity;

    return this.proposed({
      ...params,
      now,
      targetEntityIds: [product.entity.id],
      mutations: [
        {
          entityId: product.entity.id,
          entityType: product.entity.type,
          entityLabel: product.entity.canonicalName,
          predicate: 'CURRENT_STOCK',
          operation: 'SET',
          beforeValue: stock.value,
          afterValue: afterStock,
          valueSource: 'DETERMINISTIC_CALCULATION',
          explanation:
            'New stock = current effective stock + received quantity.',
        },
      ],
      preconditions: [preconditionFromResolution(stock)],
      eventType: 'INVENTORY_RECEIVED',
      eventData: {
        quantityReceived: quantity,
        previousStock: stock.value,
        newStock: afterStock,
        productId: product.entity.id,
        occurredAt: params.parsed.occurredAt || now,
      },
      calculationSummary:
        'Add ' +
        String(quantity) +
        ' to current stock ' +
        String(stock.value) +
        ' to produce ' +
        String(afterStock) +
        '.',
    });
  }

  private async proposeStatusUpdate(
    params: {
      accountId: string;
      instruction: string;
      parsed: ParsedActionInput;
      parserSource: ActionParserSource;
    },
    now: number
  ): Promise<ActionProposal> {
    if (!params.parsed.orderReference) {
      return this.needsInput({
        ...params,
        now,
        reason: 'An order reference is required for a status update.',
      });
    }

    const status = params.parsed.status?.trim().toUpperCase();
    if (!status || !ALLOWED_ORDER_STATUSES.has(status)) {
      throw new ActionProposalError(
        'INVALID_STATUS',
        422,
        'Unsupported order status. Use a known business status such as OPEN, CONFIRMED, PROCESSING, READY, SERVED, PARTIAL, PAID, DELIVERED, COMPLETED, or CANCELLED.'
      );
    }

    const order = await this.resolveSingleEntity({
      accountId: params.accountId,
      type: 'ORDER',
      reference: params.parsed.orderReference,
    });
    if (order.status === 'NEEDS_INPUT') {
      return this.needsInput({
        ...params,
        now,
        reason: order.reason,
        candidates: order.candidates,
      });
    }

    const current = await effectiveCompanyStateRuntimeService.resolve(
      params.accountId,
      order.entity.id,
      'STATUS'
    );

    if (current.status === 'CONFLICT') {
      return this.needsInput({
        ...params,
        now,
        reason:
          'The order has conflicting highest-authority status values. Resolve the conflict before changing status.',
        candidates: [entityCandidate(order.entity, 'Target order.')],
      });
    }

    const beforeValue =
      current.status === 'RESOLVED' ? current.value : null;

    return this.proposed({
      ...params,
      now,
      targetEntityIds: [order.entity.id],
      mutations: [
        {
          entityId: order.entity.id,
          entityType: order.entity.type,
          entityLabel: order.entity.canonicalName,
          predicate: 'STATUS',
          operation: 'SET',
          beforeValue,
          afterValue: status,
          valueSource: 'USER_PROVIDED',
          explanation: 'Set the order status to the explicitly requested value.',
        },
      ],
      preconditions: [preconditionFromResolution(current)],
      eventType: 'ORDER_STATUS_CHANGED',
      eventData: {
        previousStatus: beforeValue,
        newStatus: status,
        orderId: order.entity.id,
        occurredAt: params.parsed.occurredAt || now,
      },
      calculationSummary:
        'No arithmetic transformation. Apply the explicitly requested status after confirmation.',
    });
  }
}

export const actionRuntimeProposalService =
  new ActionRuntimeProposalService();
