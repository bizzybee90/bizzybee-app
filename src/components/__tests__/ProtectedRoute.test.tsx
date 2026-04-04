import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../ProtectedRoute';
import type { ReactNode } from 'react';

const { mockAuthGuard } = vi.hoisted(() => ({
  mockAuthGuard: vi.fn(({ children }: { children: ReactNode }) => (
    <div data-testid="auth-guard">{children}</div>
  )),
}));

vi.mock('@/components/AuthGuard', () => ({
  AuthGuard: (props: { children: ReactNode }) => mockAuthGuard(props),
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockAuthGuard.mockClear();
  });

  it('wraps children with AuthGuard and renders the protected content', () => {
    render(
      <ProtectedRoute>
        <div>Secure area</div>
      </ProtectedRoute>,
    );

    expect(mockAuthGuard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('auth-guard')).toBeInTheDocument();
    expect(screen.getByText('Secure area')).toBeInTheDocument();
  });
});
