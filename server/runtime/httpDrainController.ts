import type express from 'express';

export class HttpDrainController {
  private draining = false;
  private activeRequests = 0;
  private idleWaiters =
    new Set<() => void>();

  public middleware(): express.RequestHandler {
    return (req, res, next) => {
      if (
        this.draining &&
        req.path !== '/api/health'
      ) {
        res.setHeader(
          'Connection',
          'close'
        );
        res.status(503).json({
          status: 'draining',
          code:
            'SERVICE_DRAINING',
        });
        return;
      }

      if (this.draining) {
        res.setHeader(
          'Connection',
          'close'
        );
      }

      this.activeRequests += 1;
      let settled = false;

      const settle = () => {
        if (settled) return;
        settled = true;
        this.activeRequests =
          Math.max(
            0,
            this.activeRequests - 1
          );

        if (
          this.activeRequests === 0
        ) {
          for (
            const resolve of
            this.idleWaiters
          ) {
            resolve();
          }
          this.idleWaiters.clear();
        }
      };

      res.once('finish', settle);
      res.once('close', settle);
      next();
    };
  }

  public beginDrain(): void {
    this.draining = true;
  }

  public isDraining(): boolean {
    return this.draining;
  }

  public getActiveRequestCount(): number {
    return this.activeRequests;
  }

  public async waitForIdle(
    timeoutMs: number
  ): Promise<boolean> {
    if (
      this.activeRequests === 0
    ) {
      return true;
    }

    return new Promise<boolean>(
      (resolve) => {
        let completed = false;
        const finish = (
          idle: boolean
        ) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          this.idleWaiters.delete(
            onIdle
          );
          resolve(idle);
        };

        const onIdle = () =>
          finish(true);
        this.idleWaiters.add(
          onIdle
        );

        const timer = setTimeout(
          () => finish(false),
          Math.max(1, timeoutMs)
        );
        timer.unref?.();
      }
    );
  }
}

export const httpDrainController =
  new HttpDrainController();
