export type MembershipRole =
  | 'OWNER'
  | 'ADMIN'
  | 'MEMBER';

export interface AuthMeResponse {
  user: {
    id: string;
    email: string;
    displayName?: string;
    status: string;
  };
  membership: {
    accountId: string;
    role: MembershipRole;
    status: string;
  } | null;
  memberships: Array<{
    accountId: string;
    role: MembershipRole;
    status: string;
  }>;
  session: {
    id: string;
    selectedAccountId: string | null;
    selectedWorkspaceId: string | null;
    expiresAt: number;
  };
}

export type ShellStatus =
  | 'bootstrapping'
  | 'authenticated'
  | 'session-required'
  | 'permission-denied'
  | 'rate-limited'
  | 'degraded'
  | 'error';

export interface ShellState {
  status: ShellStatus;
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    status: number;
    code?: string;
    message: string;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = 'ApiRequestError';
    this.status = params.status;
    this.code = params.code;
    this.retryAfterSeconds =
      params.retryAfterSeconds;
  }
}

export async function readApiResponse<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const structured =
      body?.error &&
      typeof body.error === 'object'
        ? body.error
        : null;
    const message =
      structured?.message ||
      (typeof body?.error === 'string'
        ? body.error
        : fallbackMessage);
    const code =
      structured?.code ||
      (typeof body?.code === 'string'
        ? body.code
        : undefined);
    const retryHeader =
      response.headers.get('Retry-After');
    const retryAfterSeconds =
      retryHeader &&
      Number.isFinite(Number(retryHeader))
        ? Number(retryHeader)
        : undefined;

    throw new ApiRequestError({
      status: response.status,
      code,
      message,
      retryAfterSeconds,
    });
  }

  return body as T;
}

export function shellStateFromError(
  error: unknown,
  fallbackMessage:
    string = 'Knowledge AI could not load.'
): ShellState {
  if (!(error instanceof ApiRequestError)) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : fallbackMessage,
    };
  }

  if (error.status === 401) {
    return {
      status: 'session-required',
      code: error.code,
      message: error.message,
    };
  }
  if (error.status === 403) {
    return {
      status: 'permission-denied',
      code: error.code,
      message: error.message,
    };
  }
  if (error.status === 429) {
    return {
      status: 'rate-limited',
      code: error.code,
      message: error.message,
      retryAfterSeconds:
        error.retryAfterSeconds,
    };
  }
  if (error.status === 503) {
    return {
      status: 'degraded',
      code: 'SERVICE_DEGRADED',
      message:
        'A required service is temporarily unavailable. Retry shortly. If this continues, contact an organization administrator.',
    };
  }

  return {
    status: 'error',
    code: error.code,
    message:
      error.message || fallbackMessage,
  };
}

export function isPrivilegedMembershipRole(
  role: MembershipRole | undefined
): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function canManageDeveloperPlatform(
  role: MembershipRole | undefined
): boolean {
  return isPrivilegedMembershipRole(role);
}

export function canManageIntegrationLifecycle(
  role: MembershipRole | undefined
): boolean {
  return isPrivilegedMembershipRole(role);
}

export function canViewOperationalDiagnostics(
  role: MembershipRole | undefined
): boolean {
  return isPrivilegedMembershipRole(role);
}
