import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ToolInvocationAudit,
  ToolInvocationStatus,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const AUDIT_FILE = path.join(
  DATA_DIR,
  'platform_tool_invocations.json'
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ToolInvocationAuditStore {
  private records = new Map<string, ToolInvocationAudit>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(AUDIT_FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(AUDIT_FILE, 'utf8')
      );
      if (!Array.isArray(parsed)) return;
      for (const record of parsed) {
        this.records.set(record.id, record);
      }
    } catch (error) {
      console.warn(
        'Could not load platform tool invocation audit:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const state = Array.from(this.records.values()).slice(
      -10000
    );
    const temporary = AUDIT_FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, AUDIT_FILE);
  }

  public start(params: {
    accountId: string;
    toolId: string;
    toolVersion: string;
    requestId: string;
    apiKeyId: string;
    inputHash: string;
  }): ToolInvocationAudit {
    const record: ToolInvocationAudit = {
      id:
        'tinv_' +
        crypto.randomBytes(10).toString('hex'),
      accountId: params.accountId,
      toolId: params.toolId,
      toolVersion: params.toolVersion,
      requestId: params.requestId,
      apiKeyId: params.apiKeyId,
      status: 'STARTED',
      inputHash: params.inputHash,
      startedAt: Date.now(),
    };
    this.records.set(record.id, record);
    this.save();
    return clone(record);
  }

  public finish(params: {
    accountId: string;
    invocationId: string;
    status: Exclude<
      ToolInvocationStatus,
      'STARTED'
    >;
    errorCode?: string;
    errorMessage?: string;
  }): ToolInvocationAudit {
    const current = this.records.get(params.invocationId);
    if (
      !current ||
      current.accountId !== params.accountId
    ) {
      throw new Error(
        'Tool invocation audit record not found.'
      );
    }

    const updated: ToolInvocationAudit = {
      ...current,
      status: params.status,
      completedAt: Date.now(),
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    };
    this.records.set(updated.id, updated);
    this.save();
    return clone(updated);
  }

  public list(params: {
    accountId: string;
    toolId?: string;
    limit?: number;
  }): ToolInvocationAudit[] {
    const limit = Math.max(
      1,
      Math.min(params.limit || 100, 1000)
    );
    return Array.from(this.records.values())
      .filter(
        (item) =>
          item.accountId === params.accountId &&
          (!params.toolId ||
            item.toolId === params.toolId)
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map(clone);
  }
}

export const toolInvocationAuditStore =
  new ToolInvocationAuditStore();
