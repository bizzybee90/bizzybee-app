import { useState } from 'react';
import { logger } from '@/lib/logger';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PanelNotice } from './PanelNotice';
import { FAQManager } from './knowledge-base/FAQManager';
import { BusinessFactsManager } from './knowledge-base/BusinessFactsManager';
import { PricingManager } from './knowledge-base/PricingManager';
import { DocumentUpload } from '@/components/knowledge/DocumentUpload';
import {
  HelpCircle,
  BookOpen,
  DollarSign,
  FileUp,
  Download,
  Loader2,
  FileSearch,
  Trash2,
  Settings,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { resolveModuleLockState } from '@/components/ProtectedRoute';

export function KnowledgeBasePanel() {
  const { workspace, entitlements } = useWorkspace();
  const [downloading, setDownloading] = useState(false);
  const [downloadingCompetitor, setDownloadingCompetitor] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const knowledgeBaseLockState = resolveModuleLockState({
    isAllowed: entitlements ? entitlements.features.knowledge_base : true,
    workspaceId: workspace?.id ?? null,
    entitlements,
  });

  if (!workspace?.id || knowledgeBaseLockState.state === 'locked') {
    const isWorkspaceMissing = !workspace?.id;
    const helperMessage = isWorkspaceMissing
      ? 'Knowledge source management is unavailable until the workspace is ready.'
      : 'Knowledge source management is locked on this plan. Upgrade to Starter or above to unlock editing, scraping, and document uploads.';
    return (
      <div className="space-y-4">
        <PanelNotice
          icon={isWorkspaceMissing ? BookOpen : Settings}
          title={
            isWorkspaceMissing
              ? 'Finish workspace setup first'
              : 'Knowledge Base is locked on this plan'
          }
          description={
            isWorkspaceMissing
              ? 'BizzyBee needs an active workspace before the Knowledge Base can load FAQs, business facts, pricing, and documents.'
              : 'Upgrade to Starter or above to unlock FAQs, website learning, and business context in this module.'
          }
          actionLabel={isWorkspaceMissing ? 'Open onboarding' : 'Review plan'}
          actionTo={isWorkspaceMissing ? '/onboarding?reset=true' : '/settings?category=ai'}
        />
        <Card className="p-6 text-sm text-muted-foreground">{helperMessage}</Card>
      </div>
    );
  }

  const handleDownloadPDF = async () => {
    if (!workspace?.id) return;
    setDownloading(true);
    try {
      const { generateKnowledgeBasePDF } =
        await import('./knowledge-base/generateKnowledgeBasePDF');
      await generateKnowledgeBasePDF(workspace.id, workspace.name || undefined);
      toast.success('Knowledge Base PDF downloaded!');
    } catch (err) {
      logger.error('PDF generation error', err);
      toast.error('Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadCompetitorPDF = async () => {
    if (!workspace?.id) return;
    setDownloadingCompetitor(true);
    try {
      const { generateCompetitorResearchPDF } =
        await import('./knowledge-base/generateCompetitorResearchPDF');
      await generateCompetitorResearchPDF(workspace.id, workspace.name || undefined);
      toast.success('Competitor Research PDF downloaded!');
    } catch (err) {
      logger.error('Competitor PDF error', err);
      toast.error('Failed to generate competitor PDF');
    } finally {
      setDownloadingCompetitor(false);
    }
  };

  const handleDeleteAllScrapedData = async () => {
    if (!workspace?.id) return;
    const confirmed = window.confirm(
      'This will delete ALL scraped FAQs (website + competitor). Manual and document FAQs will be kept. Are you sure?',
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      // Tables not in generated types — use typed cast for dynamic table access
      const fromTable = (t: string) =>
        (supabase as unknown as { from: (t: string) => Record<string, CallableFunction> }).from(t);
      // Delete scraped FAQs (priority 10 with is_own_content, and priority 5 competitor)
      const { error } = (await fromTable('faq_database')
        .delete()
        .eq('workspace_id', workspace.id)
        .in('priority', [10, 5])) as unknown as Promise<{ error: { message: string } | null }>;

      if (error) throw error;

      // Also reset scraping jobs
      (await fromTable('scraping_jobs')
        .delete()
        .eq('workspace_id', workspace.id)) as unknown as Promise<{
        error: { message: string } | null;
      }>;

      toast.success('All scraped data deleted successfully');
    } catch (err) {
      logger.error('Delete scraped data error', err);
      toast.error('Failed to delete scraped data');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="p-6">
      {knowledgeBaseLockState.state === 'shadow-preview' ? (
        <PanelNotice
          icon={BookOpen}
          title="Knowledge Base in shadow preview"
          description="This workspace is outside the Knowledge Base tier. Shadow mode keeps this panel open for testing, but it would lock under hard enforcement."
          actionLabel="Review plan"
          actionTo="/settings?category=ai"
          className="mb-6 bg-bb-white"
        />
      ) : null}

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">Knowledge Base</h2>
          <p className="text-muted-foreground">
            Manage your AI agent's knowledge base. Add FAQs, business facts, pricing information,
            and upload documents that the AI will use to answer customer questions accurately.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPDF}
            disabled={downloading || !workspace?.id}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Your KB PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadCompetitorPDF}
            disabled={downloadingCompetitor || !workspace?.id}
          >
            {downloadingCompetitor ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileSearch className="h-4 w-4 mr-2" />
            )}
            Competitor PDF
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteAllScrapedData}
            disabled={deleting || !workspace?.id}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Delete Scraped Data
          </Button>
        </div>
      </div>

      <Tabs defaultValue="faqs" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="faqs" className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            FAQs
          </TabsTrigger>
          <TabsTrigger value="facts" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Business Facts
          </TabsTrigger>
          <TabsTrigger value="pricing" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Pricing
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Documents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="faqs">
          <FAQManager />
        </TabsContent>

        <TabsContent value="facts">
          <BusinessFactsManager />
        </TabsContent>

        <TabsContent value="pricing">
          <PricingManager />
        </TabsContent>

        <TabsContent value="documents">
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Upload PDF documents, price lists, or manuals. BizzyBee will extract FAQs and key
              information to expand the knowledge base automatically.
            </div>
            {workspace?.id && (
              <DocumentUpload
                workspaceId={workspace.id}
                onDocumentProcessed={() => {
                  // Could trigger a refresh of FAQs here if needed
                }}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
