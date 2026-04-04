import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import React from "react";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Settings from "./pages/Settings";
import WebhookLogs from "./pages/WebhookLogs";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Escalations from "./pages/Escalations";
import { EscalationHub } from "./pages/EscalationHub";
import ConversationView from "./pages/ConversationView";
import { AuthGuard } from "./components/AuthGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";
import Onboarding from "./pages/Onboarding";
import ChannelsDashboard from "./pages/ChannelsDashboard";
import ChannelConversations from "./pages/ChannelConversations";
import AnalyticsDashboard from "./pages/AnalyticsDashboard";
import Review from "./pages/Review";
import ActivityPage from "./pages/ActivityPage";
import Diagnostics from "./pages/Diagnostics";
import LearningPage from "./pages/LearningPage";
import GDPRPortal from "./pages/GDPRPortal";
import EmailAuthSuccess from "./pages/EmailAuthSuccess";
import EmailOAuthCallback from "./pages/EmailOAuthCallback";
import KnowledgeBase from "./pages/KnowledgeBase";
import DevOpsDashboard from "./pages/admin/DevOpsDashboard";
import AiPhone from "./pages/AiPhone";



const queryClient = new QueryClient();

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
          <AuthGuard>
            <Home />
          </AuthGuard>
        } 
      />

      {/* Inbox - All open conversations */}
      <Route 
        path="/inbox" 
        element={
          <AuthGuard>
            <EscalationHub filter="all-open" />
          </AuthGuard>
        } 
      />
      
      {/* Redirect old /all-open to /inbox */}
      <Route path="/all-open" element={<Navigate to="/inbox" replace />} />
      
      {/* Needs Action - Primary view */}
      <Route 
        path="/needs-action" 
        element={
          <AuthGuard>
            <EscalationHub filter="needs-me" />
          </AuthGuard>
        } 
      />
      
      {/* Redirect old routes */}
      <Route path="/to-reply" element={<Navigate to="/needs-action" replace />} />
      <Route path="/needs-me" element={<Navigate to="/needs-action" replace />} />
      
      {/* Done - Auto-handled + resolved */}
      <Route 
        path="/done" 
        element={
          <AuthGuard>
            <EscalationHub filter="cleared" />
          </AuthGuard>
        } 
      />
      
      {/* Redirect old cleared route */}
      <Route path="/cleared" element={<Navigate to="/done" replace />} />
      
      {/* Review - Reconciliation flow */}
      <Route 
        path="/review" 
        element={
          <AuthGuard>
            <Review />
          </AuthGuard>
        } 
      />
      
      {/* Snoozed */}
      <Route 
        path="/snoozed" 
        element={
          <AuthGuard>
            <EscalationHub filter="snoozed" />
          </AuthGuard>
        } 
      />
      
      {/* Unread */}
      <Route 
        path="/unread" 
        element={
          <AuthGuard>
            <EscalationHub filter="unread" />
          </AuthGuard>
        } 
      />
      
      {/* Drafts */}
      <Route 
        path="/drafts" 
        element={
          <AuthGuard>
            <EscalationHub filter="drafts-ready" />
          </AuthGuard>
        } 
      />
      
      {/* Sent */}
      <Route 
        path="/sent" 
        element={
          <AuthGuard>
            <EscalationHub filter="sent" />
          </AuthGuard>
        } 
      />
      
      {/* Legacy /all-open handled by redirect above */}
      
      {/* Legacy routes */}
      <Route 
        path="/my-tickets" 
        element={
          <AuthGuard>
            <EscalationHub filter="my-tickets" />
          </AuthGuard>
        } 
      />
      <Route 
        path="/unassigned" 
        element={
          <AuthGuard>
            <EscalationHub filter="unassigned" />
          </AuthGuard>
        } 
      />
      <Route 
        path="/sla-risk" 
        element={
          <AuthGuard>
            <EscalationHub filter="sla-risk" />
          </AuthGuard>
        } 
      />
      <Route 
        path="/awaiting-reply" 
        element={
          <AuthGuard>
            <EscalationHub filter="awaiting-reply" />
          </AuthGuard>
        } 
      />
      <Route 
        path="/triaged" 
        element={
          <AuthGuard>
            <EscalationHub filter="triaged" />
          </AuthGuard>
        } 
      />
      <Route
        path="/high-priority"
        element={
          <AuthGuard>
            <EscalationHub filter="high-priority" />
          </AuthGuard>
        } 
      />
      <Route 
        path="/vip-customers" 
        element={
          <AuthGuard>
            <EscalationHub filter="vip-customers" />
          </AuthGuard>
        } 
      />
      <Route 
        path="/escalations" 
        element={
          <AuthGuard>
            <Escalations />
          </AuthGuard>
        } 
      />
      <Route 
        path="/channels" 
        element={
          <AuthGuard>
            <ChannelsDashboard />
          </AuthGuard>
        } 
      />
      <Route 
        path="/channel/:channel" 
        element={
          <AuthGuard>
            <ChannelConversations />
          </AuthGuard>
        } 
      />
      <Route 
        path="/analytics" 
        element={
          <AuthGuard>
            <AnalyticsDashboard />
          </AuthGuard>
        } 
      />

      {/* Activity Page - Full activity timeline */}
      <Route 
        path="/activity" 
        element={
          <AuthGuard>
            <ActivityPage />
          </AuthGuard>
        }
      />

      {/* Learning Page - AI training and patterns */}
      <Route 
        path="/learning" 
        element={
          <AuthGuard>
            <LearningPage />
          </AuthGuard>
        }
      />

      <Route
        path="/conversation/:id"
        element={
          <AuthGuard>
            <ConversationView />
          </AuthGuard>
        }
      />

      <Route 
        path="/settings"
        element={
          <AuthGuard>
            <Settings />
          </AuthGuard>
        } 
      />
      <Route 
        path="/webhooks" 
        element={
          <AuthGuard>
            <WebhookLogs />
          </AuthGuard>
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
            <AuthGuard>
              <Diagnostics />
            </AuthGuard>
          } 
        />

        {/* Knowledge Base */}
        <Route
          path="/knowledge-base"
          element={
            <AuthGuard>
              <KnowledgeBase />
            </AuthGuard>
          }
        />

        {/* DevOps Dashboard - Admin only */}
        <Route
          path="/admin/devops"
          element={
            <AuthGuard>
              <DevOpsDashboard />
            </AuthGuard>
          }
        />

        {/* AI Phone */}
        <Route
          path="/ai-phone"
          element={
            <AuthGuard>
              <AiPhone />
            </AuthGuard>
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
          <RouterContent />
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
