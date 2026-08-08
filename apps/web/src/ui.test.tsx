// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal, Status } from './ui';

describe('shared UI', () => {
  it('renders an accessible provider status', () => {
    render(<Status value="connected" />);
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('closes a modal with Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Connect provider" onClose={onClose}>
        <button>Continue</button>
      </Modal>
    );
    expect(screen.getByRole('dialog', { name: 'Connect provider' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
