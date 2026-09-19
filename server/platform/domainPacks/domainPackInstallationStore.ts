import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  DomainPackInstallation,
  DomainPackInstallationStatus,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(
  DATA_DIR,
  'platform_domain_packs.json'
);

type PersistedState = {
  installations: DomainPackInstallation[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function id(): string {
  return 'dpack_' + crypto.randomBytes(10).toString('hex');
}

export class DomainPackAccessError extends Error {
  public readonly statusCode = 404;
  public readonly code = 'DOMAIN_PACK_INSTALLATION_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'DomainPackAccessError';
  }
}

export class DomainPackInstallationStore {
  private installations =
    new Map<string, DomainPackInstallation>();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(FILE)) return;
      const parsed = JSON.parse(
        fs.readFileSync(FILE, 'utf8')
      ) as Partial<PersistedState>;
      for (const item of parsed.installations || []) {
        this.installations.set(item.id, item);
      }
    } catch (error) {
      console.warn(
        'Could not load domain-pack installation state:',
        error
      );
    }
  }

  private save(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const state: PersistedState = {
      installations: Array.from(
        this.installations.values()
      ).slice(-5000),
    };
    const temporary = FILE + '.tmp';
    fs.writeFileSync(
      temporary,
      JSON.stringify(state, null, 2),
      'utf8'
    );
    fs.renameSync(temporary, FILE);
  }

  public install(params: {
    accountId: string;
    packId: string;
    packVersion: string;
  }): DomainPackInstallation {
    const existing = Array.from(
      this.installations.values()
    ).find(
      (item) =>
        item.accountId === params.accountId &&
        item.packId === params.packId &&
        item.packVersion === params.packVersion &&
        item.status === 'ACTIVE'
    );
    if (existing) return clone(existing);

    const now = Date.now();
    const installation: DomainPackInstallation = {
      id: id(),
      accountId: params.accountId,
      packId: params.packId,
      packVersion: params.packVersion,
      status: 'ACTIVE',
      installedAt: now,
      updatedAt: now,
    };
    this.installations.set(
      installation.id,
      installation
    );
    this.save();
    return clone(installation);
  }

  public list(
    accountId: string
  ): DomainPackInstallation[] {
    return Array.from(this.installations.values())
      .filter((item) => item.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(clone);
  }

  public getActive(params: {
    accountId: string;
    packId: string;
  }): DomainPackInstallation | null {
    const item = Array.from(
      this.installations.values()
    )
      .filter(
        (candidate) =>
          candidate.accountId === params.accountId &&
          candidate.packId === params.packId &&
          candidate.status === 'ACTIVE'
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return item ? clone(item) : null;
  }

  public requireActive(params: {
    accountId: string;
    packId: string;
  }): DomainPackInstallation {
    const item = this.getActive(params);
    if (!item) {
      throw new DomainPackAccessError(
        'Domain pack is not installed in the current account.'
      );
    }
    return item;
  }

  public setStatus(params: {
    accountId: string;
    installationId: string;
    status: DomainPackInstallationStatus;
  }): DomainPackInstallation {
    const current = this.installations.get(
      params.installationId
    );
    if (
      !current ||
      current.accountId !== params.accountId
    ) {
      throw new DomainPackAccessError(
        'Domain pack installation not found in the current account.'
      );
    }

    const updated: DomainPackInstallation = {
      ...current,
      status: params.status,
      updatedAt: Date.now(),
    };
    this.installations.set(updated.id, updated);
    this.save();
    return clone(updated);
  }
}

export const domainPackInstallationStore =
  new DomainPackInstallationStore();
