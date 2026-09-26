import crypto from 'crypto';
import {
  humanIdentityFoundationService,
  normalizeHumanEmail,
} from './humanIdentityFoundationService.js';
import { postgresIdentityFoundationRepository } from './postgresIdentityFoundationRepository.js';
import { postgresHumanAuthRepository } from './postgresHumanAuthRepository.js';
import type {
  HumanAuthRepository,
  PasswordCredential,
} from './authTypes.js';
import type {
  AccountMembership,
  HumanUser,
  IdentityFoundationRepository,
} from './types.js';
import {
  humanLoginThrottleService,
} from './humanLoginThrottleService.js';

const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 1024;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export type HumanAuthErrorCode =
  | 'AUTH_BOOTSTRAP_NOT_CONFIGURED'
  | 'AUTH_BOOTSTRAP_DENIED'
  | 'AUTH_BOOTSTRAP_ALREADY_USED'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_ACCOUNT_MEMBERSHIP_REQUIRED'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_EMAIL_INVALID'
  | 'AUTH_PASSWORD_INVALID';

export class HumanAuthError extends Error {
  public readonly code: HumanAuthErrorCode;
  public readonly retryAfterSeconds?: number;

  constructor(
    code: HumanAuthErrorCode,
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'HumanAuthError';
    this.code = code;
    this.retryAfterSeconds =
      retryAfterSeconds;
  }
}

function randomId(prefix: string): string {
  return prefix + '_' + crypto.randomBytes(16).toString('hex');
}

function fixedDigest(value: string): Buffer {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest();
}

function safeEqual(left: string, right: string): boolean {
  return crypto.timingSafeEqual(
    fixedDigest(left),
    fixedDigest(right)
  );
}

function validatePassword(password: string): void {
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new HumanAuthError(
      'AUTH_PASSWORD_INVALID',
      'Password must be between 12 and 1024 characters.'
    );
  }
}

function normalizeBootstrapEmail(email: string): string {
  try {
    return normalizeHumanEmail(email);
  } catch {
    throw new HumanAuthError(
      'AUTH_EMAIL_INVALID',
      'A valid email address is required.'
    );
  }
}

function normalizeLoginEmail(email: string): string {
  try {
    return normalizeHumanEmail(email);
  } catch {
    throw new HumanAuthError(
      'AUTH_INVALID_CREDENTIALS',
      'Email or password is incorrect.'
    );
  }
}

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: {
    N: number;
    r: number;
    p: number;
  }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLength,
      {
        N: options.N,
        r: options.r,
        p: options.p,
        maxmem: SCRYPT_MAXMEM,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

async function burnMissingCredentialCheck(
  password: string
): Promise<void> {
  const bounded =
    typeof password === 'string'
      ? password.slice(0, PASSWORD_MAX_LENGTH)
      : '';
  await scrypt(
    bounded,
    Buffer.alloc(16, 0x5a),
    SCRYPT_KEY_LENGTH,
    {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    }
  );
}

export async function createPasswordCredential(
  userId: string,
  password: string,
  at = Date.now()
): Promise<PasswordCredential> {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(
    password,
    salt,
    SCRYPT_KEY_LENGTH,
    {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    }
  );

  return {
    userId,
    algorithm: 'scrypt-v1',
    saltBase64: salt.toString('base64'),
    hashBase64: hash.toString('base64'),
    scryptN: SCRYPT_N,
    scryptR: SCRYPT_R,
    scryptP: SCRYPT_P,
    keyLength: SCRYPT_KEY_LENGTH,
    createdAt: at,
    updatedAt: at,
  };
}

export async function verifyPasswordCredential(
  credential: PasswordCredential,
  password: string
): Promise<boolean> {
  if (
    credential.algorithm !== 'scrypt-v1' ||
    typeof password !== 'string' ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return false;
  }

  const expected = Buffer.from(
    credential.hashBase64,
    'base64'
  );
  if (expected.length !== credential.keyLength) {
    return false;
  }

  const actual = await scrypt(
    password,
    Buffer.from(credential.saltBase64, 'base64'),
    credential.keyLength,
    {
      N: credential.scryptN,
      r: credential.scryptR,
      p: credential.scryptP,
    }
  );

  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

function bootstrapConfiguration(): {
  token: string;
  accountId: string;
} {
  const token =
    process.env.KNOWLEDGE_AI_BOOTSTRAP_TOKEN?.trim() || '';
  const accountId =
    process.env.KNOWLEDGE_AI_BOOTSTRAP_ACCOUNT_ID?.trim() || '';

  if (token.length < 32 || !accountId) {
    throw new HumanAuthError(
      'AUTH_BOOTSTRAP_NOT_CONFIGURED',
      'Initial owner bootstrap is not configured.'
    );
  }
  return { token, accountId };
}

export class HumanAuthService {
  constructor(
    private readonly authRepository: HumanAuthRepository =
      postgresHumanAuthRepository,
    private readonly identityRepository: IdentityFoundationRepository =
      postgresIdentityFoundationRepository
  ) {}

  async bootstrapInitialOwner(params: {
    bootstrapToken: string;
    email: string;
    password: string;
    displayName?: string;
  }): Promise<{
    user: HumanUser;
    membership: AccountMembership;
  }> {
    const config = bootstrapConfiguration();

    if (
      !params.bootstrapToken ||
      !safeEqual(params.bootstrapToken, config.token)
    ) {
      throw new HumanAuthError(
        'AUTH_BOOTSTRAP_DENIED',
        'Initial owner bootstrap was denied.'
      );
    }

    const normalizedEmail = normalizeBootstrapEmail(params.email);
    const now = Date.now();
    const user: HumanUser = {
      id: randomId('usr'),
      email: params.email.trim(),
      normalizedEmail,
      displayName: params.displayName?.trim() || undefined,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    const credential = await createPasswordCredential(
      user.id,
      params.password,
      now
    );
    const membership: AccountMembership = {
      accountId: config.accountId,
      userId: user.id,
      role: 'OWNER',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    try {
      return await this.authRepository.bootstrapInitialOwner({
        accountId: config.accountId,
        user,
        credential,
        membership,
      });
    } catch (error: any) {
      if (
        error?.message === 'AUTH_BOOTSTRAP_ALREADY_USED'
      ) {
        throw new HumanAuthError(
          'AUTH_BOOTSTRAP_ALREADY_USED',
          'Initial owner bootstrap has already been completed.'
        );
      }
      throw error;
    }
  }

  async login(params: {
    email: string;
    password: string;
    previousSessionSecret?: string;
  }) {
    const throttle =
      await humanLoginThrottleService
        .reserve(params.email);

    if (!throttle.allowed) {
      throw new HumanAuthError(
        'AUTH_RATE_LIMITED',
        'Email or password is incorrect. Try again later.',
        throttle.resetSeconds
      );
    }

    const normalizedEmail = normalizeLoginEmail(params.email);
    const login =
      await this.authRepository.findLoginIdentity(
        normalizedEmail
      );

    if (!login) {
      await burnMissingCredentialCheck(params.password);
      throw new HumanAuthError(
        'AUTH_INVALID_CREDENTIALS',
        'Email or password is incorrect.'
      );
    }

    const passwordValid =
      await verifyPasswordCredential(
        login.credential,
        params.password
      );

    if (
      login.user.status !== 'ACTIVE' ||
      !passwordValid
    ) {
      throw new HumanAuthError(
        'AUTH_INVALID_CREDENTIALS',
        'Email or password is incorrect.'
      );
    }

    const memberships = (
      await this.identityRepository.listMemberships(
        login.user.id
      )
    ).filter(
      (membership) => membership.status === 'ACTIVE'
    );

    if (!memberships.length) {
      throw new HumanAuthError(
        'AUTH_ACCOUNT_MEMBERSHIP_REQUIRED',
        'No active account membership is available for this user.'
      );
    }

    await humanLoginThrottleService
      .clear(params.email);

    if (params.previousSessionSecret) {
      await humanIdentityFoundationService.revokeSession(
        params.previousSessionSecret
      );
    }

    const selectedAccountId =
      memberships.length === 1
        ? memberships[0].accountId
        : undefined;

    const created =
      await humanIdentityFoundationService.createSession({
        userId: login.user.id,
        selectedAccountId,
      });

    const context =
      await humanIdentityFoundationService.resolveSession(
        created.secret
      );

    return {
      secret: created.secret,
      context,
      memberships,
    };
  }

  private async activeMemberships(
    userId: string
  ): Promise<AccountMembership[]> {
    return (
      await this.identityRepository
        .listMemberships(userId)
    ).filter(
      (membership) =>
        membership.status === 'ACTIVE'
    );
  }

  async resolveSession(secret: string) {
    return humanIdentityFoundationService.resolveSession(
      secret
    );
  }

  async sessionOverview(secret: string) {
    const context =
      await this.resolveSession(secret);
    return {
      context,
      memberships:
        await this.activeMemberships(
          context.user.id
        ),
    };
  }

  async selectAccount(
    secret: string,
    accountId: string
  ) {
    const context =
      await humanIdentityFoundationService
        .selectAccount({
          secret,
          accountId:
            accountId.trim(),
        });

    return {
      context,
      memberships:
        await this.activeMemberships(
          context.user.id
        ),
    };
  }

  async logout(secret: string): Promise<boolean> {
    return humanIdentityFoundationService.revokeSession(
      secret
    );
  }
}

export const humanAuthService = new HumanAuthService();
