import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

interface RenderOptions {
  initialRoute?: string;
}

export function renderWithProviders(ui: ReactNode, options?: RenderOptions) {
  const queryClient = createTestQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options?.initialRoute ?? '/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
