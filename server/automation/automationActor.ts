import { apiKeyStore } from '../apiKeyStore.js';
import type { RequestIdentity } from '../requestIdentity.js';
import type { AutomationActorRole } from './types.js';

const ROLE_PRIORITY: AutomationActorRole[] = [
  'OWNER',
  'ADMIN',
  'APPROVER',
  'OPERATOR',
  'SERVICE',
  'MEMBER',
];

function roleFromScopes(scopes: string[]): AutomationActorRole | null {
  const normalized = new Set(scopes.map((scope) => scope.trim().toLowerCase()));

  for (const role of ROLE_PRIORITY) {
    if (normalized.has('role:' + role.toLowerCase())) {
      return role;
    }
  }

  return null;
}

export function resolveAutomationActorRole(
  identity: RequestIdentity
): AutomationActorRole {
  if (identity.source === 'HUMAN_SESSION') {
    return identity.membershipRole || 'MEMBER';
  }

  if (identity.source === 'DEFAULT_WEB') {
    return 'MEMBER';
  }

  if (identity.apiKeyId) {
    const apiKey = apiKeyStore.getApiKeyById(identity.apiKeyId);
    const explicitRole = apiKey
      ? roleFromScopes(apiKey.scopes || [])
      : null;
    if (explicitRole) return explicitRole;
  }

  // Existing authenticated API-key integrations predate role scopes.
  // They remain SERVICE actors unless a narrower explicit role is attached.
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
