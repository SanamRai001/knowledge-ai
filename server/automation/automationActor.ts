import type { RequestIdentity } from '../requestIdentity.js';
import type { AutomationActorRole } from './types.js';

export function resolveAutomationActorRole(
  identity: RequestIdentity
): AutomationActorRole {
  if (identity.source === 'HUMAN_SESSION') {
    return identity.membershipRole || 'MEMBER';
  }

  if (identity.source === 'DEFAULT_WEB') {
    return 'MEMBER';
  }

  // API keys are machine credentials. Their scopes may authorize
  // machine capabilities, but must never synthesize human membership
  // roles such as OWNER, ADMIN, or APPROVER.
  return 'SERVICE';
}

export function automationActorLabel(
  identity: RequestIdentity
): string {
  if (identity.source === 'API_KEY') {
    return 'api-key:' + (identity.apiKeyId || 'unknown');
  }

  if (identity.source === 'HUMAN_SESSION') {
    return 'user:' + (identity.userId || 'unknown');
  }

  return 'web:default';
}
