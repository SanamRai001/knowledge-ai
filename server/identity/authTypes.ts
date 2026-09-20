import type {
  AccountMembership,
  BrowserSessionContext,
  HumanUser,
} from './types.js';

export interface PasswordCredential {
  userId: string;
  algorithm: 'scrypt-v1';
  saltBase64: string;
  hashBase64: string;
  scryptN: number;
  scryptR: number;
  scryptP: number;
  keyLength: number;
  createdAt: number;
  updatedAt: number;
}

export interface LoginIdentity {
  user: HumanUser;
  credential: PasswordCredential;
}

export interface BootstrapOwnerInput {
  accountId: string;
  user: HumanUser;
  membership: AccountMembership;
  credential: PasswordCredential;
}

export interface HumanAuthRepository {
  bootstrapInitialOwner(
    input: BootstrapOwnerInput
  ): Promise<{
    user: HumanUser;
    membership: AccountMembership;
  }>;
  findLoginIdentity(
    normalizedEmail: string
  ): Promise<LoginIdentity | null>;
}

export interface AuthenticatedHuman {
  user: HumanUser;
  session: BrowserSessionContext['session'];
  membership?: AccountMembership;
}
