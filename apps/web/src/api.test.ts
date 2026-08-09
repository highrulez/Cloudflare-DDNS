import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('API client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the /api prefix and cookie credentials', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ user: { id: '1', email: 'admin@example.com', displayName: 'Admin' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    await api.me();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('surfaces JSON API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Token is invalid' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    await expect(api.testAccount('account-1')).rejects.toThrow('Token is invalid');
  });

  it('does not send a JSON content type when a request has no body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await api.logout();
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(init?.body).toBeUndefined();
    expect(headers.has('Content-Type')).toBe(false);
  });
});
