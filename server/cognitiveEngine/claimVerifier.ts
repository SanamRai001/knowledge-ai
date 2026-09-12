/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generic claim verifier for evidence-grounded answers.
 */

import { Citation } from '../../src/types.js';
import {
  HierarchicalChunk,
  ClaimVerificationItem,
  QuestionUnderstandingProfile,
} from './types.js';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'than', 'are', 'was', 'were',
  'has', 'have', 'had', 'its', 'their', 'there', 'based', 'according', 'document', 'documents',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%.-\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function numbers(text: string): string[] {
  return text.match(/-?\b\d+(?:\.\d+)?\b/g) || [];
}

function isRefusal(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'not enough evidence',
    'insufficient evidence',
    "couldn't find enough evidence",
    'cannot answer',
    'not documented',
    'not present in the uploaded documents',
    'cannot follow instructions that attempt to bypass',
  ].some((phrase) => lower.includes(phrase));
}

export class ClaimVerificationEngine {
  public verifyAnswerClaims(
    answerText: string,
    evidenceChunks: HierarchicalChunk[],
    profile: QuestionUnderstandingProfile
  ): {
    claims: ClaimVerificationItem[];
    allClaimsSupported: boolean;
    groundingScore: number;
    contradictionsFound: number;
    citations: Citation[];
  } {
    const sentences = answerText
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 5);

    const claims: ClaimVerificationItem[] = [];
    const citationMap = new Map<string, Citation>();
    let contradictionsFound = 0;

    for (let index = 0; index < sentences.length; index++) {
      const sentence = sentences[index];
      const sentenceTokens = tokens(sentence);
      const sentenceNumbers = numbers(sentence);
      let bestChunk: HierarchicalChunk | undefined;
      let bestOverlap = 0;
      let numbersSupported = sentenceNumbers.length === 0;

      for (const chunk of evidenceChunks) {
        const chunkLower = chunk.text.toLowerCase();
        const overlap = sentenceTokens.length
          ? sentenceTokens.filter((token) => chunkLower.includes(token)).length / sentenceTokens.length
          : 1;
        const chunkNumbers = numbers(chunk.text);
        const allNumbersPresent = sentenceNumbers.every((value) => chunkNumbers.includes(value));
        if (allNumbersPresent) numbersSupported = true;

        const score = overlap + (allNumbersPresent && sentenceNumbers.length ? 0.25 : 0);
        if (score > bestOverlap) {
          bestOverlap = score;
          bestChunk = chunk;
        }
      }

      const refusal = isRefusal(sentence);
      const supported = refusal
        ? true
        : Boolean(bestChunk) && numbersSupported && bestOverlap >= 0.4;

      if (
        profile.userCorrectionAssertion &&
        sentence.includes(profile.userCorrectionAssertion) &&
        !/\b(not|incorrect|wrong|rather than|instead)\b/i.test(sentence)
      ) {
        contradictionsFound += 1;
      }

      const supportingChunkIds = supported && bestChunk && !refusal ? [bestChunk.chunkId] : [];
      if (bestChunk && supported && !refusal) {
        const key = `${bestChunk.documentId}:${bestChunk.pageNumber}:${bestChunk.chunkId}`;
        citationMap.set(key, {
          documentId: bestChunk.documentId,
          documentName: bestChunk.documentName,
          pageNumber: bestChunk.pageNumber,
          sectionHeading: bestChunk.sectionTitle,
          snippet: bestChunk.text.slice(0, 240),
        });
      }

      claims.push({
        claimId: `claim_${index + 1}`,
        claimText: sentence,
        isSupported: supported,
        confidence: supported ? Math.min(0.99, 0.6 + bestOverlap * 0.35) : Math.max(0.1, bestOverlap * 0.4),
        supportingChunkIds,
        contradictedByChunkIds: [],
        explanation: refusal
          ? 'The answer abstains rather than introducing an unsupported factual claim.'
          : supported && bestChunk
            ? `Supported by ${bestChunk.documentName}, page ${bestChunk.pageNumber}, section ${bestChunk.sectionTitle}.`
            : 'No retrieved evidence chunk sufficiently supports this claim.',
        temporalStatus: 'ALIGNED',
      });
    }

    const supportedCount = claims.filter((claim) => claim.isSupported).length;
    const groundingScore = claims.length ? supportedCount / claims.length : 1;
    const citations = Array.from(citationMap.values());

    if (citations.length === 0 && evidenceChunks.length > 0 && !isRefusal(answerText) && !profile.isAdversarial) {
      const top = evidenceChunks[0];
      citations.push({
        documentId: top.documentId,
        documentName: top.documentName,
        pageNumber: top.pageNumber,
        sectionHeading: top.sectionTitle,
        snippet: top.text.slice(0, 240),
      });
    }

    return {
      claims,
      allClaimsSupported: supportedCount === claims.length && contradictionsFound === 0,
      groundingScore,
      contradictionsFound,
      citations,
    };
  }
}

export const claimVerificationEngine = new ClaimVerificationEngine();
