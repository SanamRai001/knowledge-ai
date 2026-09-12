/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Deterministic evidence-only answer synthesis for provider outages and explicit
 * no-model runs. It extracts the smallest useful answer from retrieved evidence
 * instead of returning whole chunks verbatim.
 */

import { QuestionUnderstandingProfile, RerankedEvidenceItem } from './types.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'of', 'to', 'in', 'on', 'at',
  'for', 'from', 'with', 'and', 'or', 'but', 'as', 'by', 'what', 'which', 'who', 'where', 'when', 'why',
  'how', 'many', 'much', 'does', 'do', 'did', 'has', 'have', 'had', 'it', 'its', 'this', 'that', 'these',
  'those', 'about', 'tell', 'me', 'please', 'located', 'company', 'document', 'documents',
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}%$.-]+/gu, ' ').trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function cleanCell(value: string): string {
  return value.replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cleanCell);
}

function isDividerRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function tableLookup(
  question: string,
  profile: QuestionUnderstandingProfile,
  evidence: RerankedEvidenceItem[]
): string | null {
  const questionTokens = unique([
    ...tokens(question),
    ...(profile.entities || []).flatMap(tokens),
    ...(profile.attributes || []).flatMap(tokens),
  ]);

  type Match = { answer: string; score: number };
  const matches: Match[] = [];

  for (const item of evidence.slice(0, 6)) {
    const lines = item.chunk.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    for (let i = 0; i < lines.length - 2; i++) {
      if (!lines[i].startsWith('|') || !lines[i + 1].startsWith('|')) continue;
      const headers = parseTableRow(lines[i]);
      const divider = parseTableRow(lines[i + 1]);
      if (!isDividerRow(divider) || headers.length < 2) continue;

      const rows: string[][] = [];
      let cursor = i + 2;
      while (cursor < lines.length && lines[cursor].startsWith('|')) {
        const row = parseTableRow(lines[cursor]);
        if (row.length === headers.length && !isDividerRow(row)) rows.push(row);
        cursor += 1;
      }

      const columnScores = headers.map((header, index) => {
        const headerTokens = tokens(header);
        const overlap = headerTokens.filter((token) => questionTokens.includes(token)).length;
        return { index, header, score: overlap * 4 + (normalize(question).includes(normalize(header)) ? 5 : 0) };
      });
      const requestedColumn = columnScores.sort((a, b) => b.score - a.score)[0];
      if (!requestedColumn || requestedColumn.score <= 0) continue;

      for (const row of rows) {
        const rowText = row.join(' ');
        const rowTokens = tokens(rowText);
        const entityMatches = (profile.entities || []).filter((entity) =>
          normalize(rowText).includes(normalize(entity))
        ).length;
        const tokenMatches = questionTokens.filter((token) => rowTokens.includes(token)).length;
        const score = entityMatches * 10 + tokenMatches * 2 + requestedColumn.score;
        if (score <= requestedColumn.score) continue;

        const label = row[0] || 'Result';
        const value = row[requestedColumn.index];
        if (!value || value === label) continue;
        matches.push({
          answer: `${label}: ${requestedColumn.header} is ${value}.`,
          score,
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.answer || null;
}

function sentenceCandidates(text: string): string[] {
  const withoutTables = text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('|')) return false;
      if (/^#{1,6}\s/.test(trimmed)) return false;
      if (/^(structured table|section|specification):/i.test(trimmed)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withoutTables
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 420);
}

function sentenceLookup(
  question: string,
  profile: QuestionUnderstandingProfile,
  evidence: RerankedEvidenceItem[]
): string | null {
  const questionTokens = unique(tokens(question));
  const entityTokens = unique((profile.entities || []).flatMap(tokens));
  const attributeTokens = unique((profile.attributes || []).flatMap(tokens));

  const candidates = evidence.slice(0, 6).flatMap((item, evidenceIndex) =>
    sentenceCandidates(item.chunk.text).map((sentence) => {
      const sentenceTokens = tokens(sentence);
      const questionOverlap = questionTokens.filter((token) => sentenceTokens.includes(token)).length;
      const entityOverlap = entityTokens.filter((token) => sentenceTokens.includes(token)).length;
      const attributeOverlap = attributeTokens.filter((token) => sentenceTokens.includes(token)).length;
      const score = questionOverlap * 3 + entityOverlap * 5 + attributeOverlap * 4 - evidenceIndex * 0.15;
      return { sentence, score };
    })
  );

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score <= 0) return null;
  return best.sentence;
}

export function deterministicSynthesizer(
  profile: QuestionUnderstandingProfile,
  rerankedItems: RerankedEvidenceItem[]
): string {
  const evidence = rerankedItems.slice(0, 6);
  if (!evidence.length) {
    return "I couldn't find enough evidence in the uploaded documents to answer that reliably.";
  }

  const question = profile.normalizedQuestion;
  const tableAnswer = tableLookup(question, profile, evidence);
  if (tableAnswer) return tableAnswer;

  const sentenceAnswer = sentenceLookup(question, profile, evidence);
  if (sentenceAnswer) return sentenceAnswer;

  const fallback = sentenceCandidates(evidence[0].chunk.text)[0];
  if (fallback) return fallback;

  const compact = evidence[0].chunk.text.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 280).trim();
}
