import type { Config } from '../config.js';

export class TurnstileError extends Error {
  constructor(message = 'Security verification failed. Please try again.') {
    super(message);
    this.name = 'TurnstileError';
  }
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

export async function verifyTurnstileToken(
  config: Config,
  token: string,
  remoteIp: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<void> {
  if (!config.TURNSTILE_SECRET_KEY) throw new TurnstileError();
  if (!token || token.length > 2048) throw new TurnstileError();

  let response: Response;
  try {
    response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.TURNSTILE_SECRET_KEY,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {})
      }),
      signal: AbortSignal.timeout(config.TURNSTILE_VERIFY_TIMEOUT_MS)
    });
  } catch {
    throw new TurnstileError();
  }

  let payload: SiteverifyResponse;
  try {
    payload = (await response.json()) as SiteverifyResponse;
  } catch {
    throw new TurnstileError();
  }

  if (
    !response.ok ||
    payload.success !== true ||
    payload.hostname !== config.TURNSTILE_EXPECTED_HOSTNAME ||
    payload.action !== config.TURNSTILE_EXPECTED_ACTION
  ) {
    throw new TurnstileError();
  }
}
