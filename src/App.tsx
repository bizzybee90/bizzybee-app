import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import React, { Suspense } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
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
const Reviews = React.lazy(() => import('./pages/Reviews'));

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
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
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />

      {/* Inbox - All open conversations */}
      <Route
        path="/inbox"
        element={
          <ProtectedRoute>
            <EscalationHub filter="all-open" />
          </ProtectedRoute>
        }
      />

      {/* Redirect old /all-open to /inbox */}
      <Route path="/all-open" element={<Navigate to="/inbox" replace />} />

      {/* Needs Action - Primary view */}
      <Route
        path="/needs-action"
        element={
          <ProtectedRoute>
            <EscalationHub filter="needs-me" />
          </ProtectedRoute>
        }
      />

      {/* Redirect old routes */}
      <Route path="/to-reply" element={<Navigate to="/needs-action" replace />} />
      <Route path="/needs-me" element={<Navigate to="/needs-action" replace />} />

      {/* Done - Auto-handled + resolved */}
      <Route
        path="/done"
        element={
          <ProtectedRoute>
            <EscalationHub filter="cleared" />
          </ProtectedRoute>
        }
      />

      {/* Redirect old cleared route */}
      <Route path="/cleared" element={<Navigate to="/done" replace />} />

      {/* Review - Reconciliation flow */}
      <Route
        path="/review"
        element={
          <ProtectedRoute>
            <Review />
          </ProtectedRoute>
        }
      />

      {/* Snoozed */}
      <Route
        path="/snoozed"
        element={
          <ProtectedRoute>
            <EscalationHub filter="snoozed" />
          </ProtectedRoute>
        }
      />

      {/* Unread */}
      <Route
        path="/unread"
        element={
          <ProtectedRoute>
            <EscalationHub filter="unread" />
          </ProtectedRoute>
        }
      />

      {/* Drafts */}
      <Route
        path="/drafts"
        element={
          <ProtectedRoute>
            <EscalationHub filter="drafts-ready" />
          </ProtectedRoute>
        }
      />

      {/* Sent */}
      <Route
        path="/sent"
        element={
          <ProtectedRoute>
            <EscalationHub filter="sent" />
          </ProtectedRoute>
        }
      />

      {/* Legacy /all-open handled by redirect above */}

      {/* Legacy routes */}
      <Route
        path="/my-tickets"
        element={
          <ProtectedRoute>
            <EscalationHub filter="my-tickets" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/unassigned"
        element={
          <ProtectedRoute>
            <EscalationHub filter="unassigned" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sla-risk"
        element={
          <ProtectedRoute>
            <EscalationHub filter="sla-risk" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/awaiting-reply"
        element={
          <ProtectedRoute>
            <EscalationHub filter="awaiting-reply" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/triaged"
        element={
          <ProtectedRoute>
            <EscalationHub filter="triaged" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/high-priority"
        element={
          <ProtectedRoute>
            <EscalationHub filter="high-priority" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/vip-customers"
        element={
          <ProtectedRoute>
            <EscalationHub filter="vip-customers" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/escalations"
        element={
          <ProtectedRoute>
            <Escalations />
          </ProtectedRoute>
        }
      />
      <Route
        path="/channels"
        element={
          <ProtectedRoute>
            <ChannelsDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/channel/:channel"
        element={
          <ProtectedRoute>
            <ChannelConversations />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <AnalyticsDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reviews"
        element={
          <ProtectedRoute>
            <Reviews />
          </ProtectedRoute>
        }
      />

      {/* Activity Page - Full activity timeline */}
      <Route
        path="/activity"
        element={
          <ProtectedRoute>
            <ActivityPage />
          </ProtectedRoute>
        }
      />

      {/* Learning Page - AI training and patterns */}
      <Route
        path="/learning"
        element={
          <ProtectedRoute>
            <LearningPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/conversation/:id"
        element={
          <ProtectedRoute>
            <ConversationView />
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/webhooks"
        element={
          <ProtectedRoute>
            <WebhookLogs />
          </ProtectedRoute>
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
          <ProtectedRoute>
            <Diagnostics />
          </ProtectedRoute>
        }
      />

      {/* Knowledge Base */}
      <Route
        path="/knowledge-base"
        element={
          <ProtectedRoute>
            <KnowledgeBase />
          </ProtectedRoute>
        }
      />

      {/* DevOps Dashboard - Admin only */}
      <Route
        path="/admin/devops"
        element={
          <ProtectedRoute>
            <DevOpsDashboard />
          </ProtectedRoute>
        }
      />

      {/* AI Phone */}
      <Route
        path="/ai-phone"
        element={
          <ProtectedRoute>
            <AiPhone />
          </ProtectedRoute>
        }
      />

      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
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
);

export default App;
