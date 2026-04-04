import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/AuthGuard';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => (
  <AuthGuard>
    <RouteErrorBoundary>{children}</RouteErrorBoundary>
  </AuthGuard>
);
