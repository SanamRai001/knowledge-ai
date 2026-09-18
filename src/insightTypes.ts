export type InsightType =
  | 'RISK'
  | 'OPPORTUNITY'
  | 'CHANGE'
  | 'DEADLINE'
  | 'ANOMALY'
  | 'DATA_QUALITY';

export type InsightSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type InsightStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface InsightRowReference {
  rowIndex: number;
  values: Record<string, string | number | boolean | null>;
}

export interface InsightEvidence {
  sourceType: 'DATASET' | 'DOCUMENT';
  sourceFilename: string;
  sourceSha256?: string;
  datasetId?: string;
  datasetVersionId?: string;
  datasetVersionNumber?: number;
  tableId?: string;
  tableName?: string;
  knowledgeBaseId?: string;
  knowledgeVersionTag?: string;
  documentId?: string;
  pageNumber?: number;
  excerpt?: string;
  detectorId: string;
  detectorVersion: string;
  calculation: string;
  values: Record<string, string | number | boolean | null>;
  rowReferences?: InsightRowReference[];
}

export interface Insight {
  id: string;
  fingerprint: string;
  accountId: string;
  datasetId?: string;
  datasetVersionId?: string;
  knowledgeBaseId?: string;
  documentId?: string;
  analysisRunId: string;
  type: InsightType;
  severity: InsightSeverity;
  status: InsightStatus;
  title: string;
  summary: string;
  confidence: number;
  detectorId: string;
  detectorVersion: string;
  evidence: InsightEvidence;
  priorityScore: number;
  priorityReasons: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  statusUpdatedAt?: number;
  createdAt: number;
}

export interface AnalysisRun {
  id: string;
  accountId: string;
  sourceType: 'DATASET' | 'DOCUMENT';
  datasetId?: string;
  datasetVersionId?: string;
  knowledgeBaseId?: string;
  knowledgeVersionTag?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: number;
  completedAt?: number;
  referenceTime: number;
  detectorIds: string[];
  insightIds: string[];
  error?: string;
}
