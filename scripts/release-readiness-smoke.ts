function required(
  name: string
): string {
  const value =
    process.env[name]?.trim();
  if (!value) {
    throw new Error(
      name + ' is required.'
    );
  }
  return value;
}

function timeoutMs(): number {
  const raw = Number(
    process.env
      .KNOWLEDGE_AI_RELEASE_READINESS_TIMEOUT_MS ||
      '5000'
  );
  if (
    !Number.isFinite(raw) ||
    raw < 250 ||
    raw > 30_000
  ) {
    throw new Error(
      'KNOWLEDGE_AI_RELEASE_READINESS_TIMEOUT_MS must be between 250 and 30000.'
    );
  }
  return Math.floor(raw);
}

async function probe(
  urlText: string,
  label: string,
  allowHttp: boolean
) {
  const url =
    new URL(urlText);
  if (
    url.protocol !== 'https:' &&
    !allowHttp
  ) {
    throw new Error(
      label +
        ' must use HTTPS.'
    );
  }

  const controller =
    new AbortController();
  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs()
    );

  try {
    const response =
      await fetch(url, {
        method: 'GET',
        headers: {
          accept:
            'application/json',
        },
        redirect: 'error',
        signal:
          controller.signal,
      });

    const body =
      await response.json() as {
        ready?: unknown;
        status?: unknown;
      };

    if (
      response.status !== 200 ||
      body.ready !== true
    ) {
      throw new Error(
        label +
          ' is not ready.'
      );
    }

    return {
      ready: true,
      checkedAt:
        new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const allowHttp =
    process.env
      .KNOWLEDGE_AI_RELEASE_ALLOW_HTTP
      ?.trim()
      .toLowerCase() ===
    'true';

  const [
    webReadiness,
    workerReadiness,
  ] = await Promise.all([
    probe(
      required(
        'KNOWLEDGE_AI_STAGING_WEB_READY_URL'
      ),
      'staging web readiness URL',
      allowHttp
    ),
    probe(
      required(
        'KNOWLEDGE_AI_STAGING_WORKER_READY_URL'
      ),
      'staging worker readiness URL',
      allowHttp
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        webReadiness,
        workerReadiness,
      },
      null,
      2
    )
  );
}

main().catch((error: any) => {
  console.error(
    JSON.stringify({
      ready: false,
      errorCode:
        String(
          error?.name ||
            'RELEASE_READINESS_FAILED'
        ).slice(0, 120),
      message:
        String(
          error?.message ||
            'Release readiness smoke failed.'
        ).slice(0, 500),
    })
  );
  process.exit(1);
});
