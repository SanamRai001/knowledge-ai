import fs from 'fs';
import path from 'path';
import type {
  AutomationApprovalRequest,
  AutomationControlRevision,
  AutomationControlState,
  AutomationPolicy,
  AutomationPolicyRevision,
  AutomationRun,
} from '../automation/types.js';
import type { DomainPackInstallation } from '../platform/domainPacks/types.js';
import type { ToolInvocationAudit } from '../platform/tools/types.js';
import {
  postgresAutomationRepository,
  postgresPlatformStateRepository,
} from './a5PostgresRepositories.js';
import { postgresPool } from './postgres.js';

type LegacyPolicyState = {
  policies?: AutomationPolicy[];
  revisions?: AutomationPolicyRevision[];
};

type LegacyApprovalState = {
  approvals?: AutomationApprovalRequest[];
};

type LegacyRunState = {
  runs?: AutomationRun[];
};

type LegacyControlState = {
  controls?: AutomationControlState[];
  revisions?: AutomationControlRevision[];
};

type LegacyDomainPackState = {
  installations?: DomainPackInstallation[];
};

export interface LegacyA5Snapshot {
  dataDir: string;
  policies: AutomationPolicy[];
  policyRevisions: AutomationPolicyRevision[];
  approvals: AutomationApprovalRequest[];
  runs: AutomationRun[];
  controls: AutomationControlState[];
  controlRevisions: AutomationControlRevision[];
  domainPacks: DomainPackInstallation[];
  toolInvocations: ToolInvocationAudit[];
}

export interface LegacyA5Conflict {
  kind:
    | 'ACCOUNT'
    | 'AUTOMATION_POLICY'
    | 'AUTOMATION_POLICY_REVISION'
    | 'AUTOMATION_APPROVAL'
    | 'AUTOMATION_RUN'
    | 'AUTOMATION_CONTROL'
    | 'AUTOMATION_CONTROL_REVISION'
    | 'DOMAIN_PACK_INSTALLATION'
    | 'TOOL_INVOCATION';
  id: string;
  message: string;
}

type CounterKey =
  | 'policies'
  | 'policyRevisions'
  | 'approvals'
  | 'runs'
  | 'controls'
  | 'controlRevisions'
  | 'domainPacks'
  | 'toolInvocations';

export interface LegacyA5ImportReport {
  dryRun: boolean;
  sourceDataDir: string;
  counts: Record<CounterKey, number>;
  imported: Record<CounterKey, number>;
  skippedExisting: number;
  conflicts: LegacyA5Conflict[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function canonical(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)])
    );
  }
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function readLegacyA5Snapshot(
  dataDir = path.join(process.cwd(), 'data')
): LegacyA5Snapshot {
  const policies = readJson<LegacyPolicyState>(
    path.join(dataDir, 'automation-policies.json'),
    {}
  );
  const approvals = readJson<LegacyApprovalState>(
    path.join(dataDir, 'automation-approvals.json'),
    {}
  );
  const runs = readJson<LegacyRunState>(
    path.join(dataDir, 'automation-runs.json'),
    {}
  );
  const controls = readJson<LegacyControlState>(
    path.join(dataDir, 'automation-control.json'),
    {}
  );
  const packs = readJson<LegacyDomainPackState>(
    path.join(dataDir, 'platform_domain_packs.json'),
    {}
  );
  const toolInvocations = readJson<ToolInvocationAudit[]>(
    path.join(dataDir, 'platform_tool_invocations.json'),
    []
  );

  return {
    dataDir,
    policies: (policies.policies || []).map(clone),
    policyRevisions: (policies.revisions || []).map(clone),
    approvals: (approvals.approvals || []).map(clone),
    runs: (runs.runs || []).map(clone),
    controls: (controls.controls || []).map(clone),
    controlRevisions: (controls.revisions || []).map(clone),
    domainPacks: (packs.installations || []).map(clone),
    toolInvocations: Array.isArray(toolInvocations)
      ? toolInvocations.map(clone)
      : [],
  };
}

function reportFor(
  snapshot: LegacyA5Snapshot,
  dryRun: boolean
): LegacyA5ImportReport {
  return {
    dryRun,
    sourceDataDir: snapshot.dataDir,
    counts: {
      policies: snapshot.policies.length,
      policyRevisions: snapshot.policyRevisions.length,
      approvals: snapshot.approvals.length,
      runs: snapshot.runs.length,
      controls: snapshot.controls.length,
      controlRevisions: snapshot.controlRevisions.length,
      domainPacks: snapshot.domainPacks.length,
      toolInvocations: snapshot.toolInvocations.length,
    },
    imported: {
      policies: 0,
      policyRevisions: 0,
      approvals: 0,
      runs: 0,
      controls: 0,
      controlRevisions: 0,
      domainPacks: 0,
      toolInvocations: 0,
    },
    skippedExisting: 0,
    conflicts: [],
  };
}

async function validateSnapshot(
  snapshot: LegacyA5Snapshot,
  report: LegacyA5ImportReport
): Promise<void> {
  const accountIds = new Set<string>();
  for (const collection of [
    snapshot.policies,
    snapshot.policyRevisions,
    snapshot.approvals,
    snapshot.runs,
    snapshot.controls,
    snapshot.controlRevisions,
    snapshot.domainPacks,
    snapshot.toolInvocations,
  ]) {
    for (const item of collection as Array<{ accountId: string }>) {
      accountIds.add(item.accountId);
    }
  }

  const knownAccounts = new Set<string>();
  for (const accountId of accountIds) {
    const result = await postgresPool().query(
      'SELECT 1 FROM accounts WHERE id = $1',
      [accountId]
    );
    if (result.rowCount) knownAccounts.add(accountId);
  }

  const checkAccount = (
    kind: LegacyA5Conflict['kind'],
    item: { id?: string; accountId: string }
  ) => {
    if (!knownAccounts.has(item.accountId)) {
      report.conflicts.push({
        kind,
        id: item.id || item.accountId,
        message:
          'Account ' +
          item.accountId +
          ' must exist before A5 records are imported.',
      });
    }
  };

  const policies = new Map(
    snapshot.policies.map((item) => [item.id, item])
  );
  const revisions = new Map(
    snapshot.policyRevisions.map((item) => [
      item.policyId + ':' + item.version,
      item,
    ])
  );

  for (const policy of snapshot.policies) {
    checkAccount('AUTOMATION_POLICY', policy);
  }

  for (const revision of snapshot.policyRevisions) {
    checkAccount('AUTOMATION_POLICY_REVISION', revision);
    const policy = policies.get(revision.policyId);
    if (
      !policy ||
      policy.accountId !== revision.accountId ||
      revision.snapshot.id !== policy.id ||
      revision.snapshot.accountId !== revision.accountId ||
      revision.snapshot.version !== revision.version
    ) {
      report.conflicts.push({
        kind: 'AUTOMATION_POLICY_REVISION',
        id: revision.id,
        message:
          'Automation policy revision must reference/snapshot the same-account policy identity and version.',
      });
    }
  }

  const proposalRefs = new Set<string>();
  for (const approval of snapshot.approvals) {
    checkAccount('AUTOMATION_APPROVAL', approval);
    proposalRefs.add(approval.accountId + ':' + approval.proposalId);
    const revision = revisions.get(
      approval.policyId + ':' + approval.policyVersion
    );
    if (!revision || revision.accountId !== approval.accountId) {
      report.conflicts.push({
        kind: 'AUTOMATION_APPROVAL',
        id: approval.id,
        message:
          'Automation approval policy revision must exist in the same account.',
      });
    }
  }

  for (const run of snapshot.runs) {
    checkAccount('AUTOMATION_RUN', run);
    proposalRefs.add(run.accountId + ':' + run.proposalId);
    if (run.compensationProposalId) {
      proposalRefs.add(
        run.accountId + ':' + run.compensationProposalId
      );
    }
    if (run.policyId && run.policyVersion) {
      const revision = revisions.get(
        run.policyId + ':' + run.policyVersion
      );
      if (!revision || revision.accountId !== run.accountId) {
        report.conflicts.push({
          kind: 'AUTOMATION_RUN',
          id: run.id,
          message:
            'Automation run policy revision must exist in the same account.',
        });
      }
    }
  }

  for (const ref of proposalRefs) {
    const separator = ref.indexOf(':');
    const accountId = ref.slice(0, separator);
    const proposalId = ref.slice(separator + 1);
    const result = await postgresPool().query(
      `SELECT 1 FROM action_proposals
       WHERE account_id = $1 AND id = $2`,
      [accountId, proposalId]
    );
    if (!result.rowCount) {
      report.conflicts.push({
        kind: 'AUTOMATION_RUN',
        id: proposalId,
        message:
          'Referenced Action proposal must be migrated before A5 automation state.',
      });
    }
  }

  const controls = new Map(
    snapshot.controls.map((item) => [item.accountId, item])
  );
  for (const control of snapshot.controls) {
    checkAccount('AUTOMATION_CONTROL', control);
  }
  for (const revision of snapshot.controlRevisions) {
    checkAccount('AUTOMATION_CONTROL_REVISION', revision);
    const control = controls.get(revision.accountId);
    if (
      !control ||
      revision.snapshot.accountId !== revision.accountId ||
      revision.snapshot.version !== revision.version
    ) {
      report.conflicts.push({
        kind: 'AUTOMATION_CONTROL_REVISION',
        id: revision.id,
        message:
          'Automation control revision must snapshot the same-account control version.',
      });
    }
  }

  for (const pack of snapshot.domainPacks) {
    checkAccount('DOMAIN_PACK_INSTALLATION', pack);
  }

  for (const invocation of snapshot.toolInvocations) {
    checkAccount('TOOL_INVOCATION', invocation);
    const key = await postgresPool().query(
      `SELECT 1 FROM api_keys
       WHERE account_id = $1 AND id = $2`,
      [invocation.accountId, invocation.apiKeyId]
    );
    if (!key.rowCount) {
      report.conflicts.push({
        kind: 'TOOL_INVOCATION',
        id: invocation.id,
        message:
          'Tool invocation API key must exist in the same account before A5 import.',
      });
    }
  }
}

async function importOne<T extends { id: string }>(params: {
  kind: LegacyA5Conflict['kind'];
  item: T;
  getExisting: () => Promise<T | null>;
  save: () => Promise<void>;
  report: LegacyA5ImportReport;
  counter: CounterKey;
}): Promise<void> {
  const existing = await params.getExisting();
  if (existing) {
    if (!same(existing, params.item)) {
      params.report.conflicts.push({
        kind: params.kind,
        id: params.item.id,
        message:
          params.kind +
          ' already exists with different persisted metadata.',
      });
    } else {
      params.report.skippedExisting += 1;
    }
    return;
  }

  await params.save();
  params.report.imported[params.counter] += 1;
}

export async function importLegacyA5(params: {
  dataDir?: string;
  dryRun?: boolean;
  snapshot?: LegacyA5Snapshot;
} = {}): Promise<LegacyA5ImportReport> {
  const snapshot =
    params.snapshot || readLegacyA5Snapshot(params.dataDir);
  const report = reportFor(snapshot, Boolean(params.dryRun));

  await validateSnapshot(snapshot, report);
  if (params.dryRun || report.conflicts.length > 0) {
    return report;
  }

  for (const policy of snapshot.policies) {
    const existing =
      await postgresAutomationRepository.getPolicy(policy.accountId);
    if (existing) {
      if (!same(existing, policy)) {
        report.conflicts.push({
          kind: 'AUTOMATION_POLICY',
          id: policy.id,
          message:
            'Automation policy already exists with different persisted metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresAutomationRepository.savePolicy(policy);
    report.imported.policies += 1;
  }

  for (const revision of snapshot.policyRevisions) {
    await importOne({
      kind: 'AUTOMATION_POLICY_REVISION',
      item: revision,
      getExisting: () =>
        postgresAutomationRepository.getPolicyRevision(
          revision.accountId,
          revision.id
        ),
      save: () =>
        postgresAutomationRepository.savePolicyRevision(revision),
      report,
      counter: 'policyRevisions',
    });
  }

  for (const approval of snapshot.approvals) {
    await importOne({
      kind: 'AUTOMATION_APPROVAL',
      item: approval,
      getExisting: () =>
        postgresAutomationRepository.getApproval(
          approval.accountId,
          approval.id
        ),
      save: () =>
        postgresAutomationRepository.saveApproval(approval),
      report,
      counter: 'approvals',
    });
  }

  for (const run of snapshot.runs) {
    await importOne({
      kind: 'AUTOMATION_RUN',
      item: run,
      getExisting: () =>
        postgresAutomationRepository.getRun(run.accountId, run.id),
      save: () => postgresAutomationRepository.saveRun(run),
      report,
      counter: 'runs',
    });
  }

  for (const control of snapshot.controls) {
    const existing =
      await postgresAutomationRepository.getControl(control.accountId);
    if (existing) {
      if (!same(existing, control)) {
        report.conflicts.push({
          kind: 'AUTOMATION_CONTROL',
          id: control.accountId,
          message:
            'Automation control already exists with different persisted metadata.',
        });
      } else {
        report.skippedExisting += 1;
      }
      continue;
    }
    await postgresAutomationRepository.saveControl(control);
    report.imported.controls += 1;
  }

  for (const revision of snapshot.controlRevisions) {
    await importOne({
      kind: 'AUTOMATION_CONTROL_REVISION',
      item: revision,
      getExisting: () =>
        postgresAutomationRepository.getControlRevision(
          revision.accountId,
          revision.id
        ),
      save: () =>
        postgresAutomationRepository.saveControlRevision(revision),
      report,
      counter: 'controlRevisions',
    });
  }

  for (const pack of snapshot.domainPacks) {
    await importOne({
      kind: 'DOMAIN_PACK_INSTALLATION',
      item: pack,
      getExisting: () =>
        postgresPlatformStateRepository.getDomainPackInstallation(
          pack.accountId,
          pack.id
        ),
      save: () =>
        postgresPlatformStateRepository.saveDomainPackInstallation(
          pack
        ),
      report,
      counter: 'domainPacks',
    });
  }

  for (const invocation of snapshot.toolInvocations) {
    await importOne({
      kind: 'TOOL_INVOCATION',
      item: invocation,
      getExisting: () =>
        postgresPlatformStateRepository.getToolInvocation(
          invocation.accountId,
          invocation.id
        ),
      save: () =>
        postgresPlatformStateRepository.saveToolInvocation(
          invocation
        ),
      report,
      counter: 'toolInvocations',
    });
  }

  return report;
}
