import { providerRouter } from '../providers/providerRouter.js';
import { deterministicActionParser } from './deterministicActionParser.js';
import {
  ActionProposalError,
  actionProposalService,
} from './actionProposalService.js';
import { ActionInterpretationResult, ParsedActionInput } from './types.js';

type LlmActionExtraction = {
  intent?: string;
  customerReference?: unknown;
  orderReference?: unknown;
  productReference?: unknown;
  amount?: unknown;
  quantity?: unknown;
  status?: unknown;
  rawDateText?: unknown;
};

const ALLOWED_INTENTS = new Set([
  'RECORD_PAYMENT',
  'RECEIVE_INVENTORY',
  'UPDATE_STATUS',
]);

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean || undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function validateLlmExtraction(raw: unknown): ParsedActionInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = raw as LlmActionExtraction;
  const intent =
    typeof parsed.intent === 'string'
      ? parsed.intent.trim().toUpperCase()
      : '';

  if (!ALLOWED_INTENTS.has(intent)) return null;

  const output: ParsedActionInput = {
    intent: intent as ParsedActionInput['intent'],
    customerReference: optionalString(parsed.customerReference),
    orderReference: optionalString(parsed.orderReference),
    productReference: optionalString(parsed.productReference),
    amount: optionalFiniteNumber(parsed.amount),
    quantity: optionalFiniteNumber(parsed.quantity),
    status: optionalString(parsed.status)?.toUpperCase().replace(/\s+/g, '_'),
    rawDateText: optionalString(parsed.rawDateText),
  };

  if (
    output.intent === 'RECORD_PAYMENT' &&
    (!output.amount ||
      (!output.customerReference && !output.orderReference))
  ) {
    return null;
  }

  if (
    output.intent === 'RECEIVE_INVENTORY' &&
    (!output.quantity || !output.productReference)
  ) {
    return null;
  }

  if (
    output.intent === 'UPDATE_STATUS' &&
    (!output.orderReference || !output.status)
  ) {
    return null;
  }

  return output;
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

export class ActionInterpretationError extends Error {
  public readonly statusCode: number;
  public readonly code:
    | 'ACTION_UNRECOGNIZED'
    | 'ACTION_LLM_UNAVAILABLE'
    | 'ACTION_LLM_INVALID';

  constructor(
    code:
      | 'ACTION_UNRECOGNIZED'
      | 'ACTION_LLM_UNAVAILABLE'
      | 'ACTION_LLM_INVALID',
    statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ActionInterpretationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class HybridActionInterpreter {
  public async interpret(params: {
    accountId: string;
    instruction: string;
    allowLlmParsing?: boolean;
    now?: Date;
  }): Promise<ActionInterpretationResult> {
    const instruction = params.instruction.trim();
    if (!instruction) {
      throw new ActionInterpretationError(
        'ACTION_UNRECOGNIZED',
        400,
        'Action instruction is required.'
      );
    }
    if (instruction.length > 2000) {
      throw new ActionInterpretationError(
        'ACTION_UNRECOGNIZED',
        400,
        'Action instruction exceeds 2000 characters.'
      );
    }

    const deterministic = deterministicActionParser.parse(
      instruction,
      params.now || new Date()
    );

    if (deterministic.matched && deterministic.parsed) {
      return {
        proposal: actionProposalService.createFromParsed({
          accountId: params.accountId,
          instruction,
          parsed: deterministic.parsed,
          parserSource: 'DETERMINISTIC',
          now: params.now?.getTime(),
        }),
        effectiveParser: 'DETERMINISTIC',
      };
    }

    if (params.allowLlmParsing === false) {
      throw new ActionInterpretationError(
        'ACTION_UNRECOGNIZED',
        422,
        deterministic.reason ||
          'This update did not match a supported deterministic action.'
      );
    }

    const provider = providerRouter.getPrimaryProvider();
    if (!provider?.isConfigured()) {
      throw new ActionInterpretationError(
        'ACTION_LLM_UNAVAILABLE',
        422,
        'This wording did not match a deterministic action pattern, and the configured language provider is unavailable. Rephrase as a payment, inventory receipt, or order status update.'
      );
    }

    const generated = await providerRouter.generate({
      responseFormat: 'json',
      temperature: 0,
      systemInstruction:
        'You are a bounded parser for business update commands. Extract only information explicitly present in the user instruction. Never calculate balances, stock, totals, paid amounts, or effects. Never resolve entities. Never execute an action. Return one JSON object and nothing else.',
      prompt: [
        'Allowed intents:',
        '- RECORD_PAYMENT',
        '- RECEIVE_INVENTORY',
        '- UPDATE_STATUS',
        '- UNSUPPORTED',
        '',
        'Return exactly these possible fields:',
        '{',
        '  "intent": "RECORD_PAYMENT | RECEIVE_INVENTORY | UPDATE_STATUS | UNSUPPORTED",',
        '  "customerReference": "string if explicitly mentioned",',
        '  "orderReference": "string if explicitly mentioned",',
        '  "productReference": "string if explicitly mentioned",',
        '  "amount": 123.45,',
        '  "quantity": 20,',
        '  "status": "PAID",',
        '  "rawDateText": "exact date phrase if explicitly mentioned"',
        '}',
        '',
        'Rules:',
        '- Do not infer an order from a customer.',
        '- Do not infer a product from context not present in the instruction.',
        '- Convert clear amount shorthand such as 10k to 10000.',
        '- Keep date wording as rawDateText; do not calculate a timestamp.',
        '- If the command is not one of the three allowed actions, use UNSUPPORTED.',
        '- If required information is absent, use UNSUPPORTED.',
        '',
        'User instruction:',
        instruction,
      ].join('\n'),
    });

    if (!generated.ok) {
      throw new ActionInterpretationError(
        'ACTION_LLM_UNAVAILABLE',
        422,
        'The language parser could not interpret this update safely. Rephrase it as a payment, inventory receipt, or order status update.'
      );
    }

    const parsed = validateLlmExtraction(parseJsonObject(generated.text));
    if (!parsed) {
      throw new ActionInterpretationError(
        'ACTION_LLM_INVALID',
        422,
        'The language model did not return a valid supported action. Nothing was written.'
      );
    }

    try {
      return {
        proposal: actionProposalService.createFromParsed({
          accountId: params.accountId,
          instruction,
          parsed,
          parserSource: 'LLM_ASSISTED',
          now: params.now?.getTime(),
        }),
        effectiveParser: 'LLM_ASSISTED',
      };
    } catch (error) {
      if (error instanceof ActionProposalError) throw error;
      throw error;
    }
  }
}

export const hybridActionInterpreter = new HybridActionInterpreter();
