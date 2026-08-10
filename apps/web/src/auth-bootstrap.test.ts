import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type ApiError } from './api';

describe('auth bootstrap resilience', () => {
  afterEach(() => vi.restoreAllMocks());

  it('treats 401 from /auth/me as a normal unauthenticated response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    await expect(api.me()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED'
    } satisfies Partial<ApiError>);
  });

  it('keeps API calls same-origin relative under /api', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          appOrigin: 'https://ddns.example.com',
          turnstileExpectedHostname: 'ddns.example.com',
          secureLoginRequiredHint: true
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await api.authBootstrap();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/bootstrap',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('surfaces missing MFA challenge as an API error rather than throwing unexpectedly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'MFA_CHALLENGE_REQUIRED',
            message: 'Sign in again to continue security verification.'
          }
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(api.verifyMfa({ code: '123456' })).rejects.toMatchObject({
      status: 401,
      code: 'MFA_CHALLENGE_REQUIRED'
    });
  });
});
