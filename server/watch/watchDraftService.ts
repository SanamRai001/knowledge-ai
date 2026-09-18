import { datasetStore } from '../datasets/datasetStore.js';
import { companyKnowledgeStore, normalizeEntityName } from '../companyKnowledge/companyKnowledgeStore.js';
import { providerRouter } from '../providers/providerRouter.js';
import { watchService } from './watchService.js';
import { watchStore } from './watchStore.js';
import {
  ParsedWatchRequest,
  WatchComparisonOperator,
  WatchDraft,
  WatchDraftCandidate,
  WatchDraftParserSource,
  WatchCondition,
} from './types.js';

const WATCH_DRAFT_TTL_MS = 30 * 60 * 1000;

type ParsedWatchDraft = {
  request: ParsedWatchRequest;
  proposedName: string;
  parserSource: WatchDraftParserSource;
};

function parseCompactNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/\b(?:NPR|Rs\.?|रु\.?|रू\.?)\b/gi, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)(k|m|l|lac|lakh)?$/i);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;

  const suffix = (match[2] || '').toLowerCase();
  const multiplier =
    suffix === 'k'
      ? 1_000
      : suffix === 'm'
        ? 1_000_000
        : suffix === 'l' || suffix === 'lac' || suffix === 'lakh'
          ? 100_000
          : 1;

  const value = base * multiplier;
  return Number.isFinite(value) ? value : null;
}

function parseOperator(raw: string): WatchComparisonOperator | null {
  const value = raw.trim().toLowerCase().replace(/\s+/g, ' ');

  if (['exceed', 'exceeds', 'above', 'over', 'greater than', 'more than'].includes(value)) {
    return 'GT';
  }
  if (['at least', 'greater than or equal to'].includes(value)) {
    return 'GTE';
  }
  if (['below', 'under', 'less than', 'drops below', 'falls below'].includes(value)) {
    return 'LT';
  }
  if (['at or below', 'no more than', 'less than or equal to'].includes(value)) {
    return 'LTE';
  }
  if (['equals', 'equal to', 'is exactly'].includes(value)) {
    return 'EQ';
  }
  if (['not equal to', 'is not'].includes(value)) {
    return 'NEQ';
  }
  return null;
}

function cleanInstruction(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/g, '').trim();
}

function cleanReference(value: string): string {
  return value
    .trim()
    .replace(/^(?:product|item|order|invoice)\s+/i, '')
    .replace(/[.,;!?]+$/g, '')
    .trim();
}

function parseExplicitReminderTime(value: string): number | null {
  const text = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      text
    )
  ) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function balanceColumnScore(name: string): number {
  const normalized = normalizeHeader(name);
  const terms = [
    'outstanding balance',
    'balance due',
    'amount due',
    'remaining balance',
    'remaining amount',
    'outstanding',
  ];
  return terms.reduce((score, term, index) => {
    if (normalized === term) return Math.max(score, 100 - index);
    if (normalized.includes(term)) return Math.max(score, 40 - index);
    return score;
  }, 0);
}

function exactEntityMatches(
  accountId: string,
  entityType: 'PRODUCT' | 'ORDER' | 'INVOICE',
  reference: string
) {
  const normalized = normalizeEntityName(reference);
  return companyKnowledgeStore
    .listEntities({
      accountId,
      type: entityType,
      search: reference,
      limit: 50,
    })
    .filter(
      (entity) =>
        entity.identityKey === normalized ||
        entity.normalizedName === normalized ||
        entity.aliases.some(
          (alias) => normalizeEntityName(alias) === normalized
        )
    );
}

function entityCandidates(
  accountId: string,
  entityType: 'PRODUCT' | 'ORDER' | 'INVOICE',
  reference: string
): WatchDraftCandidate[] {
  return companyKnowledgeStore
    .listEntities({
      accountId,
      type: entityType,
      search: reference,
      limit: 20,
    })
    .map((entity) => ({
      key: entity.id,
      kind: 'ENTITY' as const,
      label: entity.canonicalName,
      entityId: entity.id,
      reason: 'Possible ' + entityType.toLowerCase() + ' match.',
    }));
}

function outstandingDatasetCandidates(
  accountId: string
): Array<WatchDraftCandidate & { columnName: string }> {
  const output: Array<WatchDraftCandidate & { columnName: string }> = [];

  for (const dataset of datasetStore.listDatasets(accountId)) {
    const version = datasetStore.getCurrentVersion(accountId, dataset.id);

    for (const table of version.tables) {
      const best = table.columns
        .map((column) => ({
          column,
          score: balanceColumnScore(column.normalizedName || column.name),
        }))
        .filter(
          (entry) =>
            entry.score > 0 &&
            ['INTEGER', 'DECIMAL', 'CURRENCY'].includes(
              entry.column.inferredType
            )
        )
        .sort((left, right) => right.score - left.score)[0];

      if (!best) continue;

      output.push({
        key: dataset.id + ':' + table.id,
        kind: 'DATASET_TABLE',
        label: dataset.name + ' · ' + table.name,
        datasetId: dataset.id,
        tableName: table.name,
        columnName: best.column.name,
        reason:
          'Matched outstanding/balance column "' + best.column.name + '".',
      });
    }
  }

  return output;
}

function deterministicParse(instruction: string): ParsedWatchDraft | null {
  const text = cleanInstruction(instruction);
  const body = text.replace(
    /^(?:please\s+)?(?:tell me|warn me|alert me|notify me)\s+(?:if|when)\s+/i,
    ''
  );

  const dateWindow = text.match(
    /^(?:please\s+)?(?:remind me|tell me|warn me|alert me|notify me)\s+(\d{1,4})\s+days?\s+before\s+(order|invoice)\s+([A-Za-z0-9._\/-]+)\s+(?:is\s+)?due$/i
  );
  if (dateWindow) {
    const daysBefore = Number(dateWindow[1]);
    if (Number.isInteger(daysBefore) && daysBefore >= 0 && daysBefore <= 3650) {
      const entityType =
        dateWindow[2].toLowerCase() === 'invoice'
          ? 'INVOICE'
          : 'ORDER';
      const reference = cleanReference(dateWindow[3]);
      return {
        request: {
          kind: 'ENTITY_DATE_WINDOW',
          entityType,
          entityReference: reference,
          predicate: 'DUE_DATE',
          daysBefore,
        },
        proposedName:
          String(daysBefore) +
          ' day' +
          (daysBefore === 1 ? '' : 's') +
          ' before ' +
          entityType.toLowerCase() +
          ' ' +
          reference +
          ' is due',
        parserSource: 'DETERMINISTIC',
      };
    }
  }

  const explicitTime = text.match(
    /^(?:please\s+)?(?:remind me|tell me|alert me|notify me)\s+(?:at|on)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))$/i
  );
  if (explicitTime) {
    const triggerAt = parseExplicitReminderTime(explicitTime[1]);
    if (triggerAt !== null) {
      return {
        request: {
          kind: 'TIME_REACHED',
          triggerAt,
          rawDateText: explicitTime[1],
        },
        proposedName:
          'Reminder for ' + new Date(triggerAt).toISOString(),
        parserSource: 'DETERMINISTIC',
      };
    }
  }

  const stock = body.match(
    /^(.+?)\s+(?:current\s+)?stock\s+(drops below|falls below|at or below|no more than|below|under|less than|exceeds?|above|over|greater than|more than|at least)\s+((?:NPR|Rs\.?)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|l|lac|lakh)?)$/i
  );
  if (stock) {
    const operator = parseOperator(stock[2]);
    const threshold = parseCompactNumber(stock[3]);
    if (operator && threshold !== null) {
      const reference = cleanReference(stock[1]);
      return {
        request: {
          kind: 'ENTITY_NUMERIC_THRESHOLD',
          entityType: 'PRODUCT',
          entityReference: reference,
          predicate: 'CURRENT_STOCK',
          operator,
          threshold,
        },
        proposedName:
          reference +
          ' stock ' +
          stock[2].toLowerCase() +
          ' ' +
          String(threshold),
        parserSource: 'DETERMINISTIC',
      };
    }
  }

  const orderBalance = body.match(
    /^(order|invoice)\s+([A-Za-z0-9._\/-]+)\s+(?:balance(?: due)?|outstanding(?: balance)?)\s+(exceeds?|above|over|greater than|more than|at least|at or below|no more than|below|under|less than)\s+((?:NPR|Rs\.?)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|l|lac|lakh)?)$/i
  );
  if (orderBalance) {
    const operator = parseOperator(orderBalance[3]);
    const threshold = parseCompactNumber(orderBalance[4]);
    if (operator && threshold !== null) {
      const entityType =
        orderBalance[1].toLowerCase() === 'invoice'
          ? 'INVOICE'
          : 'ORDER';
      const reference = cleanReference(orderBalance[2]);
      return {
        request: {
          kind: 'ENTITY_NUMERIC_THRESHOLD',
          entityType,
          entityReference: reference,
          predicate: 'BALANCE_DUE',
          operator,
          threshold,
        },
        proposedName:
          entityType.charAt(0) +
          entityType.slice(1).toLowerCase() +
          ' ' +
          reference +
          ' balance threshold',
        parserSource: 'DETERMINISTIC',
      };
    }
  }

  const outstanding = body.match(
    /^(?:total\s+)?(?:unpaid invoices?|outstanding(?: invoice)?(?: balance| total)?|unpaid total)\s+(exceeds?|above|over|greater than|more than|at least|at or below|no more than|below|under|less than)\s+((?:NPR|Rs\.?)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|l|lac|lakh)?)$/i
  );
  if (outstanding) {
    const operator = parseOperator(outstanding[1]);
    const threshold = parseCompactNumber(outstanding[2]);
    if (operator && threshold !== null) {
      return {
        request: {
          kind: 'DATASET_AGGREGATE_THRESHOLD',
          semantic: 'OUTSTANDING_TOTAL',
          operator,
          threshold,
        },
        proposedName:
          'Outstanding total ' +
          outstanding[1].toLowerCase() +
          ' ' +
          String(threshold),
        parserSource: 'DETERMINISTIC',
      };
    }
  }

  return null;
}

function parseJsonObject(text: string): unknown {
  const clean = text.trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function validateLlmParsed(raw: unknown): {
  request: ParsedWatchRequest;
  proposedName: string;
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const proposedName =
    typeof value.proposedName === 'string' &&
    value.proposedName.trim()
      ? value.proposedName.trim().slice(0, 120)
      : 'Business condition watch';

  if (value.kind === 'ENTITY_DATE_WINDOW') {
    const entityType =
      value.entityType === 'ORDER' || value.entityType === 'INVOICE'
        ? value.entityType
        : null;
    const entityReference =
      typeof value.entityReference === 'string'
        ? value.entityReference.trim()
        : '';
    const daysBefore =
      typeof value.daysBefore === 'number' &&
      Number.isInteger(value.daysBefore) &&
      value.daysBefore >= 0 &&
      value.daysBefore <= 3650
        ? value.daysBefore
        : null;

    if (!entityType || !entityReference || daysBefore === null) {
      return null;
    }

    return {
      request: {
        kind: 'ENTITY_DATE_WINDOW',
        entityType,
        entityReference,
        predicate: 'DUE_DATE',
        daysBefore,
      },
      proposedName,
    };
  }

  if (value.kind === 'TIME_REACHED') {
    const rawDateText =
      typeof value.rawDateText === 'string'
        ? value.rawDateText.trim()
        : '';
    const triggerAt = parseExplicitReminderTime(rawDateText);
    if (triggerAt === null) return null;

    return {
      request: {
        kind: 'TIME_REACHED',
        triggerAt,
        rawDateText,
        timezone:
          typeof value.timezone === 'string' && value.timezone.trim()
            ? value.timezone.trim()
            : undefined,
      },
      proposedName,
    };
  }

  const operator =
    typeof value.operator === 'string'
      ? (value.operator.toUpperCase() as WatchComparisonOperator)
      : null;
  if (
    !operator ||
    !['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ'].includes(operator)
  ) {
    return null;
  }

  const threshold =
    typeof value.threshold === 'number' &&
    Number.isFinite(value.threshold)
      ? value.threshold
      : null;
  if (threshold === null) return null;

  if (value.kind === 'ENTITY_NUMERIC_THRESHOLD') {
    const entityType =
      value.entityType === 'PRODUCT' ||
      value.entityType === 'ORDER' ||
      value.entityType === 'INVOICE'
        ? value.entityType
        : null;
    const predicate =
      value.predicate === 'CURRENT_STOCK' ||
      value.predicate === 'BALANCE_DUE'
        ? value.predicate
        : null;
    const entityReference =
      typeof value.entityReference === 'string'
        ? value.entityReference.trim()
        : '';

    if (!entityType || !predicate || !entityReference) return null;

    return {
      request: {
        kind: 'ENTITY_NUMERIC_THRESHOLD',
        entityType,
        entityReference,
        predicate,
        operator,
        threshold,
      },
      proposedName,
    };
  }

  if (
    value.kind === 'DATASET_AGGREGATE_THRESHOLD' &&
    value.semantic === 'OUTSTANDING_TOTAL'
  ) {
    return {
      request: {
        kind: 'DATASET_AGGREGATE_THRESHOLD',
        semantic: 'OUTSTANDING_TOTAL',
        operator,
        threshold,
      },
      proposedName,
    };
  }

  return null;
}

export class WatchDraftError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'WATCH_INSTRUCTION_INVALID'
    | 'WATCH_LANGUAGE_UNSUPPORTED'
    | 'WATCH_LLM_UNAVAILABLE'
    | 'WATCH_LLM_INVALID'
    | 'WATCH_DRAFT_NOT_SAVABLE'
    | 'WATCH_DRAFT_EXPIRED'
    | 'WATCH_DRAFT_TARGET_INVALID';

  constructor(
    code:
      | 'WATCH_INSTRUCTION_INVALID'
      | 'WATCH_LANGUAGE_UNSUPPORTED'
      | 'WATCH_LLM_UNAVAILABLE'
      | 'WATCH_LLM_INVALID'
      | 'WATCH_DRAFT_NOT_SAVABLE'
      | 'WATCH_DRAFT_EXPIRED'
      | 'WATCH_DRAFT_TARGET_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'WatchDraftError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class WatchDraftService {
  public async propose(params: {
    accountId: string;
    instruction: string;
    allowLlmParsing?: boolean;
  }): Promise<WatchDraft> {
    const instruction = params.instruction.trim();
    if (!instruction || instruction.length > 2000) {
      throw new WatchDraftError(
        'WATCH_INSTRUCTION_INVALID',
        400,
        'Watch instruction must contain 1–2000 characters.'
      );
    }

    let parsed = deterministicParse(instruction);

    if (!parsed) {
      if (params.allowLlmParsing === false) {
        throw new WatchDraftError(
          'WATCH_LANGUAGE_UNSUPPORTED',
          422,
          'This wording did not match a supported deterministic watch pattern.'
        );
      }

      const provider = providerRouter.getPrimaryProvider();
      if (!provider?.isConfigured()) {
        throw new WatchDraftError(
          'WATCH_LLM_UNAVAILABLE',
          422,
          'This wording needs the language parser, but the configured provider is unavailable.'
        );
      }

      const generated = await providerRouter.generate({
        responseFormat: 'json',
        temperature: 0,
        systemInstruction:
          'You are a bounded parser for company monitoring requests. Extract only an allowed watch intent. Do not resolve entities or datasets. Do not execute or save a watch. Do not calculate current business values.',
        prompt: [
          'Allowed outputs:',
          '',
          '1) Entity numeric threshold:',
          '{',
          '  "kind":"ENTITY_NUMERIC_THRESHOLD",',
          '  "entityType":"PRODUCT | ORDER | INVOICE",',
          '  "entityReference":"exact wording from user",',
          '  "predicate":"CURRENT_STOCK | BALANCE_DUE",',
          '  "operator":"GT | GTE | LT | LTE | EQ | NEQ",',
          '  "threshold":12345,',
          '  "proposedName":"short business-facing name"',
          '}',
          '',
          '2) Total outstanding threshold:',
          '{',
          '  "kind":"DATASET_AGGREGATE_THRESHOLD",',
          '  "semantic":"OUTSTANDING_TOTAL",',
          '  "operator":"GT | GTE | LT | LTE | EQ | NEQ",',
          '  "threshold":12345,',
          '  "proposedName":"short business-facing name"',
          '}',
          '',
          '3) Source-relative due-date reminder:',
          '{',
          '  "kind":"ENTITY_DATE_WINDOW",',
          '  "entityType":"ORDER | INVOICE",',
          '  "entityReference":"exact wording from user",',
          '  "daysBefore":3,',
          '  "proposedName":"short business-facing name"',
          '}',
          '',
          '4) Explicit timestamp reminder:',
          '{',
          '  "kind":"TIME_REACHED",',
          '  "rawDateText":"exact ISO-8601 timestamp with Z or numeric offset from the user",',
          '  "timezone":"optional label only if explicitly stated",',
          '  "proposedName":"short business-facing name"',
          '}',
          '',
          '5) Unsupported:',
          '{"kind":"UNSUPPORTED"}',
          '',
          'Rules:',
          '- Never invent a product/order/invoice reference.',
          '- Convert explicit shorthand such as 500k to 500000.',
          '- Do not choose a dataset.',
          '- Do not calculate stock, balances, totals, or due dates.',
          '- For TIME_REACHED, accept only an explicit ISO-8601 timestamp that already appears in the user request. Never invent or convert a vague time.',
          '- Use UNSUPPORTED for anomalies, vague dates/times, arbitrary prose conditions, or unsupported rule types.',
          '',
          'User request:',
          instruction,
        ].join('\n'),
      });

      if (!generated.ok) {
        throw new WatchDraftError(
          'WATCH_LLM_UNAVAILABLE',
          422,
          'The language parser could not interpret this watch safely.'
        );
      }

      const validated = validateLlmParsed(
        parseJsonObject(generated.text)
      );
      if (!validated) {
        throw new WatchDraftError(
          'WATCH_LLM_INVALID',
          422,
          'The language model did not return a valid supported watch. Nothing was saved.'
        );
      }

      parsed = {
        ...validated,
        parserSource: 'LLM_ASSISTED',
      };
    }

    return this.resolveParsed({
      accountId: params.accountId,
      instruction,
      parsed,
    });
  }

  public selectTarget(params: {
    accountId: string;
    draftId: string;
    candidateKey: string;
  }): WatchDraft {
    const draft = watchStore.requireDraft(
      params.accountId,
      params.draftId
    );

    if (draft.status !== 'NEEDS_INPUT' || !draft.parsedRequest) {
      throw new WatchDraftError(
        'WATCH_DRAFT_TARGET_INVALID',
        409,
        'This watch draft is not waiting for target selection.'
      );
    }

    const candidate = draft.candidates?.find(
      (item) => item.key === params.candidateKey
    );
    if (!candidate) {
      throw new WatchDraftError(
        'WATCH_DRAFT_TARGET_INVALID',
        422,
        'Selected target was not one of the validated watch candidates.'
      );
    }

    const condition = this.conditionFromCandidate(
      params.accountId,
      draft.parsedRequest,
      candidate
    );
    const validated = watchService.validateCondition(
      params.accountId,
      condition
    );

    return watchStore.updateDraft(
      params.accountId,
      draft.id,
      {
        status: 'PROPOSED',
        condition: validated,
        candidates: undefined,
        needsInputReason: undefined,
      }
    );
  }

  public save(params: {
    accountId: string;
    draftId: string;
  }): { draft: WatchDraft; ruleId: string } {
    const draft = watchStore.requireDraft(
      params.accountId,
      params.draftId
    );

    if (draft.status !== 'PROPOSED' || !draft.condition) {
      throw new WatchDraftError(
        'WATCH_DRAFT_NOT_SAVABLE',
        409,
        'Only a fully validated proposed watch draft can be saved.'
      );
    }
    if (draft.expiresAt <= Date.now()) {
      watchStore.updateDraft(params.accountId, draft.id, {
        status: 'INVALID',
      });
      throw new WatchDraftError(
        'WATCH_DRAFT_EXPIRED',
        409,
        'This watch draft expired. Create a fresh preview before saving.'
      );
    }

    const condition = watchService.validateCondition(
      params.accountId,
      draft.condition
    );

    const rule = watchService.createRule({
      accountId: params.accountId,
      name: draft.proposedName,
      condition,
      origin: 'NATURAL_LANGUAGE',
      evaluationMode: 'INTERVAL',
      intervalMinutes:
        condition.kind === 'TIME_REACHED' ? 5 : 60,
    });

    const savedDraft = watchStore.updateDraft(
      params.accountId,
      draft.id,
      {
        status: 'SAVED',
        savedRuleId: rule.id,
      }
    );

    return {
      draft: savedDraft,
      ruleId: rule.id,
    };
  }

  public cancel(params: {
    accountId: string;
    draftId: string;
  }): WatchDraft {
    const draft = watchStore.requireDraft(
      params.accountId,
      params.draftId
    );

    if (draft.status === 'SAVED') {
      throw new WatchDraftError(
        'WATCH_DRAFT_NOT_SAVABLE',
        409,
        'A saved watch draft cannot be cancelled. Pause or archive the resulting watch rule instead.'
      );
    }

    if (draft.status === 'CANCELLED') return draft;

    return watchStore.updateDraft(
      params.accountId,
      draft.id,
      { status: 'CANCELLED' }
    );
  }

  private resolveParsed(params: {
    accountId: string;
    instruction: string;
    parsed: ParsedWatchDraft;
  }): WatchDraft {
    const expiresAt = Date.now() + WATCH_DRAFT_TTL_MS;
    const request = params.parsed.request;

    if (request.kind === 'TIME_REACHED') {
      const condition: WatchCondition = {
        kind: 'TIME_REACHED',
        triggerAt: request.triggerAt,
        timezone: request.timezone,
      };
      const validated = watchService.validateCondition(
        params.accountId,
        condition
      );

      return watchStore.createDraft({
        accountId: params.accountId,
        instruction: params.instruction,
        status: 'PROPOSED',
        parserSource: params.parsed.parserSource,
        proposedName: params.parsed.proposedName,
        parsedRequest: request,
        condition: validated,
        expiresAt,
      });
    }

    if (
      request.kind === 'ENTITY_NUMERIC_THRESHOLD' ||
      request.kind === 'ENTITY_DATE_WINDOW'
    ) {
      const exact = exactEntityMatches(
        params.accountId,
        request.entityType,
        request.entityReference
      );

      if (exact.length === 1) {
        const candidate: WatchDraftCandidate = {
          key: exact[0].id,
          kind: 'ENTITY',
          label: exact[0].canonicalName,
          entityId: exact[0].id,
          reason: 'Exact entity match.',
        };
        const condition = this.conditionFromCandidate(
          params.accountId,
          request,
          candidate
        );
        const validated = watchService.validateCondition(
          params.accountId,
          condition
        );

        return watchStore.createDraft({
          accountId: params.accountId,
          instruction: params.instruction,
          status: 'PROPOSED',
          parserSource: params.parsed.parserSource,
          proposedName: params.parsed.proposedName,
          parsedRequest: request,
          condition: validated,
          expiresAt,
        });
      }

      const candidates =
        exact.length > 1
          ? exact.map((entity) => ({
              key: entity.id,
              kind: 'ENTITY' as const,
              label: entity.canonicalName,
              entityId: entity.id,
              reason: 'Multiple entities share this exact name or alias.',
            }))
          : entityCandidates(
              params.accountId,
              request.entityType,
              request.entityReference
            );

      return watchStore.createDraft({
        accountId: params.accountId,
        instruction: params.instruction,
        status: 'NEEDS_INPUT',
        parserSource: params.parsed.parserSource,
        proposedName: params.parsed.proposedName,
        parsedRequest: request,
        candidates,
        needsInputReason:
          candidates.length > 0
            ? 'The watched entity is ambiguous. Choose the intended target.'
            : 'No matching ' +
              request.entityType.toLowerCase() +
              ' was found for "' +
              request.entityReference +
              '".',
        expiresAt,
      });
    }

    const candidates = outstandingDatasetCandidates(
      params.accountId
    );

    if (candidates.length === 1) {
      const condition = this.conditionFromCandidate(
        params.accountId,
        request,
        candidates[0]
      );
      const validated = watchService.validateCondition(
        params.accountId,
        condition
      );

      return watchStore.createDraft({
        accountId: params.accountId,
        instruction: params.instruction,
        status: 'PROPOSED',
        parserSource: params.parsed.parserSource,
        proposedName: params.parsed.proposedName,
        parsedRequest: request,
        condition: validated,
        expiresAt,
      });
    }

    return watchStore.createDraft({
      accountId: params.accountId,
      instruction: params.instruction,
      status: 'NEEDS_INPUT',
      parserSource: params.parsed.parserSource,
      proposedName: params.parsed.proposedName,
      parsedRequest: request,
      candidates,
      needsInputReason:
        candidates.length > 0
          ? 'Multiple datasets can represent outstanding balances. Choose which source this watch should monitor.'
          : 'No current dataset exposes a numeric outstanding/balance column.',
      expiresAt,
    });
  }

  private conditionFromCandidate(
    accountId: string,
    request: ParsedWatchRequest,
    candidate: WatchDraftCandidate
  ): WatchCondition {
    if (
      request.kind === 'ENTITY_NUMERIC_THRESHOLD' ||
      request.kind === 'ENTITY_DATE_WINDOW'
    ) {
      if (
        candidate.kind !== 'ENTITY' ||
        !candidate.entityId
      ) {
        throw new WatchDraftError(
          'WATCH_DRAFT_TARGET_INVALID',
          422,
          'This candidate is not a valid entity target.'
        );
      }

      companyKnowledgeStore.requireEntity(
        accountId,
        candidate.entityId
      );

      if (request.kind === 'ENTITY_DATE_WINDOW') {
        return {
          kind: 'ENTITY_DATE_WINDOW',
          entityId: candidate.entityId,
          predicate: request.predicate,
          daysBefore: request.daysBefore,
        };
      }

      return {
        kind: 'ENTITY_NUMERIC_THRESHOLD',
        entityId: candidate.entityId,
        predicate: request.predicate,
        operator: request.operator,
        threshold: request.threshold,
      };
    }

    if (request.kind !== 'DATASET_AGGREGATE_THRESHOLD') {
      throw new WatchDraftError(
        'WATCH_DRAFT_TARGET_INVALID',
        422,
        'This watch intent does not use a selectable dataset target.'
      );
    }

    if (
      candidate.kind !== 'DATASET_TABLE' ||
      !candidate.datasetId ||
      !candidate.tableName
    ) {
      throw new WatchDraftError(
        'WATCH_DRAFT_TARGET_INVALID',
        422,
        'This candidate is not a valid dataset target.'
      );
    }

    const version = datasetStore.getCurrentVersion(
      accountId,
      candidate.datasetId
    );
    const table = version.tables.find(
      (item) => item.name === candidate.tableName
    );
    if (!table) {
      throw new WatchDraftError(
        'WATCH_DRAFT_TARGET_INVALID',
        422,
        'The selected dataset table no longer exists.'
      );
    }

    const best = table.columns
      .map((column) => ({
        column,
        score: balanceColumnScore(column.normalizedName || column.name),
      }))
      .filter(
        (entry) =>
          entry.score > 0 &&
          ['INTEGER', 'DECIMAL', 'CURRENCY'].includes(
            entry.column.inferredType
          )
      )
      .sort((left, right) => right.score - left.score)[0];

    if (!best) {
      throw new WatchDraftError(
        'WATCH_DRAFT_TARGET_INVALID',
        422,
        'The selected dataset no longer exposes a usable outstanding/balance column.'
      );
    }

    return {
      kind: 'DATASET_AGGREGATE_THRESHOLD',
      datasetId: candidate.datasetId,
      tableName: candidate.tableName,
      aggregate: {
        operator: 'SUM',
        column: best.column.name,
      },
      operator: request.operator,
      threshold: request.threshold,
    };
  }
}

export const watchDraftService = new WatchDraftService();
