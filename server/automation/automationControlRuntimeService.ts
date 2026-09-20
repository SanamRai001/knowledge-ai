import type { RequestIdentity } from '../requestIdentity.js';
import {
  automationActorLabel,
  resolveAutomationActorRole,
} from './automationActor.js';
import {
  AutomationControlError,
  automationControlService,
} from './automationControlService.js';
import { automationPersistence } from './automationPersistence.js';
import type { AutomationControlState } from './types.js';

const CONTROL_ROLES = ['OWNER', 'ADMIN'] as const;

export class AutomationControlRuntimeService {
  public async get(
    accountId: string
  ): Promise<AutomationControlState> {
    if (!automationPersistence.usesPostgres()) {
      return automationControlService.get(accountId);
    }
    return automationPersistence.getControl(accountId);
  }

  public async disable(params: {
    accountId: string;
    identity: RequestIdentity;
    reason?: string;
  }): Promise<AutomationControlState> {
    if (!automationPersistence.usesPostgres()) {
      return automationControlService.disable(params);
    }
    this.requireControlRole(params.identity);
    return automationPersistence.setControl({
      accountId: params.accountId,
      emergencyDisabled: true,
      actor: automationActorLabel(params.identity),
      reason:
        params.reason?.trim() ||
        'Emergency automation stop enabled by workspace administrator.',
    });
  }

  public async enable(params: {
    accountId: string;
    identity: RequestIdentity;
    reason?: string;
  }): Promise<AutomationControlState> {
    if (!automationPersistence.usesPostgres()) {
      return automationControlService.enable(params);
    }
    this.requireControlRole(params.identity);
    return automationPersistence.setControl({
      accountId: params.accountId,
      emergencyDisabled: false,
      actor: automationActorLabel(params.identity),
      reason:
        params.reason?.trim() ||
        'Emergency automation stop cleared by workspace administrator.',
    });
  }

  private requireControlRole(identity: RequestIdentity): void {
    const role = resolveAutomationActorRole(identity);
    if (
      !CONTROL_ROLES.includes(
        role as (typeof CONTROL_ROLES)[number]
      )
    ) {
      throw new AutomationControlError(
        'Only OWNER or ADMIN actors may change the workspace emergency automation control.'
      );
    }
  }
}

export const automationControlRuntimeService =
  new AutomationControlRuntimeService();
