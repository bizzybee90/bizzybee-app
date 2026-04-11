import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { PowerModeLayout } from '../PowerModeLayout';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/components/sidebar/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('@/components/shared/BackButton', () => ({
  BackButton: () => <div data-testid="back-button" />,
}));

vi.mock('@/components/conversations/ConversationThread', () => ({
  ConversationThread: () => <div data-testid="conversation-thread" />,
}));

vi.mock('@/components/context/CustomerContext', () => ({
  CustomerContext: () => <div data-testid="customer-context" />,
}));

vi.mock('@/components/sidebar/MobileHeader', () => ({
  MobileHeader: () => <div data-testid="mobile-header" />,
}));

vi.mock('@/components/sidebar/MobileSidebarSheet', () => ({
  MobileSidebarSheet: () => <div data-testid="mobile-sidebar-sheet" />,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/conversations/JaceStyleInbox', () => ({
  JaceStyleInbox: ({ searchValue }: { searchValue?: string }) => (
    <div data-testid="inbox-search-value">{searchValue ?? ''}</div>
  ),
}));

describe('PowerModeLayout', () => {
  it('passes the desktop search input value through to the inbox list', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PowerModeLayout />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const searchInput = screen.getByPlaceholderText('Search conversations...');
    await user.type(searchInput, 'refund follow up');

    expect(screen.getByTestId('inbox-search-value')).toHaveTextContent('refund follow up');
  });
});
