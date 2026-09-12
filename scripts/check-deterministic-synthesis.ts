import { knowledgeCognitiveEngine } from '../server/cognitiveEngine/knowledgeCognitiveEngine.js';
import { ChatMessage, KnowledgeDocument } from '../src/types.js';

const documents: KnowledgeDocument[] = [
  {
    id: 'synthesis-policy-doc',
    filename: 'policy.pdf',
    fileType: 'application/pdf',
    fileSize: 4096,
    uploadTimestamp: 1,
    processingStatus: 'processed',
    pageCount: 1,
    summary: 'Leave and remote work policy.',
    pages: [{
      pageNumber: 1,
      text: `# PEOPLE POLICY\n\nAnnual Leave: Full-time employees receive 24 paid annual-leave days per calendar year.\nRemote Work: Eligible employees may work remotely up to 3 days per week.`,
    }],
  },
  {
    id: 'synthesis-office-doc',
    filename: 'office.pdf',
    fileType: 'application/pdf',
    fileSize: 4096,
    uploadTimestamp: 2,
    processingStatus: 'processed',
    pageCount: 1,
    summary: 'Office directory.',
    pages: [{
      pageNumber: 1,
      text: `# OFFICE DIRECTORY\n\nOffice Staffing Table\n| Office | Country | Employees | Opened |\n| --- | --- | --- | --- |\n| Harbor Point | Portugal | 84 | 2024-02-12 |\n| Summit House | Canada | 61 | 2023-09-18 |\n| Meridian Works | Japan | 43 | 2025-05-06 |`,
    }],
  },
];

const history: ChatMessage[] = [
  { id: 'u1', role: 'user', content: 'Tell me about Meridian Works.', timestamp: 1 },
  { id: 'a1', role: 'assistant', content: 'I will use the office directory.', timestamp: 2 },
];

const cases = [
  { question: 'How many paid annual-leave days do full-time employees receive?', expected: ['24'], maxLength: 180 },
  { question: 'Which country is Meridian Works located in?', expected: ['Meridian Works', 'Japan'], maxLength: 120 },
  { question: 'How many employees does it have?', expected: ['43'], maxLength: 120, chatHistory: history },
];

for (const testCase of cases) {
  const result = await knowledgeCognitiveEngine.answerQuestion({
    question: testCase.question,
    chatHistory: testCase.chatHistory || [],
    tenantId: 'deterministic_synthesis_test_tenant',
    knowledgeBaseId: 'deterministic_synthesis_test_kb',
    documents,
    forceDeterministic: true,
  });

  const answer = result.answer.trim();
  for (const expected of testCase.expected) {
    if (!answer.toLowerCase().includes(expected.toLowerCase())) {
      throw new Error(`Expected answer to contain ${expected}; got: ${answer}`);
    }
  }
  if (answer.length > testCase.maxLength) {
    throw new Error(`Deterministic answer is too verbose (${answer.length} chars): ${answer}`);
  }
  if (answer.includes('| ---') || answer.split('\n').length > 3) {
    throw new Error(`Deterministic answer dumped source/table content: ${answer}`);
  }
  if (!result.diagnosticTrace.allClaimsSupported || result.diagnosticTrace.groundingScore !== 1) {
    throw new Error(`Deterministic answer lost grounding: ${answer}`);
  }
}

console.log('Deterministic synthesis guard passed: concise direct fact, table lookup, and follow-up answers are grounded.');
