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
  const env = read('.env.example');
  const credentialStore = read(
    'server/integrations/integrationCredentialStore.ts'
  );
  const integrationStore = read(
    'server/integrations/integrationStore.ts'
  );
  const humanAuth = read(
    'server/identity/humanAuthService.ts'
  );
  const identity = read(
    'server/identity/humanIdentityFoundationService.ts'
  );
  const apiKeys = read(
    'server/apiKeyStore.ts'
  );
  const gemini = read(
    'server/providers/geminiProvider.ts'
  );
  const sourceStorage = read(
    'server/storage/sourceByteStorageRuntime.ts'
  );
  const postgres = read(
    'server/persistence/postgres.ts'
  );
  const googleState = read(
    'server/integrations/googleDriveOAuthStateStore.ts'
  );
  const microsoftState = read(
    'server/integrations/microsoftOneDriveOAuthStateStore.ts'
  );
  const webhook = read(
    'server/mediator/webhookService.ts'
  );
  const contract = read(
    'server/security/secretStoreContract.ts'
  );
  const pkg = JSON.parse(
    read('package.json')
  );

  for (const secret of [
    'GEMINI_API_KEY=',
    'INTEGRATION_CREDENTIAL_KEY=',
    'GOOGLE_DRIVE_CLIENT_SECRET=',
    'MICROSOFT_ONEDRIVE_CLIENT_SECRET=',
    'DATABASE_URL=',
    'SOURCE_STORAGE_SECRET_ACCESS_KEY=',
  ]) {
    assert(
      env.includes(secret),
      'F1 env inventory is missing: ' +
        secret
    );
  }

  assert(
    credentialStore.includes(
      "'integration_credentials.json'"
    ) &&
      credentialStore.includes(
        "createCipheriv(\n      'aes-256-gcm'"
      ) &&
      credentialStore.includes(
        'process.env.INTEGRATION_CREDENTIAL_KEY'
      ),
    'F1 must keep the current local encrypted OAuth credential boundary explicit until F2 migration.'
  );

  assert(
    integrationStore.includes(
      'const { credentialRef, syncLeaseId, ...safe }'
    ) &&
      integrationStore.includes(
        'hasCredential: Boolean(credentialRef)'
      ),
    'Public IntegrationConnection must not expose credentialRef.'
  );

  assert(
    humanAuth.includes(
      'crypto.scrypt('
    ) &&
      humanAuth.includes(
        'KNOWLEDGE_AI_BOOTSTRAP_TOKEN'
      ),
    'Passwords must remain one-way scrypt credentials and bootstrap token must remain deployment sourced.'
  );

  assert(
    identity.includes(
      'hashBrowserSessionToken'
    ) &&
      identity.includes(
        "crypto.randomBytes(32).toString('base64url')"
      ),
    'Browser sessions must persist only token hashes.'
  );

  assert(
    apiKeys.includes(
      'hashKey(rawKey'
    ) &&
      apiKeys.includes(
        "createHash('sha256')"
      ) &&
      apiKeys.includes(
        "plain text secret is returned ONLY ONCE"
      ),
    'API keys must remain one-way hashed rather than reversible managed secrets.'
  );

  assert(
    gemini.includes(
      'process.env.GEMINI_API_KEY'
    ) &&
      sourceStorage.includes(
        'SOURCE_STORAGE_SECRET_ACCESS_KEY'
      ) &&
      postgres.includes(
        'process.env.DATABASE_URL'
      ),
    'Deployment secret families must remain explicit environment/runtime injection points.'
  );

  assert(
    googleState.includes(
      'STATE_TTL_MS = 10 * 60 * 1000'
    ) &&
      googleState.includes(
        'stateHash: hashState(state)'
      ) &&
      microsoftState.includes(
        'codeVerifier'
      ) &&
      microsoftState.includes(
        'stateHash: hashState(state)'
      ),
    'OAuth state/PKCE material must remain short-lived process security state, not long-lived Integration metadata.'
  );

  assert(
    webhook.includes(
      'whsec_alpha_webhook_secret_key_789'
    ),
    'F1 must explicitly inventory the retired mediator webhook fixture rather than silently treating it as production managed-secret state.'
  );

  for (const forbidden of [
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-kms',
    '@google-cloud/secret-manager',
    '@azure/keyvault-secrets',
    'hashicorp-vault',
  ]) {
    assert(
      !pkg.dependencies?.[forbidden] &&
        !pkg.devDependencies?.[forbidden],
      'F1 is audit-only and must not add managed secret SDK: ' +
        forbidden
    );
  }

  for (const required of [
    'export interface SecretStore',
    'create<T>',
    'get<T>',
    'rotate<T>',
    'revoke(params:',
    'delete(params:',
    'export interface KmsService',
    'encryptionContext',
  ]) {
    assert(
      contract.includes(required),
      'F1 provider-neutral secret/KMS contract is missing: ' +
        required
    );
  }

  console.log(
    'PRODUCTION_F1_SECRET_KMS_AUDIT_CHECK_PASSED'
  );
  console.log(
    'Deployment secrets, hashed credentials, OAuth encrypted-file debt, browser redaction, ephemeral OAuth state, retired webhook fixture, and provider-neutral SecretStore/KMS boundaries are explicitly inventoried.'
  );
}

main().catch((error) => {
  console.error(
    'PRODUCTION_F1_SECRET_KMS_AUDIT_CHECK_FAILED'
  );
  console.error(error);
  process.exit(1);
});
