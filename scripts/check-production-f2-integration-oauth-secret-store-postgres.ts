import fs from 'fs';
import path from 'path';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  runPostgresMigrations,
} from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  integrationRuntimeService,
} from '../server/integrations/integrationRuntimeService.js';
import {
  IntegrationOAuthSecretRuntime,
} from '../server/integrations/integrationOAuthSecretRuntime.js';
import {
  integrationCredentialStore,
  IntegrationCredentialError,
} from '../server/integrations/integrationCredentialStore.js';
import {
  PostgresSecretStore,
  SecretStoreError,
} from '../server/security/postgresSecretStore.js';
import {
  KmsDecryptionError,
} from '../server/security/versionedAesGcmKmsService.js';
import {
  GoogleDriveConnector,
  type GoogleDriveCredentialSecret,
} from '../server/integrations/connectors/googleDriveConnector.js';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function base64Key(
  fill: number
): string {
  return Buffer.alloc(
    32,
    fill
  ).toString('base64');
}

function configureKeyring(
  activeKeyId: string,
  keys: Record<string, string>
): void {
  process.env
    .KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID =
    activeKeyId;
  process.env
    .KNOWLEDGE_AI_SECRET_KEYRING_JSON =
    JSON.stringify(keys);
}

function snapshotFile(
  file: string
): Buffer | null {
  return fs.existsSync(file)
    ? fs.readFileSync(file)
    : null;
}

function restoreFile(
  file: string,
  before: Buffer | null
): void {
  if (before) {
    fs.mkdirSync(
      path.dirname(file),
      { recursive: true }
    );
    fs.writeFileSync(file, before);
    return;
  }
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

async function main() {
  assert(
    process.env
      .KNOWLEDGE_AI_PERSISTENCE_MODE ===
      'postgres',
    'F2 PostgreSQL proof must run in postgres mode.'
  );
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for F2 PostgreSQL proof.'
  );

  const migrations =
    await runPostgresMigrations();
  assert(
    migrations.applied.includes('019') ||
      migrations.alreadyApplied.includes(
        '019'
      ),
    'F2 requires migration 019.'
  );

  await postgresPool().query(
    'TRUNCATE TABLE accounts CASCADE'
  );

  const accountA = 'acc_f2_a';
  const accountB = 'acc_f2_b';
  await postgresAccountRepository
    .ensureAccount(accountA);
  await postgresAccountRepository
    .ensureAccount(accountB);

  const key1 = base64Key(17);
  const key2 = base64Key(29);
  configureKeyring('f2-k1', {
    'f2-k1': key1,
  });

  const storeA =
    new PostgresSecretStore();
  const storeB =
    new PostgresSecretStore();
  const webRuntime =
    new IntegrationOAuthSecretRuntime(
      storeA,
      integrationCredentialStore
    );
  const workerRuntime =
    new IntegrationOAuthSecretRuntime(
      storeB,
      integrationCredentialStore
    );

  const initial:
    GoogleDriveCredentialSecret = {
      accessToken:
        'f2-access-initial-sentinel',
      refreshToken:
        'f2-refresh-initial-sentinel',
      expiresAt:
        Date.now() + 3600_000,
      scope:
        'https://www.googleapis.com/auth/drive.file',
      tokenType: 'Bearer',
    };

  const credentialRef =
    await webRuntime.create({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      secret: initial,
    });

  const connection =
    await integrationRuntimeService
      .createConnection({
        accountId: accountA,
        provider: 'GOOGLE_DRIVE',
        displayName:
          'F2 Shared Secret Proof',
        credentialRef,
      });

  const workerRead =
    await workerRuntime.get<GoogleDriveCredentialSecret>({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      credentialRef,
    });

  assert(
    workerRead.refreshToken ===
      initial.refreshToken &&
      workerRead.accessToken ===
        initial.accessToken,
    'F2 web-created OAuth secret must be resolvable by an independent worker runtime through shared PostgreSQL state.'
  );

  let foreignBlocked = false;
  try {
    await workerRuntime.get({
      accountId: accountB,
      provider: 'GOOGLE_DRIVE',
      credentialRef,
    });
  } catch (error) {
    foreignBlocked =
      error instanceof
        SecretStoreError &&
      error.code ===
        'SECRET_NOT_FOUND';
  }
  assert(
    foreignBlocked,
    'F2 must deny cross-account secret lookup.'
  );

  let providerBlocked = false;
  try {
    await workerRuntime.get({
      accountId: accountA,
      provider:
        'MICROSOFT_ONEDRIVE',
      credentialRef,
    });
  } catch (error) {
    providerBlocked =
      error instanceof
        SecretStoreError &&
      error.code ===
        'SECRET_SCOPE_MISMATCH';
  }
  assert(
    providerBlocked,
    'F2 must deny cross-provider secret lookup.'
  );

  const publicConnection =
    await integrationRuntimeService
      .getConnection(
        accountA,
        connection.id
      );
  assert(
    publicConnection.hasCredential &&
      !Object.prototype.hasOwnProperty.call(
        publicConnection,
        'credentialRef'
      ),
    'F2 public connection must expose only hasCredential, never the secret reference.'
  );

  const dbConnection =
    await postgresPool().query(
      `SELECT *
       FROM integration_connections
       WHERE account_id = $1
         AND id = $2`,
      [accountA, connection.id]
    );
  const connectionJson =
    JSON.stringify(
      dbConnection.rows[0]
    );
  assert(
    !connectionJson.includes(
      initial.accessToken
    ) &&
      !connectionJson.includes(
        initial.refreshToken
      ),
    'OAuth token plaintext must not enter ordinary IntegrationConnection metadata.'
  );

  const encrypted =
    await postgresPool().query(
      `SELECT s.id, s.current_version,
              v.kms_key_id, v.kms_algorithm, v.ciphertext
       FROM account_secrets s
       JOIN account_secret_versions v
         ON v.account_id = s.account_id
        AND v.secret_id = s.id
        AND v.version = s.current_version
       WHERE s.account_id = $1
         AND s.id = $2`,
      [accountA, credentialRef]
    );
  assert(
    encrypted.rowCount === 1 &&
      encrypted.rows[0]
        .kms_key_id === 'f2-k1' &&
      encrypted.rows[0]
        .kms_algorithm ===
        'AES-256-GCM' &&
      !String(
        encrypted.rows[0]
          .ciphertext
      ).includes(
        initial.refreshToken
      ),
    'F2 secret versions must contain only encrypted envelope bytes and KMS metadata.'
  );

  const rotated:
    GoogleDriveCredentialSecret = {
      ...initial,
      accessToken:
        'f2-access-rotated-sentinel',
      refreshToken:
        'f2-refresh-rotated-sentinel',
    };

  await workerRuntime.update({
    accountId: accountA,
    provider: 'GOOGLE_DRIVE',
    credentialRef,
    secret: rotated,
  });

  const afterRotation =
    await webRuntime.get<GoogleDriveCredentialSecret>({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      credentialRef,
    });
  assert(
    afterRotation.refreshToken ===
      rotated.refreshToken,
    'F2 token refresh/rotation must preserve credentialRef while advancing encrypted secret version.'
  );

  const versionRows =
    await postgresPool().query(
      `SELECT version, status, kms_key_id
       FROM account_secret_versions
       WHERE account_id = $1
         AND secret_id = $2
       ORDER BY version`,
      [accountA, credentialRef]
    );
  assert(
    versionRows.rows.length === 2 &&
      versionRows.rows[0].status ===
        'RETIRED' &&
      versionRows.rows[1].status ===
        'ACTIVE',
    'F2 rotation must retire the old encrypted version only after the new version commits.'
  );

  // Deployment key rotation without user OAuth reauthorization.
  configureKeyring('f2-k2', {
    'f2-k1': key1,
    'f2-k2': key2,
  });
  await webRuntime.update({
    accountId: accountA,
    provider: 'GOOGLE_DRIVE',
    credentialRef,
    secret: rotated,
  });

  configureKeyring('f2-k2', {
    'f2-k2': key2,
  });

  const afterKeyRotation =
    await workerRuntime.get<GoogleDriveCredentialSecret>({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      credentialRef,
    });
  assert(
    afterKeyRotation.refreshToken ===
      rotated.refreshToken,
    'F2 active secret must remain usable after re-encryption to a new deployment key and removal of the retired key.'
  );

  const currentEnvelope =
    await postgresPool().query(
      `SELECT s.current_version,
              v.kms_key_id,
              v.kms_algorithm,
              v.ciphertext
       FROM account_secrets s
       JOIN account_secret_versions v
         ON v.account_id = s.account_id
        AND v.secret_id = s.id
        AND v.version = s.current_version
       WHERE s.account_id = $1
         AND s.id = $2`,
      [accountA, credentialRef]
    );
  assert(
    currentEnvelope.rows[0]
      .kms_key_id === 'f2-k2',
    'F2 active secret must record the new KMS key ID after rotation.'
  );

  // Connector-level refresh uses the same shared runtime used by workers.
  process.env.GOOGLE_DRIVE_CLIENT_ID =
    'f2-google-client';
  process.env.GOOGLE_DRIVE_CLIENT_SECRET =
    'f2-google-client-secret';

  await webRuntime.update({
    accountId: accountA,
    provider: 'GOOGLE_DRIVE',
    credentialRef,
    secret: {
      ...rotated,
      accessToken:
        'f2-expired-access',
      expiresAt:
        Date.now() - 1,
    },
  });

  let refreshUsed = false;
  let refreshedBearer = false;
  const connector =
    new GoogleDriveConnector(
      workerRuntime,
      async (input, init) => {
        const url = new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        );

        if (
          url.href ===
          'https://oauth2.googleapis.com/token'
        ) {
          const body =
            new URLSearchParams(
              init?.body instanceof
                URLSearchParams
                ? init.body.toString()
                : String(
                    init?.body || ''
                  )
            );
          refreshUsed =
            body.get(
              'refresh_token'
            ) ===
            rotated.refreshToken;
          return new Response(
            JSON.stringify({
              access_token:
                'f2-worker-refreshed-access',
              expires_in: 3600,
              token_type: 'Bearer',
              scope:
                rotated.scope,
            }),
            {
              status: 200,
              headers: {
                'Content-Type':
                  'application/json',
              },
            }
          );
        }

        if (
          url.href.includes(
            '/drive/v3/about'
          )
        ) {
          refreshedBearer =
            new Headers(
              init?.headers || {}
            ).get(
              'Authorization'
            ) ===
            'Bearer f2-worker-refreshed-access';
          return new Response(
            JSON.stringify({
              user: {
                displayName: 'F2',
              },
            }),
            {
              status: 200,
              headers: {
                'Content-Type':
                  'application/json',
              },
            }
          );
        }

        return new Response(
          'unexpected',
          { status: 500 }
        );
      }
    );

  const health =
    await connector.healthCheck({
      connection:
        await integrationRuntimeService
          .getInternalConnection(
            accountA,
            connection.id
          ),
    });

  assert(
    health.ok &&
      refreshUsed &&
      refreshedBearer,
    'F2 worker connector must decrypt, refresh, rotate, and use OAuth credentials through the shared SecretStore.'
  );

  const refreshedSecret =
    await webRuntime.get<GoogleDriveCredentialSecret>({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      credentialRef,
    });
  assert(
    refreshedSecret.accessToken ===
      'f2-worker-refreshed-access',
    'Worker refresh must persist the rotated access token for other replicas under the same credentialRef.'
  );

  // Legacy read-through migration preserves existing credentialRef.
  const credentialFile =
    path.join(
      process.cwd(),
      'data',
      'integration_credentials.json'
    );
  const legacyBefore =
    snapshotFile(credentialFile);
  process.env.INTEGRATION_CREDENTIAL_KEY =
    'f2-legacy-migration-key-0123456789abcdef-0123456789abcdef';

  const legacyRef =
    integrationCredentialStore.create({
      accountId: accountA,
      provider:
        'MICROSOFT_ONEDRIVE',
      secret: {
        accessToken:
          'f2-legacy-access-sentinel',
        refreshToken:
          'f2-legacy-refresh-sentinel',
        expiresAt:
          Date.now() + 3600_000,
        scope:
          'Files.Read offline_access',
        tokenType: 'Bearer',
      },
    });

  try {
    const migrated =
      await workerRuntime.get<any>({
        accountId: accountA,
        provider:
          'MICROSOFT_ONEDRIVE',
        credentialRef: legacyRef,
      });

    assert(
      migrated.refreshToken ===
        'f2-legacy-refresh-sentinel',
      'F2 read-through must recover the existing encrypted legacy credential.'
    );

    const migratedRow =
      await postgresPool().query(
        `SELECT id, purpose, provider, status
         FROM account_secrets
         WHERE account_id = $1
           AND id = $2`,
        [accountA, legacyRef]
      );
    assert(
      migratedRow.rowCount === 1 &&
        migratedRow.rows[0].id ===
          legacyRef &&
        migratedRow.rows[0].purpose ===
          'INTEGRATION_OAUTH' &&
        migratedRow.rows[0].status ===
          'ACTIVE',
      'F2 one-time migration must preserve the existing credentialRef so IntegrationConnection metadata need not change.'
    );

    let legacyDeleted = false;
    try {
      integrationCredentialStore.get({
        accountId: accountA,
        provider:
          'MICROSOFT_ONEDRIVE',
        credentialRef: legacyRef,
      });
    } catch (error) {
      legacyDeleted =
        error instanceof
          IntegrationCredentialError &&
        error.code ===
          'CREDENTIAL_NOT_FOUND';
    }
    assert(
      legacyDeleted,
      'F2 must delete the old encrypted-file record only after shared SecretStore migration is verified.'
    );

    delete process.env
      .INTEGRATION_CREDENTIAL_KEY;

    const withoutLegacyKey =
      await webRuntime.get<any>({
        accountId: accountA,
        provider:
          'MICROSOFT_ONEDRIVE',
        credentialRef: legacyRef,
      });
    assert(
      withoutLegacyKey.refreshToken ===
        'f2-legacy-refresh-sentinel',
      'Migrated OAuth secret must no longer depend on INTEGRATION_CREDENTIAL_KEY.'
    );
  } finally {
    restoreFile(
      credentialFile,
      legacyBefore
    );
  }

  // Crash-orphan reconciliation.
  const orphan =
    await storeA.create({
      accountId: accountA,
      purpose:
        'INTEGRATION_OAUTH',
      provider: 'GOOGLE_DRIVE',
      secret: {
        accessToken:
          'f2-orphan-access',
        refreshToken:
          'f2-orphan-refresh',
      },
    });
  await postgresPool().query(
    `UPDATE account_secrets
     SET created_at =
       now() - interval '10 minutes'
     WHERE account_id = $1
       AND id = $2`,
    [accountA, orphan.id]
  );

  const attachedAfterSweep =
    await webRuntime.create({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      secret: {
        accessToken:
          'f2-after-sweep-access',
        refreshToken:
          'f2-after-sweep-refresh',
      },
    });

  const orphanState =
    await postgresPool().query(
      `SELECT status
       FROM account_secrets
       WHERE account_id = $1
         AND id = $2`,
    [accountA, orphan.id]
  );
  const orphanVersions =
    await postgresPool().query(
      `SELECT count(*)::int AS count
       FROM account_secret_versions
       WHERE account_id = $1
         AND secret_id = $2`,
    [accountA, orphan.id]
  );
  assert(
    orphanState.rows[0]?.status ===
      'DELETED' &&
      Number(
        orphanVersions.rows[0]?.count
      ) === 0,
    'F2 must reconcile stale unreferenced OAuth secrets left by crash windows.'
  );

  await webRuntime.delete({
    accountId: accountA,
    provider: 'GOOGLE_DRIVE',
    credentialRef:
      attachedAfterSweep,
  });

  const auditRows =
    await postgresPool().query(
      `SELECT operation, outcome, error_code
       FROM account_secret_audit_events
       WHERE account_id = $1
       ORDER BY occurred_at ASC`,
    [accountA]
  );
  const auditJson =
    JSON.stringify(
      auditRows.rows
    );
  for (const secretValue of [
    initial.accessToken,
    initial.refreshToken,
    rotated.accessToken,
    rotated.refreshToken,
    'f2-legacy-access-sentinel',
    'f2-legacy-refresh-sentinel',
  ]) {
    assert(
      !auditJson.includes(
        secretValue
      ),
      'Secret audit metadata must never contain token plaintext.'
    );
  }
  assert(
    auditRows.rows.some(
      (row) =>
        row.operation ===
        'MIGRATE'
    ) &&
      auditRows.rows.some(
        (row) =>
          row.operation ===
          'ROTATE'
      ) &&
      auditRows.rows.some(
        (row) =>
          row.operation ===
          'DELETE'
      ),
    'F2 must durably audit migration, rotation, and deletion operations.'
  );

  const secretTableDump =
    await postgresPool().query(
      `SELECT s.id, s.purpose, s.provider, s.status,
              v.kms_key_id, v.kms_algorithm, v.ciphertext
       FROM account_secrets s
       LEFT JOIN account_secret_versions v
         ON v.account_id = s.account_id
        AND v.secret_id = s.id
       WHERE s.account_id = $1`,
    [accountA]
  );
  const dump =
    JSON.stringify(
      secretTableDump.rows
    );
  for (const secretValue of [
    initial.accessToken,
    initial.refreshToken,
    rotated.accessToken,
    rotated.refreshToken,
    'f2-worker-refreshed-access',
    'f2-legacy-access-sentinel',
    'f2-legacy-refresh-sentinel',
  ]) {
    assert(
      !dump.includes(secretValue),
      'PostgreSQL secret metadata/ciphertext dump must not contain OAuth token plaintext.'
    );
  }

  await webRuntime.delete({
    accountId: accountA,
    provider: 'GOOGLE_DRIVE',
    credentialRef,
  });

  let deletedBlocked = false;
  try {
    await workerRuntime.get({
      accountId: accountA,
      provider: 'GOOGLE_DRIVE',
      credentialRef,
    });
  } catch (error) {
    deletedBlocked =
      error instanceof
        IntegrationCredentialError ||
      error instanceof
        SecretStoreError;
  }
  assert(
    deletedBlocked,
    'Deleted F2 OAuth credential must no longer be usable.'
  );

  // Wrong encryption context cannot decrypt a captured envelope.
  const kmsModule =
    await import(
      '../server/security/versionedAesGcmKmsService.js'
    );
  const kms =
    new kmsModule.VersionedAesGcmKmsService();
  const probe =
    await kms.encrypt({
      plaintext:
        Buffer.from('f2-context-probe'),
      encryptionContext: {
        accountId: accountA,
        secretId: 'probe',
        purpose:
          'INTEGRATION_OAUTH',
        provider:
          'GOOGLE_DRIVE',
        version: '1',
      },
    });
  let contextBlocked = false;
  try {
    await kms.decrypt({
      envelope: probe,
      encryptionContext: {
        accountId: accountB,
        secretId: 'probe',
        purpose:
          'INTEGRATION_OAUTH',
        provider:
          'GOOGLE_DRIVE',
        version: '1',
      },
    });
  } catch (error) {
    contextBlocked =
      error instanceof
        KmsDecryptionError;
  }
  assert(
    contextBlocked,
    'F2 KMS envelope must cryptographically bind ciphertext to its account/purpose/provider/version context.'
  );

  console.log(
    'PRODUCTION_F2_INTEGRATION_OAUTH_SECRET_STORE_POSTGRES_CHECK_PASSED'
  );
  console.log(
    'Shared replica secret resolution, tenant/provider isolation, token/KMS rotation, connector refresh persistence, legacy read-through migration, orphan cleanup, ciphertext-only storage, audit metadata, deletion, and encryption-context binding are verified.'
  );
}

main()
  .catch((error) => {
    console.error(
      'PRODUCTION_F2_INTEGRATION_OAUTH_SECRET_STORE_POSTGRES_CHECK_FAILED'
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
