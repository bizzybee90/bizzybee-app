import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import React, { Suspense } from 'react';
import { AuthGuard } from './components/AuthGuard';
import ErrorBoundary from './components/ErrorBoundary';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { WorkspaceProvider } from './contexts/WorkspaceContext';

// Lazy-loaded pages — each becomes its own chunk
const Auth = React.lazy(() => import('./pages/Auth'));
const NotFound = React.lazy(() => import('./pages/NotFound'));
const Settings = React.lazy(() => import('./pages/Settings'));
const WebhookLogs = React.lazy(() => import('./pages/WebhookLogs'));
const Privacy = React.lazy(() => import('./pages/Privacy'));
const Terms = React.lazy(() => import('./pages/Terms'));
const Escalations = React.lazy(() => import('./pages/Escalations'));
const EscalationHub = React.lazy(() =>
  import('./pages/EscalationHub').then((m) => ({ default: m.EscalationHub })),
);
const ConversationView = React.lazy(() => import('./pages/ConversationView'));
const Home = React.lazy(() => import('./pages/Home'));
const Onboarding = React.lazy(() => import('./pages/Onboarding'));
const ChannelsDashboard = React.lazy(() => import('./pages/ChannelsDashboard'));
const ChannelConversations = React.lazy(() => import('./pages/ChannelConversations'));
const AnalyticsDashboard = React.lazy(() => import('./pages/AnalyticsDashboard'));
const Review = React.lazy(() => import('./pages/Review'));
const ActivityPage = React.lazy(() => import('./pages/ActivityPage'));
const Diagnostics = React.lazy(() => import('./pages/Diagnostics'));
const LearningPage = React.lazy(() => import('./pages/LearningPage'));
const GDPRPortal = React.lazy(() => import('./pages/GDPRPortal'));
const EmailAuthSuccess = React.lazy(() => import('./pages/EmailAuthSuccess'));
const EmailOAuthCallback = React.lazy(() => import('./pages/EmailOAuthCallback'));
const KnowledgeBase = React.lazy(() => import('./pages/KnowledgeBase'));
const DevOpsDashboard = React.lazy(() => import('./pages/admin/DevOpsDashboard'));
const AiPhone = React.lazy(() => import('./pages/AiPhone'));

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const queryClient = new QueryClient();

/** Wraps a page with AuthGuard + per-route error boundary */
const Protected = ({ children }: { children: React.ReactNode }) => (
  <Protected>
    <RouteErrorBoundary>{children}</RouteErrorBoundary>
  </Protected>
);

const RouterContent = () => {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/email-auth-success" element={<EmailAuthSuccess />} />
      <Route path="/auth/email/callback" element={<EmailOAuthCallback />} />

      {/* Home - Calm reassurance screen */}
      <Route
        path="/"
        element={
          <Protected>
            <Home />
          </Protected>
        }
      />

      {/* Inbox - All open conversations */}
      <Route
        path="/inbox"
        element={
          <Protected>
            <EscalationHub filter="all-open" />
          </Protected>
        }
      />

      {/* Redirect old /all-open to /inbox */}
      <Route path="/all-open" element={<Navigate to="/inbox" replace />} />

      {/* Needs Action - Primary view */}
      <Route
        path="/needs-action"
        element={
          <Protected>
            <EscalationHub filter="needs-me" />
          </Protected>
        }
      />

      {/* Redirect old routes */}
      <Route path="/to-reply" element={<Navigate to="/needs-action" replace />} />
      <Route path="/needs-me" element={<Navigate to="/needs-action" replace />} />

      {/* Done - Auto-handled + resolved */}
      <Route
        path="/done"
        element={
          <Protected>
            <EscalationHub filter="cleared" />
          </Protected>
        }
      />

      {/* Redirect old cleared route */}
      <Route path="/cleared" element={<Navigate to="/done" replace />} />

      {/* Review - Reconciliation flow */}
      <Route
        path="/review"
        element={
          <Protected>
            <Review />
          </Protected>
        }
      />

      {/* Snoozed */}
      <Route
        path="/snoozed"
        element={
          <Protected>
            <EscalationHub filter="snoozed" />
          </Protected>
        }
      />

      {/* Unread */}
      <Route
        path="/unread"
        element={
          <Protected>
            <EscalationHub filter="unread" />
          </Protected>
        }
      />

      {/* Drafts */}
      <Route
        path="/drafts"
        element={
          <Protected>
            <EscalationHub filter="drafts-ready" />
          </Protected>
        }
      />

      {/* Sent */}
      <Route
        path="/sent"
        element={
          <Protected>
            <EscalationHub filter="sent" />
          </Protected>
        }
      />

      {/* Legacy /all-open handled by redirect above */}

      {/* Legacy routes */}
      <Route
        path="/my-tickets"
        element={
          <Protected>
            <EscalationHub filter="my-tickets" />
          </Protected>
        }
      />
      <Route
        path="/unassigned"
        element={
          <Protected>
            <EscalationHub filter="unassigned" />
          </Protected>
        }
      />
      <Route
        path="/sla-risk"
        element={
          <Protected>
            <EscalationHub filter="sla-risk" />
          </Protected>
        }
      />
      <Route
        path="/awaiting-reply"
        element={
          <Protected>
            <EscalationHub filter="awaiting-reply" />
          </Protected>
        }
      />
      <Route
        path="/triaged"
        element={
          <Protected>
            <EscalationHub filter="triaged" />
          </Protected>
        }
      />
      <Route
        path="/high-priority"
        element={
          <Protected>
            <EscalationHub filter="high-priority" />
          </Protected>
        }
      />
      <Route
        path="/vip-customers"
        element={
          <Protected>
            <EscalationHub filter="vip-customers" />
          </Protected>
        }
      />
      <Route
        path="/escalations"
        element={
          <Protected>
            <Escalations />
          </Protected>
        }
      />
      <Route
        path="/channels"
        element={
          <Protected>
            <ChannelsDashboard />
          </Protected>
        }
      />
      <Route
        path="/channel/:channel"
        element={
          <Protected>
            <ChannelConversations />
          </Protected>
        }
      />
      <Route
        path="/analytics"
        element={
          <Protected>
            <AnalyticsDashboard />
          </Protected>
        }
      />

      {/* Activity Page - Full activity timeline */}
      <Route
        path="/activity"
        element={
          <Protected>
            <ActivityPage />
          </Protected>
        }
      />

      {/* Learning Page - AI training and patterns */}
      <Route
        path="/learning"
        element={
          <Protected>
            <LearningPage />
          </Protected>
        }
      />

      <Route
        path="/conversation/:id"
        element={
          <Protected>
            <ConversationView />
          </Protected>
        }
      />

      <Route
        path="/settings"
        element={
          <Protected>
            <Settings />
          </Protected>
        }
      />
      <Route
        path="/webhooks"
        element={
          <Protected>
            <WebhookLogs />
          </Protected>
        }
      />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />

      {/* Public GDPR Self-Service Portal */}
      <Route path="/gdpr-portal" element={<GDPRPortal />} />
      <Route path="/gdpr-portal/:workspaceSlug" element={<GDPRPortal />} />

      <Route
        path="/diagnostics"
        element={
          <Protected>
            <Diagnostics />
          </Protected>
        }
      />

      {/* Knowledge Base */}
      <Route
        path="/knowledge-base"
        element={
          <Protected>
            <KnowledgeBase />
          </Protected>
        }
      />

      {/* DevOps Dashboard - Admin only */}
      <Route
        path="/admin/devops"
        element={
          <Protected>
            <DevOpsDashboard />
          </Protected>
        }
      />

      {/* AI Phone */}
      <Route
        path="/ai-phone"
        element={
          <Protected>
            <AiPhone />
          </Protected>
        }
      />

      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ErrorBoundary>
          <WorkspaceProvider>
            <Suspense fallback={<PageLoader />}>
              <RouterContent />
            </Suspense>
          </WorkspaceProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
