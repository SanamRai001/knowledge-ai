import express from 'express';
import fs from 'fs';
import path from 'path';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { companyKnowledgePersistence } from '../server/companyKnowledge/companyKnowledgePersistence.js';
import { platformApiRouter } from '../server/platform/platformApiRouter.js';
import { PLATFORM_SCOPES } from '../server/platform/platformApiManifest.js';
import {
  PlatformPersistence,
  platformPersistence,
} from '../server/platform/platformPersistence.js';
import {
  closePostgresPool,
  postgresPool,
} from '../server/persistence/postgres.js';
import {
  postgresAccountRepository,
  postgresApiKeyRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  postgresPlatformStateRepository,
} from '../server/persistence/a5PostgresRepositories.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response) {
  let body: any = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { response, body };
}

function snapshot(file: string): string | null {
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : null;
}

async function main() {
  assert(
    process.env.KNOWLEDGE_AI_PERSISTENCE_MODE === 'postgres',
    'A7F proof must run in PostgreSQL persistence mode.'
  );
  assert(Boolean(process.env.DATABASE_URL), 'DATABASE_URL is required.');

  await runPostgresMigrations();
  await postgresPool().query(
    `TRUNCATE TABLE
       platform_tool_invocation_audit,
       platform_domain_pack_installations
     CASCADE`
  );

  const accountA = 'acc_a7f_platform_a';
  const accountB = 'acc_a7f_platform_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const legacyFiles = [
    'platform_domain_packs.json',
    'platform_tool_invocations.json',
  ].map((name) => path.join(process.cwd(), 'data', name));
  const legacyBefore = new Map(
    legacyFiles.map((file) => [file, snapshot(file)])
  );

  const scopes = [
    PLATFORM_SCOPES.domainPacksRead,
    PLATFORM_SCOPES.domainPacksWrite,
    PLATFORM_SCOPES.toolsRead,
    PLATFORM_SCOPES.toolsInvoke,
    PLATFORM_SCOPES.knowledgeRead,
  ];

  const keyA = apiKeyStore.createApiKey({
    name: 'A7F Platform A',
    accountId: accountA,
    environment: 'test',
    scopes,
  });
  const keyB = apiKeyStore.createApiKey({
    name: 'A7F Platform B',
    accountId: accountB,
    environment: 'test',
    scopes,
  });

  // Stable Platform auth still validates through the existing API-key
  // boundary. Seed the same metadata relationally so A5's audit FK is
  // authoritative in PostgreSQL mode.
  await postgresApiKeyRepository.create(keyA.apiKey);
  await postgresApiKeyRepository.create(keyB.apiKey);

  const entity = await companyKnowledgePersistence.upsertEntity({
    accountId: accountA,
    type: 'PRODUCT',
    canonicalName: 'A7F Platform Oak',
    identityKey: 'A7F-PLATFORM-OAK',
    aliases: ['Platform Oak'],
    sourceRef: {
      sourceType: 'USER',
      sourceId: 'a7f-platform-seed',
      sourceName: 'A7F Platform relational seed',
      excerpt: 'A7F Platform Oak',
    },
    observedAt: Date.now(),
  });

  assert(
    companyKnowledgePersistence.usesPostgres() &&
      platformPersistence.usesPostgres(),
    'A7F selected Living Knowledge and Platform persistence must report PostgreSQL mode.'
  );

  const app = express();
  app.use(express.json());
  app.use('/api/platform/v1', platformApiRouter);
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve A7F Platform HTTP port.');
    }
    const baseUrl = 'http://127.0.0.1:' + address.port;

    // 1. Stable Platform knowledge read must see PostgreSQL Living Knowledge.
    const entityRead = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/knowledge/entities/' +
          entity.id,
        {
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
            'X-Account-ID': accountB,
          },
        }
      )
    );
    assert(
      entityRead.response.status === 200 &&
        entityRead.body.entity?.id === entity.id &&
        entityRead.body.entity?.accountId === accountA,
      'Stable Platform knowledge endpoint must use selected PostgreSQL state and authenticated API-key account identity.'
    );

    // 2. Domain-pack install path persists only to PostgreSQL.
    const installed = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/install',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    assert(
      installed.response.status === 201 &&
        installed.body.installation?.accountId === accountA &&
        installed.body.installation?.packId ===
          'inventory.operations' &&
        installed.body.installation?.status === 'ACTIVE',
      'A7F Platform API must install domain-pack state through PostgreSQL.'
    );
    const firstInstallationId =
      installed.body.installation.id as string;

    const installedAgain = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/install',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    assert(
      installedAgain.response.status === 201 &&
        installedAgain.body.installation.id === firstInstallationId,
      'Installing the same active domain-pack version must remain idempotent in PostgreSQL mode.'
    );

    const dbInstall = await postgresPlatformStateRepository
      .getDomainPackInstallation(accountA, firstInstallationId);
    assert(
      dbInstall?.status === 'ACTIVE' &&
        (
          await postgresPlatformStateRepository
            .getDomainPackInstallation(
              accountB,
              firstInstallationId
            )
        ) === null,
      'Domain-pack installation must be relationally durable and account scoped.'
    );

    // 3. Removal + reinstallation keeps history and one ACTIVE row.
    const removed =
      await platformPersistence.setDomainPackStatus({
        accountId: accountA,
        installationId: firstInstallationId,
        status: 'REMOVED',
      });
    assert(
      removed.status === 'REMOVED',
      'Domain-pack removal must update selected PostgreSQL persistence.'
    );

    const reinstalled = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/inventory.operations/install',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    assert(
      reinstalled.response.status === 201 &&
        reinstalled.body.installation.id !== firstInstallationId &&
        reinstalled.body.installation.status === 'ACTIVE',
      'A removed domain-pack installation may be followed by a fresh active installation without rewriting history.'
    );

    const packRows = await postgresPool().query(
      `SELECT id, status
       FROM platform_domain_pack_installations
       WHERE account_id = $1 AND pack_id = $2
       ORDER BY installed_at ASC, id ASC`,
      [accountA, 'inventory.operations']
    );
    assert(
      packRows.rows.length === 2 &&
        packRows.rows.filter((row) => row.status === 'ACTIVE').length === 1 &&
        packRows.rows.filter((row) => row.status === 'REMOVED').length === 1,
      'PostgreSQL runtime must preserve installation history while enforcing one active pack.'
    );

    const ownInstallations = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/installations',
        {
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    const foreignInstallations = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/domain-packs/installations',
        {
          headers: {
            Authorization: 'Bearer ' + keyB.secret,
            'X-Account-ID': accountA,
          },
        }
      )
    );
    assert(
      ownInstallations.response.status === 200 &&
        ownInstallations.body.installations.length === 2 &&
        foreignInstallations.response.status === 200 &&
        foreignInstallations.body.installations.length === 0,
      'Domain-pack listing must remain account scoped in PostgreSQL mode.'
    );

    // 4. Registered tool reads selected PostgreSQL state and audit is relational.
    const toolResult = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/knowledge.entity.get/invoke',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
            'Content-Type': 'application/json',
            'X-Account-ID': accountB,
          },
          body: JSON.stringify({
            input: { entityId: entity.id },
          }),
        }
      )
    );
    assert(
      toolResult.response.status === 200 &&
        toolResult.body.result?.entity?.id === entity.id &&
        toolResult.body.result?.entity?.accountId === accountA &&
        typeof toolResult.body.invocation_id === 'string',
      'Registered Knowledge tool must read PostgreSQL company state without trusting spoofed account headers.'
    );

    const invocationId = toolResult.body.invocation_id as string;
    const invocation =
      await postgresPlatformStateRepository.getToolInvocation(
        accountA,
        invocationId
      );
    assert(
      invocation?.status === 'SUCCEEDED' &&
        invocation.apiKeyId === keyA.apiKey.id &&
        invocation.toolId === 'knowledge.entity.get' &&
        /^[a-f0-9]{64}$/.test(invocation.inputHash) &&
        (
          await postgresPlatformStateRepository.getToolInvocation(
            accountB,
            invocationId
          )
        ) === null,
      'Registered tool invocation audit must persist privacy-safe same-account API-key ownership in PostgreSQL.'
    );

    const auditHttp = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/invocations?toolId=knowledge.entity.get',
        {
          headers: {
            Authorization: 'Bearer ' + keyA.secret,
          },
        }
      )
    );
    const foreignAuditHttp = await json(
      await fetch(
        baseUrl +
          '/api/platform/v1/tools/invocations?toolId=knowledge.entity.get',
        {
          headers: {
            Authorization: 'Bearer ' + keyB.secret,
            'X-Account-ID': accountA,
          },
        }
      )
    );
    assert(
      auditHttp.response.status === 200 &&
        auditHttp.body.invocations.some(
          (item: any) => item.id === invocationId
        ) &&
        foreignAuditHttp.response.status === 200 &&
        foreignAuditHttp.body.invocations.length === 0,
      'Stable tool-audit API must read account-scoped PostgreSQL invocation history.'
    );

    // 5. PostgreSQL pool/persistence reconstruction must preserve Platform state.
    await closePostgresPool();
    const reconstructed = new PlatformPersistence();
    const reconstructedInstallations =
      await reconstructed.listDomainPackInstallations(accountA);
    const reconstructedInvocations =
      await reconstructed.listToolInvocations({
        accountId: accountA,
        toolId: 'knowledge.entity.get',
        limit: 20,
      });

    assert(
      reconstructed.usesPostgres() &&
        reconstructedInstallations.some(
          (item) =>
            item.id === reinstalled.body.installation.id &&
            item.status === 'ACTIVE'
        ) &&
        reconstructedInstallations.some(
          (item) =>
            item.id === firstInstallationId &&
            item.status === 'REMOVED'
        ) &&
        reconstructedInvocations.some(
          (item) =>
            item.id === invocationId &&
            item.status === 'SUCCEEDED'
        ),
      'Platform installation/audit state must survive PostgreSQL pool and persistence reconstruction.'
    );

    const dbEvidence = await postgresPool().query(
      `SELECT
        (SELECT count(*)::int
           FROM platform_domain_pack_installations
          WHERE account_id = $1) AS installations,
        (SELECT count(*)::int
           FROM platform_tool_invocation_audit
          WHERE account_id = $1) AS invocations`,
      [accountA]
    );
    assert(
      Number(dbEvidence.rows[0]?.installations) === 2 &&
        Number(dbEvidence.rows[0]?.invocations) >= 1,
      'A7F PostgreSQL tables must contain durable Platform runtime state.'
    );
  } finally {
    await new Promise<void>((resolve) =>
      server.close(() => resolve())
    );
    await closePostgresPool();
  }

  for (const file of legacyFiles) {
    assert(
      snapshot(file) === legacyBefore.get(file),
      'PostgreSQL A7F runtime must not mutate legacy Platform JSON file: ' +
        path.basename(file)
    );
  }

  console.log('PRODUCTION_A7F_PLATFORM_RUNTIME_CHECK_PASSED');
  console.log(
    'PostgreSQL domain-pack installation/removal/reinstall history, one-active invariant, stable Platform knowledge reads, registered-tool execution/audit, API-key ownership, restart durability, account isolation, and zero legacy Platform JSON mutation are verified.'
  );
}

main().catch(async (error) => {
  console.error('PRODUCTION_A7F_PLATFORM_RUNTIME_CHECK_FAILED');
  console.error(error);
  await closePostgresPool();
  process.exit(1);
});
