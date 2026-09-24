export type KnowledgeAiProcessRole =
  | 'web'
  | 'worker'
  | 'combined';

export class ProcessRoleConfigurationError
  extends Error
{
  readonly code =
    'PROCESS_ROLE_NOT_CONFIGURED';

  constructor(message: string) {
    super(message);
    this.name =
      'ProcessRoleConfigurationError';
  }
}

export function resolveProcessRole(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    nonProductionDefault?:
      KnowledgeAiProcessRole;
  }
): KnowledgeAiProcessRole {
  const raw =
    env.KNOWLEDGE_AI_PROCESS_ROLE
      ?.trim()
      .toLowerCase();

  if (!raw) {
    if (
      env.NODE_ENV
        ?.trim()
        .toLowerCase() ===
      'production'
    ) {
      throw new ProcessRoleConfigurationError(
        'KNOWLEDGE_AI_PROCESS_ROLE must be explicitly set to web, worker, or combined in production.'
      );
    }

    return (
      options?.nonProductionDefault ||
      'combined'
    );
  }

  if (
    raw !== 'web' &&
    raw !== 'worker' &&
    raw !== 'combined'
  ) {
    throw new ProcessRoleConfigurationError(
      'KNOWLEDGE_AI_PROCESS_ROLE must be one of: web, worker, combined.'
    );
  }

  return raw;
}

export function roleRunsWeb(
  role: KnowledgeAiProcessRole
): boolean {
  return (
    role === 'web' ||
    role === 'combined'
  );
}

export function roleRunsWorkers(
  role: KnowledgeAiProcessRole
): boolean {
  return (
    role === 'worker' ||
    role === 'combined'
  );
}

export function assertWebEntrypointRole(
  role: KnowledgeAiProcessRole
): void {
  if (!roleRunsWeb(role)) {
    throw new ProcessRoleConfigurationError(
      'The HTTP server entrypoint cannot run with KNOWLEDGE_AI_PROCESS_ROLE=worker. Use the worker entrypoint instead.'
    );
  }
}

export function assertWorkerEntrypointRole(
  role: KnowledgeAiProcessRole
): void {
  if (!roleRunsWorkers(role)) {
    throw new ProcessRoleConfigurationError(
      'The worker entrypoint cannot run with KNOWLEDGE_AI_PROCESS_ROLE=web.'
    );
  }
}
