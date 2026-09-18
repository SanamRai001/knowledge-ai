import { SourceAuthority } from './types.js';

export const SOURCE_AUTHORITIES: Record<
  'SIGNED_OR_APPROVED' |
    'USER_CONFIRMED' |
    'AUTHORITATIVE_SYSTEM' |
    'STRUCTURED_SOURCE' |
    'DOCUMENT_SOURCE' |
    'USER_OBSERVATION' |
    'AI_INFERENCE',
  SourceAuthority
> = {
  SIGNED_OR_APPROVED: {
    level: 'SIGNED_OR_APPROVED',
    rank: 100,
    reason:
      'Explicitly designated signed or approved source. This level must never be inferred automatically.',
  },
  USER_CONFIRMED: {
    level: 'USER_CONFIRMED',
    rank: 90,
    reason:
      'A user explicitly confirmed this company state or claim.',
  },
  AUTHORITATIVE_SYSTEM: {
    level: 'AUTHORITATIVE_SYSTEM',
    rank: 85,
    reason:
      'Record originates from a configured authoritative system of record.',
  },
  STRUCTURED_SOURCE: {
    level: 'STRUCTURED_SOURCE',
    rank: 70,
    reason:
      'Observed in an imported structured source. No approval or system-of-record status is asserted automatically.',
  },
  DOCUMENT_SOURCE: {
    level: 'DOCUMENT_SOURCE',
    rank: 60,
    reason:
      'Observed in document text. Document approval/signature status is not inferred automatically.',
  },
  USER_OBSERVATION: {
    level: 'USER_OBSERVATION',
    rank: 50,
    reason:
      'User-provided observation that has not been promoted to confirmed company state.',
  },
  AI_INFERENCE: {
    level: 'AI_INFERENCE',
    rank: 20,
    reason:
      'Model-derived inference. It must not override higher-authority explicit company evidence.',
  },
};

export function structuredSourceAuthority(): SourceAuthority {
  return { ...SOURCE_AUTHORITIES.STRUCTURED_SOURCE };
}

export function documentSourceAuthority(): SourceAuthority {
  return { ...SOURCE_AUTHORITIES.DOCUMENT_SOURCE };
}
