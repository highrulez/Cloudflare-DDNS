import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaskedValue } from './ui';

describe('MaskedValue', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });

  it('shows the address by default and can hide then reveal it', () => {
    render(<MaskedValue value="203.0.113.10" label="IPv4" />);
    expect(screen.getByText('203.0.113.10')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide IPv4' }));
    expect(screen.queryByText('203.0.113.10')).toBeNull();
    expect(screen.getByText(/•+/)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show IPv4' }));
    expect(screen.getByText('203.0.113.10')).not.toBeNull();
  });

  it('hides and reveals IPv6 independently of other instances', () => {
    render(
      <>
        <MaskedValue value="203.0.113.10" label="IPv4" />
        <MaskedValue value="2001:db8::10" label="IPv6" />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide IPv6' }));
    expect(screen.getByText('203.0.113.10')).not.toBeNull();
    expect(screen.queryByText('2001:db8::10')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show IPv6' }));
    expect(screen.getByText('2001:db8::10')).not.toBeNull();
  });

  it('copies the full address while visible or hidden', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MaskedValue value="203.0.113.10" label="IPv4" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy IPv4' }));
    expect(writeText).toHaveBeenCalledWith('203.0.113.10');

    fireEvent.click(screen.getByRole('button', { name: 'Hide IPv4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy IPv4' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith('203.0.113.10');
  });
});
