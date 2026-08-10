import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';

const reauthMock = vi.fn();
const mfaStatusMock = vi.fn();

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string
    ) {
      super(message);
    }
  },
  api: {
    reauth: (...args: unknown[]) => reauthMock(...args) as Promise<unknown>,
    mfaStatus: (...args: unknown[]) => mfaStatusMock(...args) as Promise<unknown>
  }
}));

import { StrongAuthProvider, useStrongAuth } from './strong-auth';

function Probe({ action }: { action: () => Promise<string> }) {
  const { withStrongAuth } = useStrongAuth();
  return (
    <button
      type="button"
      onClick={() => {
        void withStrongAuth(action).then((value) => {
          const el = document.createElement('div');
          el.textContent = value;
          el.setAttribute('data-testid', 'result');
          document.body.appendChild(el);
        });
      }}
    >
      Run
    </button>
  );
}

describe('StrongAuthProvider', () => {
  beforeEach(() => {
    reauthMock.mockReset();
    mfaStatusMock.mockReset();
  });

  it('opens verification and retries the original action after reauth', async () => {
    mfaStatusMock.mockResolvedValue({
      enabled: false,
      enabledAt: null,
      recoveryCodesRemaining: 0,
      recoveryCodesTotal: 0
    });
    reauthMock.mockResolvedValue({
      stronglyAuthenticatedUntil: new Date().toISOString(),
      recentlyStronglyAuthenticated: true
    });

    let attempts = 0;
    const action = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError('Need verification', 403, 'STRONG_AUTH_REQUIRED');
      }
      return 'done';
    });

    render(
      <StrongAuthProvider>
        <Probe action={action} />
      </StrongAuthProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('dialog', { name: 'Security Verification' })).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Verify/ }));

    await waitFor(() => {
      expect(reauthMock).toHaveBeenCalled();
      expect(screen.getByTestId('result').textContent).toBe('done');
    });
    expect(action).toHaveBeenCalledTimes(2);
  });
});
