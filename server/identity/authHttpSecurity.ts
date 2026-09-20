import crypto from 'crypto';
import type { Request, Response } from 'express';

export const AUTH_SESSION_COOKIE = 'ka_session';
export const AUTH_CSRF_COOKIE = 'ka_csrf';
export const AUTH_CSRF_HEADER = 'x-csrf-token';

export class AuthHttpSecurityError extends Error {
  constructor(
    public readonly code:
      | 'AUTH_ORIGIN_REQUIRED'
      | 'AUTH_ORIGIN_DENIED'
      | 'AUTH_PUBLIC_ORIGIN_NOT_CONFIGURED'
      | 'AUTH_CSRF_INVALID',
    message: string
  ) {
    super(message);
    this.name = 'AuthHttpSecurityError';
  }
}

export function parseCookieHeader(
  header: string | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(raw);
    } catch {
      result[name] = raw;
    }
  }
  return result;
}

function normalizedOrigin(value: string): string {
  return new URL(value).origin;
}

function expectedOrigin(req: Request): string {
  const configured =
    process.env.KNOWLEDGE_AI_PUBLIC_ORIGIN?.trim();

  if (configured) {
    return normalizedOrigin(configured);
  }

  if (process.env.NODE_ENV === 'production') {
    throw new AuthHttpSecurityError(
      'AUTH_PUBLIC_ORIGIN_NOT_CONFIGURED',
      'KNOWLEDGE_AI_PUBLIC_ORIGIN is required for production browser authentication.'
    );
  }

  const host = req.get('host');
  if (!host) {
    throw new AuthHttpSecurityError(
      'AUTH_ORIGIN_DENIED',
      'Request host is unavailable.'
    );
  }
  return normalizedOrigin(req.protocol + '://' + host);
}

export function requireSameOrigin(req: Request): void {
  const origin = req.get('origin');
  if (!origin) {
    throw new AuthHttpSecurityError(
      'AUTH_ORIGIN_REQUIRED',
      'Browser authentication mutations require an Origin header.'
    );
  }

  let actual: string;
  try {
    actual = normalizedOrigin(origin);
  } catch {
    throw new AuthHttpSecurityError(
      'AUTH_ORIGIN_DENIED',
      'Request origin is invalid.'
    );
  }

  if (actual !== expectedOrigin(req)) {
    throw new AuthHttpSecurityError(
      'AUTH_ORIGIN_DENIED',
      'Cross-origin authentication mutation was denied.'
    );
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = crypto
    .createHash('sha256')
    .update(left, 'utf8')
    .digest();
  const rightHash = crypto
    .createHash('sha256')
    .update(right, 'utf8')
    .digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

export function requireDoubleSubmitCsrf(
  req: Request
): void {
  const cookies = parseCookieHeader(req.get('cookie'));
  const cookieToken = cookies[AUTH_CSRF_COOKIE] || '';
  const headerToken =
    req.get(AUTH_CSRF_HEADER)?.trim() || '';

  if (
    !cookieToken ||
    !headerToken ||
    !safeEqual(cookieToken, headerToken)
  ) {
    throw new AuthHttpSecurityError(
      'AUTH_CSRF_INVALID',
      'CSRF token is missing or invalid.'
    );
  }
}

function serializeCookie(params: {
  name: string;
  value: string;
  httpOnly: boolean;
  maxAgeSeconds: number;
}): string {
  const parts = [
    params.name + '=' + encodeURIComponent(params.value),
    'Path=/',
    'Max-Age=' +
      Math.max(0, Math.floor(params.maxAgeSeconds)),
    'SameSite=Lax',
  ];

  if (params.httpOnly) parts.push('HttpOnly');
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function issueAuthCookies(
  res: Response,
  params: {
    sessionSecret: string;
    expiresAt: number;
    csrfToken: string;
  }
): void {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((params.expiresAt - Date.now()) / 1000)
  );

  res.append(
    'Set-Cookie',
    serializeCookie({
      name: AUTH_SESSION_COOKIE,
      value: params.sessionSecret,
      httpOnly: true,
      maxAgeSeconds,
    })
  );
  res.append(
    'Set-Cookie',
    serializeCookie({
      name: AUTH_CSRF_COOKIE,
      value: params.csrfToken,
      httpOnly: false,
      maxAgeSeconds,
    })
  );
}

export function clearAuthCookies(res: Response): void {
  res.append(
    'Set-Cookie',
    serializeCookie({
      name: AUTH_SESSION_COOKIE,
      value: '',
      httpOnly: true,
      maxAgeSeconds: 0,
    })
  );
  res.append(
    'Set-Cookie',
    serializeCookie({
      name: AUTH_CSRF_COOKIE,
      value: '',
      httpOnly: false,
      maxAgeSeconds: 0,
    })
  );
}

export function createCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
