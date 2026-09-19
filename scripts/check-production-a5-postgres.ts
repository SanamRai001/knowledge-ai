import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { closePostgresPool, postgresPool } from '../server/persistence/postgres.js';
import { runPostgresMigrations } from '../server/persistence/migrationRunner.js';
import {
  postgresAccountRepository,
  postgresApiKeyRepository,
} from '../server/persistence/postgresRepositories.js';
import {
  postgresActionRepository,
} from '../server/persistence/a3PostgresRepositories.js';
import {
  postgresAutomationGovernanceTransactionRepository,
  postgresAutomationRepository,
  postgresPlatformStateRepository,
} from '../server/persistence/a5PostgresRepositories.js';
import {
  importLegacyA5,
  readLegacyA5Snapshot,
} from '../server/persistence/a5LegacyImporter.js';
import type {
  AutomationApprovalRequest,
  AutomationControlRevision,
  AutomationControlState,
  AutomationPolicy,
  AutomationPolicyRevision,
  AutomationRun,
} from '../server/automation/types.js';
import type { ActionProposal } from '../server/actions/types.js';
import type { DomainPackInstallation } from '../server/platform/domainPacks/types.js';
import type { ToolInvocationAudit } from '../server/platform/tools/types.js';
import type { ApiKey } from '../src/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function resetA5(): Promise<void> {
  await postgresPool().query(`
    TRUNCATE TABLE
      platform_tool_invocation_audit,
      platform_domain_pack_installations,
      automation_runs,
      automation_control_revisions,
      automation_controls,
      automation_approvals,
      automation_policy_revisions,
      automation_policies
    CASCADE
  `);
}

function proposal(params: {
  id: string;
  accountId: string;
  status?: ActionProposal['status'];
}): ActionProposal {
  return {
    id: params.id,
    accountId: params.accountId,
    instruction: 'Receive 2 units of product.',
    intent: 'RECEIVE_INVENTORY',
    status: params.status || 'PROPOSED',
    parserSource: 'DETERMINISTIC',
    parsedInput: {
      intent: 'RECEIVE_INVENTORY',
      productReference: 'A5 Product',
      quantity: 2,
    },
    targetEntityIds: [],
    mutations: [],
    preconditions: [],
    eventData: {},
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: Date.parse('2099-01-01T00:00:00Z'),
  };
}

function policy(params: {
  id: string;
  accountId: string;
  version: number;
  createdAt?: number;
}): AutomationPolicy {
  const createdAt = params.createdAt ?? 1000;
  return {
    id: params.id,
    accountId: params.accountId,
    version: params.version,
    enabled: true,
    mode: 'AUTO_EXECUTE_LOW_RISK',
    allowedActionIntents: ['RECEIVE_INVENTORY'],
    maxRiskClass: 'LOW',
    maxQuantity: 10,
    allowedIdentitySources: ['API_KEY'],
    allowedActorRoles: ['SERVICE'],
    approvalRoles: ['OWNER', 'ADMIN', 'APPROVER'],
    allowedTargetEntityTypes: ['PRODUCT'],
    createdAt,
    updatedAt: createdAt + params.version,
    createdBy: 'service:a5',
    updatedBy: 'service:a5',
  };
}

function policyRevision(
  p: AutomationPolicy,
  id: string,
  reason: AutomationPolicyRevision['reason']
): AutomationPolicyRevision {
  return {
    id,
    accountId: p.accountId,
    policyId: p.id,
    version: p.version,
    snapshot: structuredClone(p),
    changedAt: p.updatedAt,
    changedBy: p.updatedBy,
    reason,
  };
}

function approval(params: {
  id: string;
  accountId: string;
  proposalId: string;
  policyId: string;
  policyVersion: number;
}): AutomationApprovalRequest {
  return {
    id: params.id,
    accountId: params.accountId,
    proposalId: params.proposalId,
    policyId: params.policyId,
    policyVersion: params.policyVersion,
    status: 'PENDING',
    requestedBy: 'service:a5',
    requestedByRole: 'SERVICE',
    eligibleRoles: ['OWNER', 'ADMIN', 'APPROVER'],
    decisionReasonCodes: ['POLICY_REQUIRES_APPROVAL'],
    decisionReasons: ['A5 relational approval fixture.'],
    requestedAt: 2000,
    expiresAt: Date.parse('2099-01-01T00:00:00Z'),
  };
}

function control(params: {
  accountId: string;
  version: number;
  disabled: boolean;
}): AutomationControlState {
  return {
    accountId: params.accountId,
    version: params.version,
    emergencyDisabled: params.disabled,
    reason: params.disabled ? 'A5 emergency test.' : undefined,
    updatedAt: 3000 + params.version,
    updatedBy: 'owner:a5',
  };
}

function controlRevision(
  state: AutomationControlState,
  id: string
): AutomationControlRevision {
  return {
    id,
    accountId: state.accountId,
    version: state.version,
    snapshot: structuredClone(state),
    changedAt: state.updatedAt,
    changedBy: state.updatedBy,
  };
}

function run(params: {
  id: string;
  accountId: string;
  proposalId: string;
  policyId?: string;
  policyVersion?: number;
}): AutomationRun {
  return {
    id: params.id,
    accountId: params.accountId,
    proposalId: params.proposalId,
    status: 'RUNNING',
    attemptCount: 1,
    maxAttempts: 3,
    actor: 'service:a5',
    actorRole: 'SERVICE',
    policyId: params.policyId,
    policyVersion: params.policyVersion,
    startedAt: 4000,
    updatedAt: 4000,
  };
}

function pack(params: {
  id: string;
  accountId: string;
  version: string;
  status?: DomainPackInstallation['status'];
}): DomainPackInstallation {
  return {
    id: params.id,
    accountId: params.accountId,
    packId: 'restaurant-ops',
    packVersion: params.version,
    status: params.status || 'ACTIVE',
    installedAt: 5000,
    updatedAt: 5000,
  };
}

function toolAudit(params: {
  id: string;
  accountId: string;
  apiKeyId: string;
}): ToolInvocationAudit {
  return {
    id: params.id,
    accountId: params.accountId,
    toolId: 'knowledge.ask',
    toolVersion: '1.0.0',
    requestId: 'req_' + params.id,
    apiKeyId: params.apiKeyId,
    status: 'STARTED',
    inputHash: crypto
      .createHash('sha256')
      .update(params.id, 'utf8')
      .digest('hex'),
    startedAt: 6000,
  };
}

function apiKey(params: {
  id: string;
  accountId: string;
  hashSeed: string;
}): ApiKey {
  return {
    id: params.id,
    accountId: params.accountId,
    name: 'A5 API key ' + params.id,
    keyPrefix: 'kn_test_',
    keyHash: crypto
      .createHash('sha256')
      .update(params.hashSeed)
      .digest('hex'),
    maskedKey: 'kn_test_••••' + params.id.slice(-4),
    environment: 'test',
    scopes: ['platform:tools:invoke', 'knowledge:read'],
    status: 'active',
    createdAt: 7000,
    lastUsedAt: null,
    expiresAt: null,
  };
}

function writeJson(dir: string, name: string, value: unknown): void {
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify(value, null, 2),
    'utf8'
  );
}

async function main() {
  assert(
    Boolean(process.env.DATABASE_URL),
    'DATABASE_URL is required for the A5 PostgreSQL proof.'
  );

  const migrations = await runPostgresMigrations();
  assert(
    migrations.applied.includes('004') ||
      migrations.alreadyApplied.includes('004'),
    'Migration 004 must be present in migration history.'
  );

  await resetA5();

  const accountA = 'acc_a5_pg_a';
  const accountB = 'acc_a5_pg_b';
  await postgresAccountRepository.ensureAccount(accountA);
  await postgresAccountRepository.ensureAccount(accountB);

  const proposalA = proposal({
    id: 'act_a5_a',
    accountId: accountA,
  });
  const proposalB = proposal({
    id: 'act_a5_b',
    accountId: accountB,
  });
  await postgresActionRepository.saveProposal(proposalA);
  await postgresActionRepository.saveProposal(proposalB);

  const keyA = apiKey({
    id: 'key_a5_a',
    accountId: accountA,
    hashSeed: 'a5-key-a',
  });
  const keyB = apiKey({
    id: 'key_a5_b',
    accountId: accountB,
    hashSeed: 'a5-key-b',
  });
  await postgresApiKeyRepository.create(keyA);
  await postgresApiKeyRepository.create(keyB);

  // 1. Policy + immutable revision are one optimistic transaction.
  const policyV1 = policy({
    id: 'autopol_a5',
    accountId: accountA,
    version: 1,
  });
  const revisionV1 = policyRevision(
    policyV1,
    'autopolrev_a5_1',
    'CREATED'
  );
  await postgresAutomationGovernanceTransactionRepository.commitPolicyRevision({
    policy: policyV1,
    revision: revisionV1,
    expectedPreviousVersion: 0,
  });

  assert(
    (await postgresAutomationRepository.getPolicy(accountA))?.version === 1 &&
      (await postgresAutomationRepository.getPolicy(accountB)) === null &&
      (
        await postgresAutomationRepository.listPolicyRevisions({
          accountId: accountA,
        })
      ).length === 1,
    'Automation policy/current revision must persist atomically and remain account scoped.'
  );

  const stalePolicyV2 = {
    ...policyV1,
    version: 2,
    updatedAt: 2002,
  };
  let stalePolicyBlocked = false;
  try {
    await postgresAutomationGovernanceTransactionRepository.commitPolicyRevision({
      policy: stalePolicyV2,
      revision: policyRevision(
        stalePolicyV2,
        'autopolrev_a5_stale',
        'UPDATED'
      ),
      expectedPreviousVersion: 0,
    });
  } catch (error: any) {
    stalePolicyBlocked = String(error?.message || '').includes(
      'AUTOMATION_POLICY_VERSION_STALE'
    );
  }

  assert(
    stalePolicyBlocked &&
      (await postgresAutomationRepository.getPolicy(accountA))?.version === 1 &&
      (
        await postgresAutomationRepository.listPolicyRevisions({
          accountId: accountA,
        })
      ).length === 1,
    'Stale policy transaction must roll back both current state and revision append.'
  );

  const policyV2 = {
    ...policyV1,
    version: 2,
    maxQuantity: 5,
    updatedAt: 2003,
  };
  await postgresAutomationGovernanceTransactionRepository.commitPolicyRevision({
    policy: policyV2,
    revision: policyRevision(
      policyV2,
      'autopolrev_a5_2',
      'UPDATED'
    ),
    expectedPreviousVersion: 1,
  });

  // 2. Approval must reference a same-account Action proposal + exact policy revision.
  const approvalA = approval({
    id: 'autoapr_a5',
    accountId: accountA,
    proposalId: proposalA.id,
    policyId: policyV2.id,
    policyVersion: 2,
  });
  await postgresAutomationRepository.saveApproval(approvalA);
  assert(
    (
      await postgresAutomationRepository.getApproval(
        accountA,
        approvalA.id
      )
    )?.proposalId === proposalA.id &&
      (
        await postgresAutomationRepository.getApproval(
          accountB,
          approvalA.id
        )
      ) === null,
    'Automation approval reads must remain account scoped.'
  );

  let foreignApprovalBlocked = false;
  try {
    await postgresAutomationRepository.saveApproval({
      ...approvalA,
      id: 'autoapr_a5_foreign',
      accountId: accountB,
      proposalId: proposalA.id,
    });
  } catch {
    foreignApprovalBlocked = true;
  }
  assert(
    foreignApprovalBlocked,
    'Database must reject cross-account Automation approval → Action proposal links.'
  );

  // 3. Emergency control + revision commit together and stale writes roll back.
  const controlV1 = control({
    accountId: accountA,
    version: 1,
    disabled: true,
  });
  await postgresAutomationGovernanceTransactionRepository.commitControlRevision({
    control: controlV1,
    revision: controlRevision(controlV1, 'autoctlrev_a5_1'),
    expectedPreviousVersion: 0,
  });

  const staleControlV2 = control({
    accountId: accountA,
    version: 2,
    disabled: false,
  });
  let staleControlBlocked = false;
  try {
    await postgresAutomationGovernanceTransactionRepository.commitControlRevision({
      control: staleControlV2,
      revision: controlRevision(
        staleControlV2,
        'autoctlrev_a5_stale'
      ),
      expectedPreviousVersion: 0,
    });
  } catch (error: any) {
    staleControlBlocked = String(error?.message || '').includes(
      'AUTOMATION_CONTROL_VERSION_STALE'
    );
  }

  assert(
    staleControlBlocked &&
      (await postgresAutomationRepository.getControl(accountA))
        ?.emergencyDisabled === true &&
      (
        await postgresAutomationRepository.listControlRevisions({
          accountId: accountA,
        })
      ).length === 1,
    'Kill-switch stale update must not change control without its immutable revision.'
  );

  // 4. Automation runs link to same-account proposals and policy revisions.
  const runA = run({
    id: 'autorun_a5',
    accountId: accountA,
    proposalId: proposalA.id,
    policyId: policyV2.id,
    policyVersion: 2,
  });
  await postgresAutomationRepository.saveRun(runA);

  let foreignRunBlocked = false;
  try {
    await postgresAutomationRepository.saveRun({
      ...runA,
      id: 'autorun_a5_foreign',
      accountId: accountB,
      proposalId: proposalA.id,
    });
  } catch {
    foreignRunBlocked = true;
  }
  assert(
    foreignRunBlocked,
    'Database must reject cross-account Automation run → Action proposal links.'
  );

  // 5. One active installation per account/pack.
  const packV1 = pack({
    id: 'dpack_a5_v1',
    accountId: accountA,
    version: '1.0.0',
  });
  await postgresPlatformStateRepository.saveDomainPackInstallation(
    packV1
  );

  let duplicateActivePackBlocked = false;
  try {
    await postgresPlatformStateRepository.saveDomainPackInstallation(
      pack({
        id: 'dpack_a5_v2',
        accountId: accountA,
        version: '2.0.0',
      })
    );
  } catch {
    duplicateActivePackBlocked = true;
  }
  assert(
    duplicateActivePackBlocked,
    'Database must permit only one ACTIVE domain-pack installation per account/pack.'
  );

  await postgresPlatformStateRepository.saveDomainPackInstallation({
    ...packV1,
    status: 'REMOVED',
    updatedAt: 5100,
  });
  const packV2 = pack({
    id: 'dpack_a5_v2',
    accountId: accountA,
    version: '2.0.0',
  });
  await postgresPlatformStateRepository.saveDomainPackInstallation(
    packV2
  );

  // 6. Tool audit must link to same-account API key.
  const invocation = toolAudit({
    id: 'tinv_a5',
    accountId: accountA,
    apiKeyId: keyA.id,
  });
  await postgresPlatformStateRepository.saveToolInvocation(invocation);
  await postgresPlatformStateRepository.saveToolInvocation({
    ...invocation,
    status: 'SUCCEEDED',
    completedAt: 6100,
  });

  assert(
    (
      await postgresPlatformStateRepository.getToolInvocation(
        accountA,
        invocation.id
      )
    )?.status === 'SUCCEEDED',
    'Tool invocation audit must support STARTED → terminal-state persistence.'
  );

  let foreignApiKeyBlocked = false;
  try {
    await postgresPlatformStateRepository.saveToolInvocation(
      toolAudit({
        id: 'tinv_a5_foreign_key',
        accountId: accountA,
        apiKeyId: keyB.id,
      })
    );
  } catch {
    foreignApiKeyBlocked = true;
  }
  assert(
    foreignApiKeyBlocked,
    'Database must reject ToolInvocationAudit → foreign-account API key links.'
  );

  // 7. Legacy A5 import is dry-run capable, idempotent, and source non-destructive.
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knowledge-ai-a5-')
  );
  const legacyAccount = 'acc_a5_legacy';
  await postgresAccountRepository.ensureAccount(legacyAccount);

  const legacyProposal = proposal({
    id: 'act_a5_legacy',
    accountId: legacyAccount,
  });
  await postgresActionRepository.saveProposal(legacyProposal);

  const legacyKey = apiKey({
    id: 'key_a5_legacy',
    accountId: legacyAccount,
    hashSeed: 'a5-key-legacy',
  });
  await postgresApiKeyRepository.create(legacyKey);

  const legacyPolicy = policy({
    id: 'autopol_a5_legacy',
    accountId: legacyAccount,
    version: 1,
  });
  const legacyPolicyRevision = policyRevision(
    legacyPolicy,
    'autopolrev_a5_legacy',
    'CREATED'
  );
  const legacyApproval = approval({
    id: 'autoapr_a5_legacy',
    accountId: legacyAccount,
    proposalId: legacyProposal.id,
    policyId: legacyPolicy.id,
    policyVersion: 1,
  });
  const legacyRun = run({
    id: 'autorun_a5_legacy',
    accountId: legacyAccount,
    proposalId: legacyProposal.id,
    policyId: legacyPolicy.id,
    policyVersion: 1,
  });
  const legacyControl = control({
    accountId: legacyAccount,
    version: 1,
    disabled: true,
  });
  const legacyControlRevision = controlRevision(
    legacyControl,
    'autoctlrev_a5_legacy'
  );
  const legacyPack = pack({
    id: 'dpack_a5_legacy',
    accountId: legacyAccount,
    version: '1.0.0',
  });
  const legacyInvocation = toolAudit({
    id: 'tinv_a5_legacy',
    accountId: legacyAccount,
    apiKeyId: legacyKey.id,
  });

  writeJson(tempDir, 'automation-policies.json', {
    policies: [legacyPolicy],
    revisions: [legacyPolicyRevision],
  });
  writeJson(tempDir, 'automation-approvals.json', {
    approvals: [legacyApproval],
  });
  writeJson(tempDir, 'automation-runs.json', {
    runs: [legacyRun],
  });
  writeJson(tempDir, 'automation-control.json', {
    controls: [legacyControl],
    revisions: [legacyControlRevision],
  });
  writeJson(tempDir, 'platform_domain_packs.json', {
    installations: [legacyPack],
  });
  writeJson(tempDir, 'platform_tool_invocations.json', [
    legacyInvocation,
  ]);

  const sourceFiles = [
    'automation-policies.json',
    'automation-approvals.json',
    'automation-runs.json',
    'automation-control.json',
    'platform_domain_packs.json',
    'platform_tool_invocations.json',
  ];
  const before = Object.fromEntries(
    sourceFiles.map((name) => [
      name,
      fs.readFileSync(path.join(tempDir, name), 'utf8'),
    ])
  );

  const snapshot = readLegacyA5Snapshot(tempDir);
  const dryRun = await importLegacyA5({
    snapshot,
    dryRun: true,
  });
  assert(
    dryRun.conflicts.length === 0 &&
      Object.values(dryRun.imported).every((count) => count === 0),
    'A5 dry-run must validate without writes.'
  );

  const imported = await importLegacyA5({ snapshot });
  assert(
    imported.conflicts.length === 0 &&
      Object.values(imported.imported).every((count) => count === 1),
    'A5 first legacy import must preserve all record IDs.'
  );

  const repeated = await importLegacyA5({ snapshot });
  assert(
    repeated.conflicts.length === 0 &&
      Object.values(repeated.imported).every((count) => count === 0) &&
      repeated.skippedExisting === 8,
    'A5 legacy import must be idempotent. ' +
      JSON.stringify(repeated)
  );

  assert(
    sourceFiles.every(
      (name) =>
        fs.readFileSync(path.join(tempDir, name), 'utf8') ===
        before[name]
    ),
    'A5 legacy importer must never mutate source JSON files.'
  );

  assert(
    (await postgresAutomationRepository.getPolicy(legacyAccount))?.id ===
      legacyPolicy.id &&
      (
        await postgresPlatformStateRepository.getToolInvocation(
          legacyAccount,
          legacyInvocation.id
        )
      )?.id === legacyInvocation.id,
    'A5 import must preserve Automation and Platform record identities.'
  );

  console.log('PRODUCTION_A5_POSTGRES_CHECK_PASSED');
  console.log(
    'Migration 004, transactional policy/kill-switch revisions, approval/run ownership, domain-pack active uniqueness, tool-audit API-key ownership, and idempotent A5 legacy import are verified.'
  );
}

main()
  .catch((error) => {
    console.error('PRODUCTION_A5_POSTGRES_CHECK_FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
