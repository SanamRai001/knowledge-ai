import http from 'http';
import {
  productionReadinessService,
} from '../operations/productionReadinessService.js';

export class WorkerHealthServer {
  private server:
    | http.Server
    | null = null;
  private draining = false;

  public setDraining(
    draining: boolean
  ): void {
    this.draining = draining;
  }

  public isStarted(): boolean {
    return Boolean(this.server);
  }

  public async start(input: {
    host: string;
    port: number;
  }): Promise<void> {
    if (this.server) {
      return;
    }

    const server =
      http.createServer(
        async (req, res) => {
          res.setHeader(
            'Content-Type',
            'application/json; charset=utf-8'
          );
          res.setHeader(
            'Cache-Control',
            'no-store'
          );

          if (
            req.method !== 'GET'
          ) {
            res.statusCode = 405;
            res.end(
              JSON.stringify({
                status:
                  'method_not_allowed',
              })
            );
            return;
          }

          if (
            req.url === '/health'
          ) {
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                status: 'ok',
                draining:
                  this.draining,
              })
            );
            return;
          }

          if (
            req.url === '/ready'
          ) {
            if (this.draining) {
              res.statusCode = 503;
              res.end(
                JSON.stringify({
                  status:
                    'not_ready',
                  ready: false,
                  reason:
                    'WORKER_DRAINING',
                })
              );
              return;
            }

            const report =
              await productionReadinessService
                .checkWorkerReadiness();

            res.statusCode =
              report.ready
                ? 200
                : 503;
            res.end(
              JSON.stringify({
                status:
                  report.ready
                    ? 'ready'
                    : 'not_ready',
                ...report,
              })
            );
            return;
          }

          res.statusCode = 404;
          res.end(
            JSON.stringify({
              status: 'not_found',
            })
          );
        }
      );

    await new Promise<void>(
      (resolve, reject) => {
        const onError = (
          error: Error
        ) => {
          server.off(
            'listening',
            onListening
          );
          reject(error);
        };
        const onListening = () => {
          server.off(
            'error',
            onError
          );
          resolve();
        };

        server.once(
          'error',
          onError
        );
        server.once(
          'listening',
          onListening
        );
        server.listen(
          input.port,
          input.host
        );
      }
    );

    this.server = server;
  }

  public async stop(
    timeoutMs: number
  ): Promise<boolean> {
    const server = this.server;
    this.server = null;

    if (!server) {
      return true;
    }

    let timer:
      | ReturnType<typeof setTimeout>
      | undefined;

    const closed =
      new Promise<boolean>(
        (resolve) => {
          server.close((error) => {
            resolve(!error);
          });
        }
      );

    try {
      const graceful =
        await Promise.race([
          closed,
          new Promise<boolean>(
            (resolve) => {
              timer = setTimeout(
                () =>
                  resolve(false),
                Math.max(
                  1,
                  timeoutMs
                )
              );
              timer.unref?.();
            }
          ),
        ]);

      if (!graceful) {
        server
          .closeAllConnections?.();
      }

      return graceful;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

export const workerHealthServer =
  new WorkerHealthServer();
