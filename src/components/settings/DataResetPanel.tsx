import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Loader2, RotateCcw, Trash2, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface DataResetPanelProps {
  workspaceId: string;
}

export function DataResetPanel({ workspaceId }: DataResetPanelProps) {
  const navigate = useNavigate();
  const [isResetting, setIsResetting] = useState(false);
  const [isNuking, setIsNuking] = useState(false);
  const [includeCustomers, setIncludeCustomers] = useState(false);
  const [includeSenderRules, setIncludeSenderRules] = useState(true);
  const [includeBusinessContext, setIncludeBusinessContext] = useState(false);
  const [nukeStep, setNukeStep] = useState('');

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspaceId);

      const conversationIds = conversations?.map((c) => c.id) || [];

      if (conversationIds.length > 0) {
        await supabase.from('messages').delete().in('conversation_id', conversationIds);
      }

      await supabase.from('conversations').delete().eq('workspace_id', workspaceId);
      await supabase.from('triage_corrections').delete().eq('workspace_id', workspaceId);
      await supabase.from('sender_behaviour_stats').delete().eq('workspace_id', workspaceId);

      if (includeSenderRules) {
        await supabase.from('sender_rules').delete().eq('workspace_id', workspaceId);
      }
      if (includeCustomers) {
        await supabase.from('customers').delete().eq('workspace_id', workspaceId);
      }
      if (includeBusinessContext) {
        await supabase.from('business_context').delete().eq('workspace_id', workspaceId);
      }

      toast.success('Data reset complete');
    } catch (error) {
      logger.error('Error resetting data', error);
      toast.error('Failed to reset data');
    } finally {
      setIsResetting(false);
    }
  };

  const handleReOnboard = async () => {
    setIsResetting(true);
    try {
      await handleReset();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('users')
          .update({
            onboarding_completed: false,
            onboarding_step: 'welcome',
          })
          .eq('id', user.id);
      }
      toast.success('Redirecting to onboarding...');
      navigate('/onboarding');
    } catch (error) {
      logger.error('Error re-onboarding', error);
      toast.error('Failed to start re-onboarding');
    } finally {
      setIsResetting(false);
    }
  };

  const handleFullNukeAndRestart = async () => {
    setIsNuking(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Step 1: Nuclear reset (conversations, messages, emails, import jobs)
      setNukeStep('Wiping email & conversation data…');
      const { error: nukeError } = await supabase.functions.invoke('nuclear-reset', {
        body: { workspaceId, confirm: 'CONFIRM_NUCLEAR_RESET' },
      });
      if (nukeError) throw nukeError;

      // Step 2: Wipe knowledge base
      setNukeStep('Clearing knowledge base…');
      await supabase.from('faq_database').delete().eq('workspace_id', workspaceId);
      await supabase.from('example_responses').delete().eq('workspace_id', workspaceId);

      // Step 3: Wipe competitor research
      setNukeStep('Clearing competitor research…');
      await supabase.from('competitor_faq_candidates').delete().eq('workspace_id', workspaceId);
      await supabase.from('competitor_faqs_raw').delete().eq('workspace_id', workspaceId);
      await supabase.from('competitor_pages').delete().eq('workspace_id', workspaceId);
      await supabase.from('competitor_sites').delete().eq('workspace_id', workspaceId);
      await supabase.from('competitor_research_jobs').delete().eq('workspace_id', workspaceId);

      // Step 4: Wipe voice & learning data
      setNukeStep('Clearing AI learning data…');
      await supabase.from('voice_profiles').delete().eq('workspace_id', workspaceId);
      await supabase.from('correction_examples').delete().eq('workspace_id', workspaceId);
      await supabase.from('classification_corrections').delete().eq('workspace_id', workspaceId);
      await supabase.from('sender_rules').delete().eq('workspace_id', workspaceId);
      await supabase.from('sender_behaviour_stats').delete().eq('workspace_id', workspaceId);

      // Step 5: Wipe scraping jobs & progress
      setNukeStep('Clearing progress & job state…');
      await supabase.from('scraping_jobs').delete().eq('workspace_id', workspaceId);
      await supabase.from('agent_run_events').delete().eq('workspace_id', workspaceId);
      const { data: agentRuns } = await supabase
        .from('agent_runs')
        .select('id')
        .eq('workspace_id', workspaceId);
      const agentRunIds = agentRuns?.map((row) => row.id) || [];
      if (agentRunIds.length > 0) {
        await supabase.from('agent_run_artifacts').delete().in('run_id', agentRunIds);
        await supabase.from('agent_run_steps').delete().in('run_id', agentRunIds);
      }
      await supabase.from('agent_runs').delete().eq('workspace_id', workspaceId);
      await supabase.from('email_import_progress').delete().eq('workspace_id', workspaceId);

      // Step 6: Wipe customers
      setNukeStep('Clearing customers…');
      await supabase.from('customers').delete().eq('workspace_id', workspaceId);

      // Step 7: Reset onboarding state
      setNukeStep('Resetting onboarding state…');
      await supabase
        .from('users')
        .update({
          onboarding_completed: false,
          onboarding_step: 'welcome',
        })
        .eq('id', user.id);

      // Step 8: Clear localStorage
      try {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('bizzybee:')) localStorage.removeItem(key);
        });
      } catch {
        /* ignore */
      }

      setNukeStep('Done!');
      toast.success('Full reset complete — starting fresh!');
      navigate('/onboarding?reset=true');
    } catch (error: any) {
      logger.error('Nuclear reset failed', error);
      toast.error(`Reset failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsNuking(false);
      setNukeStep('');
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Data Management
        </CardTitle>
        <CardDescription>
          Reset your workspace data or re-run the onboarding process
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Full Nuke Section — most prominent */}
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-destructive">
                Full Wipe & Restart Onboarding
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Deletes <strong>everything</strong> — emails, conversations, FAQs, competitor
                research, AI learning, voice profile, customers — and sends you back to step 1. Use
                this for a clean end-to-end test.
              </p>
            </div>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full" disabled={isNuking || isResetting}>
                {isNuking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {nukeStep || 'Resetting…'}
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Full Wipe & Restart Onboarding
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  This will delete EVERYTHING
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">
                    This removes all data from your workspace with no recovery possible:
                  </span>
                  <ul className="text-sm list-disc list-inside space-y-1 text-foreground/80">
                    <li>All emails, conversations & messages</li>
                    <li>All FAQs & knowledge base content</li>
                    <li>All competitor research data</li>
                    <li>AI voice profile & learning data</li>
                    <li>All customers & sender rules</li>
                    <li>All onboarding progress</li>
                  </ul>
                  <span className="block font-medium text-destructive">
                    You will be sent back to Step 1 of onboarding. Your email connection is
                    preserved.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleFullNukeAndRestart}
                  className="bg-destructive hover:bg-destructive/90"
                >
                  Yes, wipe everything & restart
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Lighter Reset Options */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-muted-foreground">Lighter options:</Label>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="sender-rules"
                checked={includeSenderRules}
                onCheckedChange={(checked) => setIncludeSenderRules(checked as boolean)}
              />
              <Label htmlFor="sender-rules" className="text-sm cursor-pointer">
                Sender rules & AI learning data
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="customers"
                checked={includeCustomers}
                onCheckedChange={(checked) => setIncludeCustomers(checked as boolean)}
              />
              <Label htmlFor="customers" className="text-sm cursor-pointer">
                Customer records
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="business-context"
                checked={includeBusinessContext}
                onCheckedChange={(checked) => setIncludeBusinessContext(checked as boolean)}
              />
              <Label htmlFor="business-context" className="text-sm cursor-pointer">
                Business context settings
              </Label>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Conversations and messages are always deleted. Email connections are preserved.
          </p>

          <div className="flex flex-col gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                  disabled={isResetting || isNuking}
                >
                  {isResetting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  Reset Data Only
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset workspace data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all selected data. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleReset}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Reset Data
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                  disabled={isResetting || isNuking}
                >
                  {isResetting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Reset & Re-Onboard (partial)
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset and start fresh?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete the selected data and restart the onboarding wizard. Your email
                    connection and knowledge base will be preserved.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleReOnboard}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    Reset & Re-Onboard
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
