import type { PoolClient } from 'pg';
import type {
  AnalysisRun,
  Insight,
  InsightStatus,
} from '../discovery/types.js';
import {
  postgresPool,
  withTransaction,
} from './postgres.js';
import type { DiscoveryRepository } from './a6Types.js';

function epoch(value: Date | string | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error('PostgreSQL returned an invalid timestamp.');
  }
  return parsed;
}

function date(value: number | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function runInsightIds(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  runId: string
): Promise<string[]> {
  const result = await client.query(
    `SELECT insight_id
     FROM discovery_analysis_run_insights
     WHERE account_id = $1 AND analysis_run_id = $2
     ORDER BY position ASC`,
    [accountId, runId]
  );
  return result.rows.map((row) => row.insight_id);
}

async function runFromRow(
  client: Pick<PoolClient, 'query'>,
  row: any
): Promise<AnalysisRun> {
  return {
    id: row.id,
    accountId: row.account_id,
    sourceType: row.source_type,
    datasetId: row.dataset_id ?? undefined,
    datasetVersionId: row.dataset_version_id ?? undefined,
    knowledgeBaseId: row.workspace_id ?? undefined,
    knowledgeVersionTag: row.knowledge_version_tag ?? undefined,
    status: row.status,
    startedAt: epoch(row.started_at)!,
    completedAt: epoch(row.completed_at) ?? undefined,
    referenceTime: epoch(row.reference_time)!,
    detectorIds: row.detector_ids || [],
    detectorRegistrations:
      row.detector_registrations ?? undefined,
    insightIds: await runInsightIds(
      client,
      row.account_id,
      row.id
    ),
    error: row.error ?? undefined,
  };
}

function insightFromRow(row: any): Insight {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    accountId: row.account_id,
    datasetId: row.dataset_id ?? undefined,
    datasetVersionId: row.dataset_version_id ?? undefined,
    knowledgeBaseId: row.workspace_id ?? undefined,
    documentId: row.document_id ?? undefined,
    analysisRunId: row.latest_analysis_run_id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    summary: row.summary,
    confidence: Number(row.confidence),
    detectorId: row.detector_id,
    detectorVersion: row.detector_version,
    evidence: row.evidence,
    priorityScore: Number(row.priority_score),
    priorityReasons: row.priority_reasons || [],
    firstSeenAt: epoch(row.first_seen_at)!,
    lastSeenAt: epoch(row.last_seen_at)!,
    occurrenceCount: row.occurrence_count,
    statusUpdatedAt:
      epoch(row.status_updated_at) ?? undefined,
    createdAt: epoch(row.created_at)!,
  };
}

async function assertOwnedUpsert(
  result: { rowCount: number | null },
  label: string
): Promise<void> {
  if (result.rowCount) return;
  throw new Error(
    label +
      ' identity/ownership conflict: existing row does not match immutable source ownership.'
  );
}

async function saveRunWith(
  client: Pick<PoolClient, 'query'>,
  run: AnalysisRun
): Promise<void> {
  const result = await client.query(
    `INSERT INTO discovery_analysis_runs
      (id, account_id, source_type, dataset_id, dataset_version_id,
       workspace_id, knowledge_version_tag, status, started_at,
       completed_at, reference_time, detector_ids,
       detector_registrations, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       completed_at = EXCLUDED.completed_at,
       detector_ids = EXCLUDED.detector_ids,
       detector_registrations = EXCLUDED.detector_registrations,
       error = EXCLUDED.error
     WHERE discovery_analysis_runs.account_id = EXCLUDED.account_id
       AND discovery_analysis_runs.source_type = EXCLUDED.source_type
       AND discovery_analysis_runs.dataset_id IS NOT DISTINCT FROM EXCLUDED.dataset_id
       AND discovery_analysis_runs.dataset_version_id IS NOT DISTINCT FROM EXCLUDED.dataset_version_id
       AND discovery_analysis_runs.workspace_id IS NOT DISTINCT FROM EXCLUDED.workspace_id
       AND discovery_analysis_runs.knowledge_version_tag IS NOT DISTINCT FROM EXCLUDED.knowledge_version_tag
       AND discovery_analysis_runs.started_at = EXCLUDED.started_at
       AND discovery_analysis_runs.reference_time = EXCLUDED.reference_time
     RETURNING id`,
    [
      run.id,
      run.accountId,
      run.sourceType,
      run.datasetId ?? null,
      run.datasetVersionId ?? null,
      run.knowledgeBaseId ?? null,
      run.knowledgeVersionTag ?? null,
      run.status,
      new Date(run.startedAt),
      date(run.completedAt),
      new Date(run.referenceTime),
      run.detectorIds,
      run.detectorRegistrations
        ? json(run.detectorRegistrations)
        : null,
      run.error ?? null,
    ]
  );
  await assertOwnedUpsert(result, 'AnalysisRun');
}

async function saveInsightWith(
  client: Pick<PoolClient, 'query'>,
  insight: Insight
): Promise<void> {
  const result = await client.query(
    `INSERT INTO discovery_insights
      (id, account_id, fingerprint, dataset_id, dataset_version_id,
       workspace_id, document_id, latest_analysis_run_id, type, severity,
       status, title, summary, confidence, detector_id, detector_version,
       evidence, priority_score, priority_reasons, first_seen_at,
       last_seen_at, occurrence_count, status_updated_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             $17::jsonb,$18,$19,$20,$21,$22,$23,$24)
     ON CONFLICT (id) DO UPDATE SET
       latest_analysis_run_id = EXCLUDED.latest_analysis_run_id,
       type = EXCLUDED.type,
       severity = EXCLUDED.severity,
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       confidence = EXCLUDED.confidence,
       detector_id = EXCLUDED.detector_id,
       detector_version = EXCLUDED.detector_version,
       evidence = EXCLUDED.evidence,
       priority_score = EXCLUDED.priority_score,
       priority_reasons = EXCLUDED.priority_reasons,
       first_seen_at = EXCLUDED.first_seen_at,
       last_seen_at = EXCLUDED.last_seen_at,
       occurrence_count = EXCLUDED.occurrence_count,
       status_updated_at = EXCLUDED.status_updated_at,
       created_at = EXCLUDED.created_at
     WHERE discovery_insights.account_id = EXCLUDED.account_id
       AND discovery_insights.fingerprint = EXCLUDED.fingerprint
       AND discovery_insights.dataset_id IS NOT DISTINCT FROM EXCLUDED.dataset_id
       AND discovery_insights.dataset_version_id IS NOT DISTINCT FROM EXCLUDED.dataset_version_id
       AND discovery_insights.workspace_id IS NOT DISTINCT FROM EXCLUDED.workspace_id
       AND discovery_insights.document_id IS NOT DISTINCT FROM EXCLUDED.document_id
     RETURNING id`,
    [
      insight.id,
      insight.accountId,
      insight.fingerprint,
      insight.datasetId ?? null,
      insight.datasetVersionId ?? null,
      insight.knowledgeBaseId ?? null,
      insight.documentId ?? null,
      insight.analysisRunId,
      insight.type,
      insight.severity,
      insight.status,
      insight.title,
      insight.summary,
      insight.confidence,
      insight.detectorId,
      insight.detectorVersion,
      json(insight.evidence),
      insight.priorityScore,
      insight.priorityReasons,
      new Date(insight.firstSeenAt),
      new Date(insight.lastSeenAt),
      insight.occurrenceCount,
      date(insight.statusUpdatedAt),
      new Date(insight.createdAt),
    ]
  );
  await assertOwnedUpsert(result, 'Insight');
}

async function replaceRunInsightIdsWith(
  client: Pick<PoolClient, 'query'>,
  accountId: string,
  runId: string,
  insightIds: string[]
): Promise<void> {
  const ownedRun = await client.query(
    `SELECT 1
     FROM discovery_analysis_runs
     WHERE account_id = $1 AND id = $2
     FOR UPDATE`,
    [accountId, runId]
  );
  if (!ownedRun.rowCount) {
    throw new Error(
      'AnalysisRun not found in the current account scope.'
    );
  }

  await client.query(
    `DELETE FROM discovery_analysis_run_insights
     WHERE account_id = $1 AND analysis_run_id = $2`,
    [accountId, runId]
  );

  for (let index = 0; index < insightIds.length; index += 1) {
    const insightId = insightIds[index];
    const ownedInsight = await client.query(
      `SELECT 1
       FROM discovery_insights
       WHERE account_id = $1 AND id = $2`,
      [accountId, insightId]
    );
    if (!ownedInsight.rowCount) {
      throw new Error(
        'Insight ' +
          insightId +
          ' is not owned by the AnalysisRun account.'
      );
    }

    await client.query(
      `INSERT INTO discovery_analysis_run_insights
        (account_id, analysis_run_id, insight_id, position)
       VALUES ($1,$2,$3,$4)`,
      [accountId, runId, insightId, index]
    );
  }
}

export class PostgresDiscoveryRepository
  implements DiscoveryRepository
{
  async getRun(
    accountId: string,
    runId: string
  ): Promise<AnalysisRun | null> {
    const result = await postgresPool().query(
      `SELECT *
       FROM discovery_analysis_runs
       WHERE account_id = $1 AND id = $2`,
      [accountId, runId]
    );
    return result.rowCount
      ? runFromRow(postgresPool(), result.rows[0])
      : null;
  }

  async listRuns(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    limit?: number;
  }): Promise<AnalysisRun[]> {
    const values: unknown[] = [params.accountId];
    const clauses = ['account_id = $1'];

    if (params.datasetId) {
      values.push(params.datasetId);
      clauses.push('dataset_id = $' + values.length);
    }
    if (params.knowledgeBaseId) {
      values.push(params.knowledgeBaseId);
      clauses.push('workspace_id = $' + values.length);
    }

    values.push(
      Math.max(1, Math.min(params.limit || 100, 1000))
    );
    const result = await postgresPool().query(
      `SELECT *
       FROM discovery_analysis_runs
       WHERE ${clauses.join(' AND ')}
       ORDER BY started_at DESC
       LIMIT $${values.length}`,
      values
    );

    const output: AnalysisRun[] = [];
    for (const row of result.rows) {
      output.push(await runFromRow(postgresPool(), row));
    }
    return output;
  }

  async saveRun(run: AnalysisRun): Promise<void> {
    await saveRunWith(postgresPool(), run);
  }

  async recordInsightsForRun(
    accountId: string,
    runId: string,
    insights: Insight[]
  ): Promise<Insight[]> {
    return withTransaction(async (client) => {
      const run = await client.query(
        `SELECT 1
         FROM discovery_analysis_runs
         WHERE account_id = $1 AND id = $2
         FOR UPDATE`,
        [accountId, runId]
      );
      if (!run.rowCount) {
        throw new Error(
          'AnalysisRun not found in the current account scope.'
        );
      }

      const persisted: Insight[] = [];

      for (let index = 0; index < insights.length; index += 1) {
        const candidate = insights[index];
        if (
          candidate.accountId !== accountId ||
          candidate.analysisRunId !== runId
        ) {
          throw new Error(
            'Insight candidate must belong to the target account and AnalysisRun.'
          );
        }

        const existingResult = await client.query(
          `SELECT *
           FROM discovery_insights
           WHERE account_id = $1 AND fingerprint = $2
           FOR UPDATE`,
          [accountId, candidate.fingerprint]
        );

        let next: Insight;
        if (existingResult.rowCount) {
          const existing = insightFromRow(
            existingResult.rows[0]
          );
          const membership = await client.query(
            `SELECT 1
             FROM discovery_analysis_run_insights
             WHERE account_id = $1
               AND analysis_run_id = $2
               AND insight_id = $3`,
            [accountId, runId, existing.id]
          );

          if (membership.rowCount) {
            persisted.push(existing);
            continue;
          }

          next = {
            ...candidate,
            id: existing.id,
            status: existing.status,
            statusUpdatedAt: existing.statusUpdatedAt,
            createdAt: existing.createdAt,
            firstSeenAt: existing.firstSeenAt,
            occurrenceCount:
              existing.occurrenceCount + 1,
          };
        } else {
          next = candidate;
        }

        await saveInsightWith(client, next);

        await client.query(
          `INSERT INTO discovery_analysis_run_insights
            (account_id, analysis_run_id, insight_id, position)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (account_id, analysis_run_id, insight_id)
           DO NOTHING`,
          [accountId, runId, next.id, index]
        );

        persisted.push(next);
      }

      return persisted;
    });
  }

  async saveInsightSnapshot(insight: Insight): Promise<void> {
    await saveInsightWith(postgresPool(), insight);
  }

  async replaceRunInsightIds(
    accountId: string,
    runId: string,
    insightIds: string[]
  ): Promise<void> {
    await withTransaction((client) =>
      replaceRunInsightIdsWith(
        client,
        accountId,
        runId,
        insightIds
      )
    );
  }

  async getInsight(
    accountId: string,
    insightId: string
  ): Promise<Insight | null> {
    const result = await postgresPool().query(
      `SELECT *
       FROM discovery_insights
       WHERE account_id = $1 AND id = $2`,
      [accountId, insightId]
    );
    return result.rowCount
      ? insightFromRow(result.rows[0])
      : null;
  }

  async listInsights(params: {
    accountId: string;
    datasetId?: string;
    knowledgeBaseId?: string;
    runId?: string;
    status?: InsightStatus;
    limit?: number;
  }): Promise<Insight[]> {
    const values: unknown[] = [params.accountId];
    const clauses = ['insight.account_id = $1'];
    let join = '';

    if (params.runId) {
      values.push(params.runId);
      join =
        ' JOIN discovery_analysis_run_insights membership' +
        ' ON membership.account_id = insight.account_id' +
        ' AND membership.insight_id = insight.id';
      clauses.push(
        'membership.analysis_run_id = $' + values.length
      );
    }
    if (params.datasetId) {
      values.push(params.datasetId);
      clauses.push(
        'insight.dataset_id = $' + values.length
      );
    }
    if (params.knowledgeBaseId) {
      values.push(params.knowledgeBaseId);
      clauses.push(
        'insight.workspace_id = $' + values.length
      );
    }
    if (params.status) {
      values.push(params.status);
      clauses.push('insight.status = $' + values.length);
    }

    values.push(
      Math.max(1, Math.min(params.limit || 100, 1000))
    );
    const result = await postgresPool().query(
      `SELECT insight.*
       FROM discovery_insights insight
       ${join}
       WHERE ${clauses.join(' AND ')}
       ORDER BY insight.priority_score DESC,
                insight.last_seen_at DESC
       LIMIT $${values.length}`,
      values
    );

    return result.rows.map(insightFromRow);
  }

  async updateInsightStatus(
    accountId: string,
    insightId: string,
    status: InsightStatus,
    statusUpdatedAt = Date.now()
  ): Promise<Insight> {
    const result = await postgresPool().query(
      `UPDATE discovery_insights
       SET status = $3,
           status_updated_at = $4
       WHERE account_id = $1 AND id = $2
       RETURNING *`,
      [
        accountId,
        insightId,
        status,
        new Date(statusUpdatedAt),
      ]
    );
    if (!result.rowCount) {
      throw new Error(
        'Insight not found in the current account scope.'
      );
    }
    return insightFromRow(result.rows[0]);
  }
}

export const postgresDiscoveryRepository =
  new PostgresDiscoveryRepository();
