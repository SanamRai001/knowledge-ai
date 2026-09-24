import type {
  WorkerJobHandler,
} from './workerJobTypes.js';

function normalizeJobType(
  value: string
): string {
  const normalized =
    value.trim().toUpperCase();

  if (
    !/^[A-Z][A-Z0-9_]{1,63}$/.test(
      normalized
    )
  ) {
    throw new Error(
      'Worker handler job type must match ^[A-Z][A-Z0-9_]{1,63}$.'
    );
  }

  return normalized;
}

export class WorkerJobHandlerRegistry {
  private readonly handlers =
    new Map<
      string,
      WorkerJobHandler
    >();

  register(
    jobType: string,
    handler: WorkerJobHandler
  ): void {
    const normalized =
      normalizeJobType(jobType);

    if (
      this.handlers.has(
        normalized
      )
    ) {
      throw new Error(
        'Worker handler already registered for job type: ' +
          normalized
      );
    }

    this.handlers.set(
      normalized,
      handler
    );
  }

  get(
    jobType: string
  ): WorkerJobHandler | undefined {
    return this.handlers.get(
      normalizeJobType(jobType)
    );
  }

  has(jobType: string): boolean {
    return this.handlers.has(
      normalizeJobType(jobType)
    );
  }

  listJobTypes(): string[] {
    return Array.from(
      this.handlers.keys()
    ).sort();
  }
}

export const workerJobHandlerRegistry =
  new WorkerJobHandlerRegistry();
