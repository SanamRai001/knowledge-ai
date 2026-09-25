import fs from 'fs';

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function main() {
  const migration = read(
    'server/persistence/migrations/019_account_secret_store.sql'
  );
  for (const required of [
    'CREATE TABLE account_secrets',
    'CREATE TABLE account_secret_versions',
    'CREATE TABLE account_secret_audit_events',
    "purpose IN ('INTEGRATION_OAUTH'",
    "status IN ('ACTIVE','REVOKED','DELETED')",
    "operation IN ('CREATE','READ','ROTATE','REVOKE','DELETE','MIGRATE')",
    'kms_key_id',
    'ciphertext',
  ]) {
    assert(
      migration.includes(required),
      'F2 secret schema is missing: ' +
        required
    );
  }

  assert(
    !migration.includes('access_token') &&
      !migration.includes('refresh_token') &&
      !migration.includes('client_secret'),
    'F2 ordinary secret metadata schema must never name/store OAuth token plaintext fields.'
  );

  const kms = read(
    'server/security/versionedAesGcmKmsService.ts'
  );
  for (const required of [
    'KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID',
    'KNOWLEDGE_AI_SECRET_KEYRING_JSON',
    "'aes-256-gcm'",
    'setAAD',
    'encryptionContext',
    'envelope.keyId',
  ]) {
    assert(
      kms.includes(required),
      'F2 KMS boundary is missing: ' +
        required
    );
  }

  const store = read(
    'server/security/postgresSecretStore.ts'
  );
  for (const required of [
    'implements SecretStore',
    'importLegacyWithId',
    'cleanupUnreferencedIntegrationOAuthSecrets',
    "operation: 'ROTATE'",
    "operation: 'READ'",
    "operation: 'DELETE'",
    'FOR UPDATE',
  ]) {
    assert(
      store.includes(required),
      'F2 PostgreSQL SecretStore is missing: ' +
        required
    );
  }

  const runtime = read(
    'server/integrations/integrationOAuthSecretRuntime.ts'
  );
  assert(
    runtime.includes(
      'postgresPersistenceEnabled'
    ) &&
      runtime.includes(
        'importLegacyWithId'
      ) &&
      runtime.includes(
        'cleanupUnreferencedIntegrationOAuthSecrets'
      ) &&
      runtime.includes(
        'this.secretStore.rotate'
      ) &&
      runtime.includes(
        'this.legacyStore.delete'
      ),
    'F2 OAuth credential runtime must use shared PostgreSQL secrets with legacy read-through and stable-ref rotation.'
  );

  for (const path of [
    'server/integrations/googleDriveOAuthService.ts',
    'server/integrations/microsoftOneDriveOAuthService.ts',
    'server/integrations/connectors/googleDriveConnector.ts',
    'server/integrations/connectors/microsoftOneDriveConnector.ts',
  ]) {
    const source = read(path);
    assert(
      source.includes(
        'integrationOAuthSecretRuntime'
      ) &&
        source.includes(
          'IntegrationCredentialAccess'
        ) &&
        !source.includes(
          "from './integrationCredentialStore.js'"
        ) &&
        !source.includes(
          "from '../integrationCredentialStore.js'"
        ),
      'OAuth production caller must use F2 SecretStore boundary: ' +
        path
    );
  }

  const integrationTypes = read(
    'server/integrations/types.ts'
  );
  const publicStart =
    integrationTypes.indexOf(
      'export interface PublicIntegrationConnection'
    );
  const publicEnd =
    integrationTypes.indexOf(
      'export interface ExternalSourceRef'
    );
  const publicBlock =
    integrationTypes.slice(
      publicStart,
      publicEnd
    );
  assert(
    publicBlock.includes(
      "'credentialRef'"
    ) &&
      !publicBlock.includes(
        'accessToken'
      ) &&
      !publicBlock.includes(
        'refreshToken'
      ),
    'Public IntegrationConnection must continue stripping the opaque credentialRef and token material.'
  );

  const worker = read('worker.ts');
  assert(
    worker.includes(
      'SELECT 1 FROM account_secrets LIMIT 1'
    ),
    'F2 worker startup must require the shared secret schema.'
  );

  const env = read('.env.example');
  assert(
    env.includes(
      'KNOWLEDGE_AI_SECRET_ACTIVE_KEY_ID='
    ) &&
      env.includes(
        'KNOWLEDGE_AI_SECRET_KEYRING_JSON='
      ) &&
      env.includes(
        'Legacy pre-F2 OAuth credential-file key.'
      ),
    'F2 deployment configuration must document the versioned keyring and legacy migration key separately.'
  );

  const pkg = JSON.parse(
    read('package.json')
  );
  for (const forbidden of [
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-kms',
    '@google-cloud/secret-manager',
    '@azure/keyvault-secrets',
  ]) {
    assert(
      !pkg.dependencies?.[forbidden] &&
        !pkg.devDependencies?.[forbidden],
      'F2 provider-neutral foundation must not hard-code a cloud Secret Manager/KMS SDK: ' +
        forbidden
    );
  }

  console.log(
    'PRODUCTION_F2_INTEGRATION_OAUTH_SECRET_STORE_CONTRACT_CHECK_PASSED'
  );
  console.log(
    'Shared secret schema, versioned envelope KMS, stable-ref rotation, legacy read-through, caller cutover, worker schema dependency, public redaction, and vendor-neutral boundaries are verified.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_F2_INTEGRATION_OAUTH_SECRET_STORE_CONTRACT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
