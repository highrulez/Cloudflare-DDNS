const baseUrl = (process.env.AUTH_SMOKE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const email = process.env.AUTH_SMOKE_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
const password = process.env.AUTH_SMOKE_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
const origin =
  process.env.AUTH_SMOKE_ORIGIN ??
  process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() ??
  new URL(baseUrl).origin;
const requestTimeoutMs = Number(process.env.AUTH_SMOKE_TIMEOUT_MS ?? 30_000);
const expectRedisFailure = process.env.AUTH_SMOKE_EXPECT_REDIS_FAILURE === 'true';

if (!email || !password) {
  throw new Error(
    'Set AUTH_SMOKE_ADMIN_EMAIL and AUTH_SMOKE_ADMIN_PASSWORD (or ADMIN_EMAIL and ADMIN_PASSWORD)'
  );
}

async function checkedFetch(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status}: ${body}`);
  }
  return response;
}

const startedAt = performance.now();
let login;
try {
  login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
} catch (error) {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    throw new Error(
      `POST /api/v1/auth/login exceeded the ${requestTimeoutMs}ms smoke-test deadline`,
      { cause: error }
    );
  }
  throw error;
}

if (expectRedisFailure) {
  if (![500, 503].includes(login.status)) {
    const body = await login.text();
    throw new Error(`Login returned ${login.status} instead of a controlled 500/503: ${body}`);
  }
  console.log(
    `Redis outage smoke test passed in ${Math.round(performance.now() - startedAt)}ms: login failed quickly with ${login.status}`
  );
  process.exit(0);
}

if (!login.ok) {
  const body = await login.text();
  throw new Error(`POST /api/v1/auth/login returned ${login.status}: ${body}`);
}
const setCookie = login.headers.get('set-cookie');
if (!setCookie) throw new Error('Login succeeded without a Set-Cookie header');
const sessionCookie = setCookie.split(';', 1)[0];

const me = await checkedFetch('/api/v1/auth/me', {
  headers: { cookie: sessionCookie }
});
const meBody = await me.json();
if (meBody?.user?.email?.toLowerCase() !== email.toLowerCase()) {
  throw new Error('Authenticated user does not match AUTH_SMOKE_ADMIN_EMAIL');
}

const readiness = await checkedFetch('/health/ready');
const readinessBody = await readiness.json();
if (readinessBody?.status !== 'ready') {
  throw new Error('Readiness response did not report ready');
}

console.log(
  `Authentication smoke test passed in ${Math.round(performance.now() - startedAt)}ms: login 200 + Set-Cookie, auth/me 200, health/ready 200`
);
