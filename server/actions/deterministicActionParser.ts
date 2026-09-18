import { ParsedActionInput } from './types.js';

export interface DeterministicActionParse {
  matched: boolean;
  parsed?: ParsedActionInput;
  reason?: string;
}

function cleanReference(value: string): string {
  return value
    .trim()
    .replace(/^customer\s+/i, '')
    .replace(/^product\s+/i, '')
    .replace(/^order\s+/i, '')
    .replace(/[.,;!?]+$/g, '')
    .trim();
}

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

function parseDateText(raw: string | undefined, now: Date): number | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();

  if (normalized === 'today') {
    return Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
  }

  if (normalized === 'yesterday') {
    return (
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      ) -
      24 * 60 * 60 * 1000
    );
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export class DeterministicActionParser {
  public parse(
    instruction: string,
    now: Date = new Date()
  ): DeterministicActionParse {
    const clean = instruction.trim().replace(/\s+/g, ' ');
    if (!clean) {
      return { matched: false, reason: 'Instruction is empty.' };
    }

    const paymentByCustomer = clean.match(
      /^(.+?)\s+paid\s+(?:another\s+)?((?:NPR|Rs\.?|रु\.?|रू\.?)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|l|lac|lakh)?)(?:\s+(today|yesterday|on\s+.+?))?[.!]?$/i
    );
    if (paymentByCustomer) {
      const amount = parseCompactNumber(paymentByCustomer[2]);
      if (amount === null) {
        return { matched: false, reason: 'Payment amount could not be parsed.' };
      }
      const rawDateText = paymentByCustomer[3]?.replace(/^on\s+/i, '');
      return {
        matched: true,
        parsed: {
          intent: 'RECORD_PAYMENT',
          customerReference: cleanReference(paymentByCustomer[1]),
          amount,
          rawDateText,
          occurredAt: parseDateText(rawDateText, now),
        },
      };
    }

    const paymentByOrder = clean.match(
      /^(?:record\s+)?(?:a\s+)?payment\s+of\s+((?:NPR|Rs\.?|रु\.?|रू\.?)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|l|lac|lakh)?)\s+(?:for|on)\s+(?:order\s+)?([A-Za-z0-9._\/-]+)(?:\s+(today|yesterday|on\s+.+?))?[.!]?$/i
    );
    if (paymentByOrder) {
      const amount = parseCompactNumber(paymentByOrder[1]);
      if (amount === null) {
        return { matched: false, reason: 'Payment amount could not be parsed.' };
      }
      const rawDateText = paymentByOrder[3]?.replace(/^on\s+/i, '');
      return {
        matched: true,
        parsed: {
          intent: 'RECORD_PAYMENT',
          orderReference: cleanReference(paymentByOrder[2]),
          amount,
          rawDateText,
          occurredAt: parseDateText(rawDateText, now),
        },
      };
    }

    const paymentReceived = clean.match(
      /^(?:we\s+)?received\s+((?:NPR|Rs\.?|रु\.?|रू\.?)?\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|m|l|lac|lakh)?)\s+from\s+(.+?)(?:\s+(today|yesterday|on\s+.+?))?[.!]?$/i
    );
    if (paymentReceived) {
      const amount = parseCompactNumber(paymentReceived[1]);
      if (amount === null) {
        return { matched: false, reason: 'Payment amount could not be parsed.' };
      }
      const rawDateText = paymentReceived[3]?.replace(/^on\s+/i, '');
      return {
        matched: true,
        parsed: {
          intent: 'RECORD_PAYMENT',
          customerReference: cleanReference(paymentReceived[2]),
          amount,
          rawDateText,
          occurredAt: parseDateText(rawDateText, now),
        },
      };
    }

    const inventoryReceived = clean.match(
      /^(?:we\s+)?received\s+([0-9]+(?:\.[0-9]+)?)\s+(?:units?\s+of\s+)?(.+?)(?:\s+(today|yesterday|on\s+.+?))?[.!]?$/i
    );
    if (inventoryReceived) {
      const quantity = Number(inventoryReceived[1]);
      const rawDateText = inventoryReceived[3]?.replace(/^on\s+/i, '');
      return {
        matched: true,
        parsed: {
          intent: 'RECEIVE_INVENTORY',
          productReference: cleanReference(inventoryReceived[2]),
          quantity,
          rawDateText,
          occurredAt: parseDateText(rawDateText, now),
        },
      };
    }

    const statusUpdate = clean.match(
      /^(?:mark|set|change)\s+(?:order\s+)?([A-Za-z0-9._\/-]+)(?:\s+status)?\s+(?:as|to)\s+([A-Za-z][A-Za-z _-]*?)[.!]?$/i
    );
    if (statusUpdate) {
      return {
        matched: true,
        parsed: {
          intent: 'UPDATE_STATUS',
          orderReference: cleanReference(statusUpdate[1]),
          status: statusUpdate[2].trim().toUpperCase().replace(/\s+/g, '_'),
        },
      };
    }

    return {
      matched: false,
      reason: 'No deterministic action pattern matched.',
    };
  }
}

export const deterministicActionParser = new DeterministicActionParser();
