import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, ToastProvider, useToast } from './ui';

describe('Dialog', () => {
  it('exposes accessible dialog semantics and closes with Escape', () => {
    const close = vi.fn();
    render(<Dialog open title="Delete record?" description="This cannot be undone." onClose={close}><button>Confirm</button></Dialog>);
    expect(screen.getByRole('dialog', { name: 'Delete record?' }).getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});

function ToastTrigger() {
  const toast = useToast();
  return <button onClick={() => toast('Record saved.')}>Save</button>;
}

describe('ToastProvider', () => {
  it('announces successful actions', () => {
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Record saved.')).not.toBeNull();
  });
});
