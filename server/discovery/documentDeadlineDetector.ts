import crypto from 'crypto';
import { KnowledgeBase } from '../../src/types.js';
import { prioritizeInsight } from './prioritization.js';
import {
  DocumentDetectorContext,
  Insight,
  InsightSeverity,
} from './types.js';

export const DOCUMENT_DEADLINE_DETECTOR_ID = 'document.deadline';
export const DOCUMENT_DEADLINE_DETECTOR_VERSION = 'v1';

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const DEADLINE_SIGNAL =
  /\b(deadline|due|expires?|expiry|expiration|renewal|renew|valid until|no later than)\b/i;

function parseExplicitDates(text: string): Array<{
  timestamp: number;
  raw: string;
}> {
  const found: Array<{ timestamp: number; raw: string }> = [];

  const add = (year: number, month: number, day: number, raw: string) => {
    const timestamp = Date.UTC(year, month, day);
    const date = new Date(timestamp);
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === day
    ) {
      found.push({ timestamp, raw });
    }
  };

  const isoRegex = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  for (const match of text.matchAll(isoRegex)) {
    add(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      match[0]
    );
  }

  const monthFirstRegex =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/gi;
  for (const match of text.matchAll(monthFirstRegex)) {
    add(
      Number(match[3]),
      MONTHS[match[1].toLowerCase()],
      Number(match[2]),
      match[0]
    );
  }

  const dayFirstRegex =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi;
  for (const match of text.matchAll(dayFirstRegex)) {
    add(
      Number(match[3]),
      MONTHS[match[2].toLowerCase()],
      Number(match[1]),
      match[0]
    );
  }

  const unique = new Map<string, { timestamp: number; raw: string }>();
  for (const item of found) {
    unique.set(String(item.timestamp) + '|' + item.raw.toLowerCase(), item);
  }
  return Array.from(unique.values());
}

function severityForDays(daysUntil: number): InsightSeverity {
  if (daysUntil <= 7) return 'HIGH';
  if (daysUntil <= 30) return 'MEDIUM';
  return 'LOW';
}

function normalizeExcerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function detectDocumentDeadlines(
  context: DocumentDetectorContext,
  kb: KnowledgeBase
): Insight[] {
  const insights: Insight[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfReferenceDay = Date.UTC(
    new Date(context.referenceTime).getUTCFullYear(),
    new Date(context.referenceTime).getUTCMonth(),
    new Date(context.referenceTime).getUTCDate()
  );

  for (const document of kb.documents) {
    if (
      document.processingStatus !== 'processed' ||
      !document.pages ||
      document.pages.length === 0
    ) {
      continue;
    }

    for (const page of document.pages) {
      const fragments = page.text
        .split(/(?<=[.!?])\s+|\n+/)
        .map(normalizeExcerpt)
        .filter((fragment) => fragment.length >= 12);

      for (const fragment of fragments) {
        if (!DEADLINE_SIGNAL.test(fragment)) continue;

        const dates = parseExplicitDates(fragment);
        for (const date of dates) {
          const daysUntil = Math.ceil(
            (date.timestamp - startOfReferenceDay) / dayMs
          );
          if (daysUntil < 0 || daysUntil > 90) continue;

          const dateLabel = new Date(date.timestamp).toISOString().slice(0, 10);
          const fingerprint = crypto
            .createHash('sha256')
            .update(
              JSON.stringify([
                DOCUMENT_DEADLINE_DETECTOR_ID,
                DOCUMENT_DEADLINE_DETECTOR_VERSION,
                document.id,
                page.pageNumber,
                dateLabel,
                fragment.toLowerCase(),
              ])
            )
            .digest('hex');

          const insight: Insight = {
            id: 'ins_' + crypto.randomBytes(8).toString('hex'),
            fingerprint,
            accountId: context.accountId,
            knowledgeBaseId: context.knowledgeBaseId,
            documentId: document.id,
            analysisRunId: context.analysisRunId,
            type: 'DEADLINE',
            severity: severityForDays(daysUntil),
            status: 'OPEN',
            title:
              daysUntil === 0
                ? 'Deadline is today'
                : 'Deadline in ' + String(daysUntil) + ' days',
            summary:
              document.filename +
              ' contains an explicit deadline/date on ' +
              dateLabel +
              ': ' +
              fragment,
            confidence: 0.95,
            detectorId: DOCUMENT_DEADLINE_DETECTOR_ID,
            detectorVersion: DOCUMENT_DEADLINE_DETECTOR_VERSION,
            evidence: {
              sourceType: 'DOCUMENT',
              sourceFilename: document.filename,
              knowledgeBaseId: context.knowledgeBaseId,
              knowledgeVersionTag: context.knowledgeVersionTag,
              documentId: document.id,
              pageNumber: page.pageNumber,
              excerpt: fragment,
              detectorId: DOCUMENT_DEADLINE_DETECTOR_ID,
              detectorVersion: DOCUMENT_DEADLINE_DETECTOR_VERSION,
              calculation:
                'Find an explicit parseable calendar date in the same sentence/line as a deadline, due, expiry, renewal, or validity signal. Surface only dates from today through 90 days ahead.',
              values: {
                deadlineDate: dateLabel,
                daysUntil,
                matchedDateText: date.raw,
              },
            },
            priorityScore: 0,
            priorityReasons: [],
            firstSeenAt: context.referenceTime,
            lastSeenAt: context.referenceTime,
            occurrenceCount: 1,
            createdAt: context.referenceTime,
          };

          insights.push(prioritizeInsight(insight));
        }
      }
    }
  }

  return insights;
}
