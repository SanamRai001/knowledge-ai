import crypto from 'crypto';
import {
  postgresPool,
  withTransaction,
} from '../persistence/postgres.js';
import {
  I2_SECURITY_THRESHOLDS,
} from './i2SecurityThresholds.js';

export type DistributedRateLimitScope =
  | 'API_KEY'
  | 'HUMAN_LOGIN';

export interface DistributedRateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export type IntegrationOAuthProvider =
  | 'GOOGLE_DRIVE'
  | 'MICROSOFT_ONEDRIVE';

export interface DistributedOAuthAttempt {
  provider: IntegrationOAuthProvider;
  accountId: string;
  displayName: string;
  redirectUri: string;
  tenant?: string;
  connectionId?: string;
  secretRef?: string;
  createdAt: number;
  expiresAt: number;
}

export type ConsumeOAuthAttemptResult =
  | {
      status: 'CONSUMED';
      attempt: DistributedOAuthAttempt;
    }
  | {
      status: 'INVALID';
    }
  | {
      status: 'ACCOUNT_MISMATCH';
    }
  | {
      status: 'EXPIRED';
      secretRef?: string;
      accountId: string;
      provider: IntegrationOAuthProvider;
    };

function hash(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function eventSubject(
  scope: DistributedRateLimitScope,
  subject: string
): string {
  return hash(
    'knowledge-ai:i2:' +
      scope +
      ':' +
      subject
  );
}

function epoch(
  value: Date | string | number
): number {
  if (typeof value === 'number') {
    return value;
  }
  const parsed =
    value instanceof Date
      ? value.getTime()
      : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(
      'Invalid security-state timestamp.'
    );
  }
  return parsed;
}

function oauthAttemptFromRow(
  row: any
): DistributedOAuthAttempt {
  return {
    provider: row.provider,
    accountId: row.account_id,
    displayName: row.display_name,
    redirectUri: row.redirect_uri,
    tenant: row.tenant ?? undefined,
    connectionId:
      row.connection_id ?? undefined,
    secretRef:
      row.secret_ref ?? undefined,
    createdAt: epoch(row.created_at),
    expiresAt: epoch(row.expires_at),
  };
}

export class DistributedSecurityStateService {
  async consumeRateLimit(params: {
    scope: DistributedRateLimitScope;
    subject: string;
    maxEvents: number;
    windowMs: number;
    at?: number;
  }): Promise<DistributedRateLimitDecision> {
    const now =
      params.at ?? Date.now();
    const cutoff =
      now - params.windowMs;
    const subjectHash =
      eventSubject(
        params.scope,
        params.subject
      );
    const lockKey =
      params.scope +
      ':' +
      subjectHash;

    const decision =
      await withTransaction(
        async (client) => {
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [lockKey]
          );

          await client.query(
            `DELETE FROM security_rate_limit_events
             WHERE scope = $1
               AND subject_hash = $2
               AND occurred_at <= $3`,
            [
              params.scope,
              subjectHash,
              new Date(cutoff),
            ]
          );

          const current =
            await client.query<{
              count: string;
              oldest: Date | null;
            }>(
              `SELECT
                 count(*)::text AS count,
                 min(occurred_at) AS oldest
               FROM security_rate_limit_events
               WHERE scope = $1
                 AND subject_hash = $2
                 AND occurred_at > $3`,
              [
                params.scope,
                subjectHash,
                new Date(cutoff),
              ]
            );

          const count =
            Number(
              current.rows[0]
                ?.count || 0
            );
          const oldest =
            current.rows[0]
              ?.oldest
              ? epoch(
                  current.rows[0]
                    .oldest
                )
              : now;

          if (
            count >=
            params.maxEvents
          ) {
            return {
              allowed: false,
              remaining: 0,
              resetSeconds:
                Math.max(
                  1,
                  Math.ceil(
                    (params.windowMs -
                      (now - oldest)) /
                      1000
                  )
                ),
            };
          }

          await client.query(
            `INSERT INTO security_rate_limit_events
              (scope, subject_hash, occurred_at)
             VALUES ($1,$2,$3)`,
            [
              params.scope,
              subjectHash,
              new Date(now),
            ]
          );

          return {
            allowed: true,
            remaining:
              params.maxEvents -
              count -
              1,
            resetSeconds:
              Math.max(
                1,
                Math.ceil(
                  params.windowMs /
                    1000
                )
              ),
          };
        }
      );

    await this.cleanupRateEvents({
      olderThan:
        now -
        Math.max(
          I2_SECURITY_THRESHOLDS
            .humanLogin.windowMs,
          I2_SECURITY_THRESHOLDS
            .apiKey.windowMs
        ),
      limit:
        I2_SECURITY_THRESHOLDS
          .cleanup
          .rateEventsBatchSize,
    }).catch(() => undefined);

    return decision;
  }

  async clearRateLimitSubject(
    scope: DistributedRateLimitScope,
    subject: string
  ): Promise<void> {
    await postgresPool().query(
      `DELETE FROM security_rate_limit_events
       WHERE scope = $1
         AND subject_hash = $2`,
      [
        scope,
        eventSubject(scope, subject),
      ]
    );
  }

  async cleanupRateEvents(params: {
    olderThan: number;
    limit: number;
  }): Promise<number> {
    const result =
      await postgresPool().query(
        `DELETE FROM security_rate_limit_events
         WHERE id IN (
           SELECT id
           FROM security_rate_limit_events
           WHERE occurred_at <= $1
           ORDER BY occurred_at ASC, id ASC
           LIMIT $2
         )`,
        [
          new Date(
            params.olderThan
          ),
          Math.max(
            1,
            Math.min(
              1000,
              params.limit
            )
          ),
        ]
      );
    return result.rowCount || 0;
  }

  async createOAuthAttempt(params: {
    stateHash: string;
    attempt: DistributedOAuthAttempt;
  }): Promise<void> {
    await postgresPool().query(
      `INSERT INTO integration_oauth_attempts
        (provider, state_hash, account_id, display_name,
         redirect_uri, tenant, connection_id, secret_ref,
         created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        params.attempt.provider,
        params.stateHash,
        params.attempt.accountId,
        params.attempt.displayName,
        params.attempt.redirectUri,
        params.attempt.tenant ?? null,
        params.attempt.connectionId ?? null,
        params.attempt.secretRef ?? null,
        new Date(
          params.attempt.createdAt
        ),
        new Date(
          params.attempt.expiresAt
        ),
      ]
    );
  }

  async consumeOAuthAttempt(params: {
    provider: IntegrationOAuthProvider;
    stateHash: string;
    expectedAccountId?: string;
    at?: number;
  }): Promise<ConsumeOAuthAttemptResult> {
    const now =
      params.at ?? Date.now();

    return withTransaction(
      async (client) => {
        const result =
          await client.query(
            `SELECT *
             FROM integration_oauth_attempts
             WHERE provider = $1
               AND state_hash = $2
             FOR UPDATE`,
            [
              params.provider,
              params.stateHash,
            ]
          );

        if (!result.rowCount) {
          return {
            status:
              'INVALID',
          };
        }

        const row =
          result.rows[0];
        const attempt =
          oauthAttemptFromRow(row);

        if (
          params.expectedAccountId &&
          attempt.accountId !==
            params.expectedAccountId
        ) {
          return {
            status:
              'ACCOUNT_MISMATCH',
          };
        }

        await client.query(
          `DELETE FROM integration_oauth_attempts
           WHERE provider = $1
             AND state_hash = $2`,
          [
            params.provider,
            params.stateHash,
          ]
        );

        if (
          attempt.expiresAt <= now
        ) {
          return {
            status: 'EXPIRED',
            secretRef:
              attempt.secretRef,
            accountId:
              attempt.accountId,
            provider:
              attempt.provider,
          };
        }

        return {
          status: 'CONSUMED',
          attempt,
        };
      }
    );
  }

  async cleanupExpiredOAuthAttempts(params: {
    at?: number;
    limit?: number;
  }): Promise<
    Array<{
      accountId: string;
      provider:
        IntegrationOAuthProvider;
      secretRef?: string;
    }>
  > {
    const at =
      params.at ?? Date.now();
    const limit =
      Math.max(
        1,
        Math.min(
          500,
          params.limit ??
            I2_SECURITY_THRESHOLDS
              .cleanup
              .oauthAttemptsBatchSize
        )
      );

    return withTransaction(
      async (client) => {
        const selected =
          await client.query(
            `SELECT
               provider,
               state_hash,
               account_id,
               secret_ref
             FROM integration_oauth_attempts
             WHERE expires_at <= $1
             ORDER BY expires_at ASC,
                      state_hash ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED`,
            [
              new Date(at),
              limit,
            ]
          );

        if (!selected.rowCount) {
          return [];
        }

        const keys =
          selected.rows.map(
            (row) =>
              row.state_hash
          );

        await client.query(
          `DELETE FROM integration_oauth_attempts
           WHERE state_hash = ANY($1::text[])`,
          [keys]
        );

        return selected.rows.map(
          (row) => ({
            accountId:
              row.account_id,
            provider:
              row.provider,
            secretRef:
              row.secret_ref ??
              undefined,
          })
        );
      }
    );
  }
}

export function hashOAuthState(
  state: string
): string {
  return hash(
    'knowledge-ai:i2:oauth:' +
      state
  );
}

export const distributedSecurityState =
  new DistributedSecurityStateService();
