import express from 'express';
import { apiKeyStore } from '../server/apiKeyStore.js';
import { workspaceRouter } from '../server/workspaceRouter.js';

type JsonResponse = {
  status: number;
  body: any;
};

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/kb', workspaceRouter);

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve ephemeral HTTP test port.');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const { secret: secretA } = apiKeyStore.createApiKey({
      name: 'HTTP Isolation Account A',
      accountId: 'acc_http_isolation_a',
      environment: 'test',
    });
    const { secret: secretB } = apiKeyStore.createApiKey({
      name: 'HTTP Isolation Account B',
      accountId: 'acc_http_isolation_b',
      environment: 'test',
    });

    async function request(
      path: string,
      secret: string,
      init: RequestInit = {},
      extraHeaders: Record<string, string> = {}
    ): Promise<JsonResponse> {
      const response = await fetch(baseUrl + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(init.headers || {}),
        },
      });
      let body: any = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, body };
    }

    const createA = await request('/api/kb/new', secretA, {
      method: 'POST',
      body: JSON.stringify({ name: 'HTTP Account A KB' }),
    });
    const createB = await request('/api/kb/new', secretB, {
      method: 'POST',
      body: JSON.stringify({ name: 'HTTP Account B KB' }),
    });

    if (createA.status !== 200 || createB.status !== 200) {
      throw new Error(
        `Could not create isolated KBs: A=${createA.status}, B=${createB.status}`
      );
    }

    const kbA = createA.body?.kb;
    const kbB = createB.body?.kb;
    if (!kbA?.id || !kbB?.id || kbA.id === kbB.id) {
      throw new Error('HTTP isolation setup did not create distinct KBs.');
    }

    const ownList = await request(
      '/api/kb',
      secretA,
      {},
      { 'X-Account-ID': 'acc_http_isolation_b' }
    );
    if (ownList.status !== 200) {
      throw new Error(`Account A could not list its own KBs: ${ownList.status}`);
    }
    const listed = Array.isArray(ownList.body?.allKbs) ? ownList.body.allKbs : [];
    if (
      listed.some((kb: any) => kb.id === kbB.id) ||
      listed.some((kb: any) => kb.accountId !== 'acc_http_isolation_a')
    ) {
      throw new Error(
        'Spoofed X-Account-ID header crossed the HTTP workspace boundary.'
      );
    }

    const foreignPatch = await request(`/api/kb/${kbB.id}`, secretA, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'ATTACKED' }),
    });
    if (foreignPatch.status !== 404) {
      throw new Error(
        `Foreign KB mutation was not denied with 404; got ${foreignPatch.status}`
      );
    }

    const foreignSwitch = await request('/api/kb/switch', secretA, {
      method: 'POST',
      body: JSON.stringify({ id: kbB.id }),
    });
    if (foreignSwitch.status !== 404) {
      throw new Error(
        `Foreign active-KB switch was not denied with 404; got ${foreignSwitch.status}`
      );
    }

    const foreignAi = await request(`/api/kb/${kbB.id}/ai`, secretA);
    if (foreignAi.status !== 404) {
      throw new Error(
        `Foreign Specialized AI read was not denied with 404; got ${foreignAi.status}`
      );
    }

    const foreignEvaluation = await request(
      `/api/kb/${kbB.id}/evaluations/history`,
      secretA
    );
    if (foreignEvaluation.status !== 404) {
      throw new Error(
        `Foreign evaluation history read was not denied with 404; got ${foreignEvaluation.status}`
      );
    }

    const foreignDelete = await request(`/api/kb/${kbB.id}`, secretA, {
      method: 'DELETE',
    });
    if (foreignDelete.status !== 404) {
      throw new Error(
        `Foreign KB delete was not denied with 404; got ${foreignDelete.status}`
      );
    }

    const ownerRead = await request(`/api/kb/${kbB.id}/ai`, secretB);
    if (ownerRead.status !== 200) {
      throw new Error(
        `Account B could not read its own Specialized AI: ${ownerRead.status}`
      );
    }

    const invalidAuth = await fetch(baseUrl + '/api/kb', {
      headers: { Authorization: 'Bearer definitely-invalid-key' },
    });
    if (invalidAuth.status !== 401) {
      throw new Error(
        `Invalid bearer credential should be denied with 401; got ${invalidAuth.status}`
      );
    }

    const finalA = await request('/api/kb', secretA);
    if (finalA.body?.kb?.id !== kbA.id) {
      throw new Error('Foreign switch attempt changed Account A active KB.');
    }

    console.log('WORKSPACE_HTTP_ISOLATION_CHECK_PASSED');
    console.log(
      'Mounted /api/kb routes enforce authenticated account scope against foreign IDs and spoofed account headers.'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error('WORKSPACE_HTTP_ISOLATION_CHECK_FAILED');
  console.error(error);
  process.exit(1);
});
