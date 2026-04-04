import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/hooks/useWorkspace';
import {
  Trash2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Building2,
  ArrowRight,
  Zap,
  CheckCircle2,
  Bomb,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

interface CleanupStep {
  id: number;
  name: string;
  description: string;
}

const CLEANUP_STEPS: CleanupStep[] = [
  { id: 1, name: 'Clean Orphaned Messages', description: 'Remove messages without conversations' },
  { id: 2, name: 'Dedupe Conversations', description: 'Remove duplicate email threads' },
  { id: 3, name: 'Dedupe Customers', description: 'Remove duplicate customer records' },
  { id: 4, name: 'Clear Import Queue', description: 'Clear pending email imports' },
  { id: 5, name: 'Reset Progress', description: 'Reset import progress for fresh start' },
];

export const TestDataCleanupPanel = () => {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [counts, setCounts] = useState<{
    conversations: number;
    messages: number;
    customers: number;
  } | null>(null);
  const [deleteCustomers, setDeleteCustomers] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [savingContext, setSavingContext] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [stepResults, setStepResults] = useState<
    Record<number, { deleted: number; remaining: number; message: string }>
  >({});
  const [nuclearResetOpen, setNuclearResetOpen] = useState(false);
  const [nuclearConfirmText, setNuclearConfirmText] = useState('');
  const [nuclearRunning, setNuclearRunning] = useState(false);
  const [nuclearResult, setNuclearResult] = useState<{ success: boolean; result?: any } | null>(
    null,
  );

  // Fetch existing business context
  const fetchBusinessContext = async () => {
    if (!workspace?.id) return;

    const { data } = await supabase
      .from('business_context')
      .select('custom_flags')
      .eq('workspace_id', workspace.id)
      .single();

    if (data?.custom_flags) {
      const flags = data.custom_flags as Record<string, unknown>;
      setCompanyName((flags.company_name as string) || '');
    }
  };

  useEffect(() => {
    fetchBusinessContext();
  }, [workspace?.id]);

  const saveCompanyName = async () => {
    if (!workspace?.id || !companyName.trim()) return;

    setSavingContext(true);
    try {
      const { data: existing } = await supabase
        .from('business_context')
        .select('id, custom_flags')
        .eq('workspace_id', workspace.id)
        .single();

      const updatedFlags = {
        ...((existing?.custom_flags as Record<string, unknown>) || {}),
        company_name: companyName.trim(),
      };

      if (existing) {
        await supabase
          .from('business_context')
          .update({ custom_flags: updatedFlags })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('business_context')
          .insert({ workspace_id: workspace.id, custom_flags: updatedFlags });
      }

      toast({
        title: 'Company name saved',
        description: 'Your AI will now use this to classify emails correctly.',
      });
    } catch (error) {
      logger.error('Error saving company name', error);
      toast({
        title: 'Failed to save',
        description: 'Could not save company name.',
        variant: 'destructive',
      });
    } finally {
      setSavingContext(false);
    }
  };

  const runCleanupStep = async (step: number) => {
    if (!workspace?.id) return;

    setCleanupRunning(true);
    setCurrentStep(step);

    try {
      // cleanup-duplicates edge function removed
      toast({
        title: 'Cleanup migrated to n8n',
        description: 'Database cleanup functions have been migrated to n8n workflows.',
      });
      return;
    } catch (error: any) {
      logger.error('Cleanup error', error);
      toast({
        title: 'Cleanup failed',
        description: error?.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setCleanupRunning(false);
      setCurrentStep(null);
    }
  };

  const runAllSteps = async () => {
    for (const step of CLEANUP_STEPS) {
      await runCleanupStep(step.id);
      // Small delay between steps
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    toast({
      title: 'All cleanup steps complete',
      description: 'Your database has been cleaned up.',
    });
  };

  const handleNuclearReset = async () => {
    if (!workspace?.id || nuclearConfirmText !== 'CONFIRM') return;

    setNuclearRunning(true);
    setNuclearResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('nuclear-reset', {
        body: {
          workspaceId: workspace.id,
          confirm: 'CONFIRM_NUCLEAR_RESET',
        },
      });

      if (error) throw error;

      setNuclearResult({ success: true, result: data.result });

      toast({
        title: 'Nuclear Reset Complete',
        description: `Cleared ${data.result?.messages_cleared?.toLocaleString() || 0} messages, ${data.result?.conversations_cleared?.toLocaleString() || 0} conversations, ${data.result?.customers_cleared?.toLocaleString() || 0} customers`,
      });

      // Refresh counts
      fetchCounts();
      setNuclearConfirmText('');
      setNuclearResetOpen(false);
    } catch (error: any) {
      logger.error('Nuclear reset error', error);
      toast({
        title: 'Nuclear reset failed',
        description: error?.message || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setNuclearRunning(false);
    }
  };

  const fetchCounts = async () => {
    if (!workspace?.id) return;

    try {
      const [convResult, msgResult, custResult] = await Promise.all([
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id),
        supabase.from('messages').select('id', { count: 'exact', head: true }),
        supabase
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id),
      ]);

      setCounts({
        conversations: convResult.count || 0,
        messages: msgResult.count || 0,
        customers: custResult.count || 0,
      });
    } catch (error) {
      logger.error('Error fetching counts', error);
    }
  };

  const handleClearData = async () => {
    if (!workspace?.id) return;

    setLoading(true);
    try {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspace.id);

      const conversationIds = conversations?.map((c) => c.id) || [];

      if (conversationIds.length > 0) {
        const { error: msgError } = await supabase
          .from('messages')
          .delete()
          .in('conversation_id', conversationIds);

        if (msgError) throw msgError;
      }

      const { error: convError } = await supabase
        .from('conversations')
        .delete()
        .eq('workspace_id', workspace.id);

      if (convError) throw convError;

      if (deleteCustomers) {
        const { error: custError } = await supabase
          .from('customers')
          .delete()
          .eq('workspace_id', workspace.id);

        if (custError) throw custError;
      }

      toast({
        title: 'Data cleared successfully',
        description: `Deleted ${conversationIds.length} conversations and their messages${deleteCustomers ? ', plus all customers' : ''}.`,
      });

      setCounts(null);
      setDeleteCustomers(false);
    } catch (error) {
      logger.error('Error clearing data', error);
      toast({
        title: 'Failed to clear data',
        description: 'Some data may not have been deleted. Check console for details.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetAndResync = async () => {
    if (!workspace?.id) return;

    setResyncing(true);
    try {
      // Step 1: Clear all conversations and messages
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspace.id);

      const conversationIds = conversations?.map((c) => c.id) || [];

      if (conversationIds.length > 0) {
        await supabase.from('messages').delete().in('conversation_id', conversationIds);
      }
      await supabase.from('conversations').delete().eq('workspace_id', workspace.id);

      toast({
        title: 'Step 1: Data cleared',
        description: `Deleted ${conversationIds.length} conversations. Starting re-sync...`,
      });

      // Step 2: Find email config and trigger sync
      const { data: emailConfigs } = await supabase
        .from('email_provider_configs')
        .select('id')
        .eq('workspace_id', workspace.id)
        .limit(1);

      // email-sync edge function removed
      toast({
        title: 'Email sync migrated to n8n',
        description:
          'Email sync has been migrated to n8n workflows. Data was cleared but re-sync must be triggered from n8n.',
      });

      setCounts(null);
    } catch (error) {
      logger.error('Error in reset and resync', error);
      toast({
        title: 'Reset failed',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setResyncing(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Business Context Quick Setup */}
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="text-lg font-semibold">Company Identity</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Set your company name so AI can correctly classify invoices TO you vs. misdirected
                  ones.
                </p>
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="e.g. MAC Cleaning"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="max-w-xs"
                />
                <Button
                  onClick={saveCompanyName}
                  disabled={savingContext || !companyName.trim()}
                  variant="outline"
                >
                  {savingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>

              {companyName && (
                <p className="text-xs text-muted-foreground">
                  AI will classify invoices addressed to "{companyName}" as legitimate.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Reset & Re-sync Section */}
        <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-start gap-3">
            <RefreshCw className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="text-lg font-semibold">Reset & Re-sync Emails</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Clear all emails and re-import them with your current business context. This will
                  re-triage everything using your company name and settings.
                </p>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={resyncing || !companyName.trim()} className="gap-2">
                    {resyncing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {resyncing ? 'Re-syncing...' : 'Reset & Re-sync All Emails'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset and re-sync all emails?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This will:</p>
                      <ul className="list-disc list-inside text-sm">
                        <li>Delete all current conversations and messages</li>
                        <li>Re-import emails from the last 90 days</li>
                        <li>Re-triage with your current business context (company name, etc.)</li>
                      </ul>
                      <p className="font-medium mt-2">Company: {companyName}</p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetAndResync}>
                      Yes, reset and re-sync
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {!companyName.trim() && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <ArrowRight className="h-3 w-3" />
                  Set your company name above first
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Nuclear Cleanup Section */}
        <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="space-y-4 flex-1">
              <div>
                <h3 className="text-lg font-semibold">Database Cleanup (Large Datasets)</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Clean up duplicate records in batches. Use this if you have millions of duplicate
                  records from import issues. Run each step multiple times if needed.
                </p>
              </div>

              <div className="space-y-2">
                {CLEANUP_STEPS.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-center justify-between p-3 bg-background/50 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                          stepResults[step.id]
                            ? 'bg-green-500 text-white'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {stepResults[step.id] ? <CheckCircle2 className="h-4 w-4" /> : step.id}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{step.name}</p>
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                        {stepResults[step.id] && (
                          <p className="text-xs text-green-600 mt-1">
                            {stepResults[step.id].message}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runCleanupStep(step.id)}
                      disabled={cleanupRunning}
                    >
                      {currentStep === step.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Run'
                      )}
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="gap-2" disabled={cleanupRunning}>
                      <Zap className="h-4 w-4" />
                      Run All Steps
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Run all cleanup steps?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will run all 5 cleanup steps in sequence. This may take a few minutes
                        for large datasets. You can also run steps individually.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={runAllSteps}>Run All</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        </div>

        {/* Nuclear Reset Section - For extreme cases */}
        <div className="p-4 bg-red-500/10 border border-red-500/40 rounded-lg">
          <div className="flex items-start gap-3">
            <Bomb className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="text-lg font-semibold text-red-700">Nuclear Reset</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  <strong>For 8M+ records that won't delete.</strong> Uses TRUNCATE to instantly
                  clear ALL messages, conversations, customers, and import data. This bypasses
                  timeout issues with DELETE statements.
                </p>
              </div>

              {nuclearResult?.success && (
                <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <p className="text-sm text-green-700 font-medium">Nuclear reset complete!</p>
                  <p className="text-xs text-green-600 mt-1">
                    Cleared {nuclearResult.result?.messages_cleared?.toLocaleString()} messages,
                    {nuclearResult.result?.conversations_cleared?.toLocaleString()} conversations,
                    {nuclearResult.result?.customers_cleared?.toLocaleString()} customers
                  </p>
                </div>
              )}

              <AlertDialog open={nuclearResetOpen} onOpenChange={setNuclearResetOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="gap-2 bg-red-600 hover:bg-red-700">
                    <Bomb className="h-4 w-4" />
                    Nuclear Reset (TRUNCATE ALL)
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-red-600 flex items-center gap-2">
                      <Bomb className="h-5 w-5" />
                      Nuclear Reset - Point of No Return
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                      <p className="font-medium text-foreground">
                        This will PERMANENTLY and INSTANTLY delete:
                      </p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        <li>ALL messages (even millions)</li>
                        <li>ALL conversations</li>
                        <li>ALL customers</li>
                        <li>ALL email import data</li>
                        <li>ALL conversation pairs</li>
                      </ul>
                      <p className="text-sm text-muted-foreground">
                        This uses TRUNCATE which is instant regardless of table size. Use this when
                        DELETE statements time out on large datasets.
                      </p>
                      <div className="pt-3 border-t">
                        <p className="text-sm font-medium mb-2">
                          Type <span className="font-mono bg-muted px-1 rounded">CONFIRM</span> to
                          proceed:
                        </p>
                        <Input
                          value={nuclearConfirmText}
                          onChange={(e) => setNuclearConfirmText(e.target.value)}
                          placeholder="Type CONFIRM"
                          className="font-mono"
                        />
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setNuclearConfirmText('')}>
                      Cancel
                    </AlertDialogCancel>
                    <Button
                      variant="destructive"
                      onClick={handleNuclearReset}
                      disabled={nuclearConfirmText !== 'CONFIRM' || nuclearRunning}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {nuclearRunning ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Resetting...
                        </>
                      ) : (
                        <>
                          <Bomb className="h-4 w-4 mr-2" />
                          Execute Nuclear Reset
                        </>
                      )}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>

        {/* Clear Test Data Section */}
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Clear Test Data
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Delete all test conversations, messages, and optionally customers to start fresh. This
            action cannot be undone.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={fetchCounts}>
            Check Current Data
          </Button>

          {counts && (
            <div className="text-sm text-muted-foreground flex items-center gap-4">
              <span>{counts.conversations} conversations</span>
              <span>{counts.messages} messages</span>
              <span>{counts.customers} customers</span>
            </div>
          )}
        </div>

        <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <p className="text-sm font-medium text-destructive">
                Warning: This will permanently delete all data
              </p>
              <p className="text-sm text-muted-foreground">
                All conversations and messages will be deleted. This is useful for clearing test
                data before going live with real customers.
              </p>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="delete-customers"
                  checked={deleteCustomers}
                  onCheckedChange={(checked) => setDeleteCustomers(checked === true)}
                />
                <Label htmlFor="delete-customers" className="text-sm cursor-pointer">
                  Also delete all customers
                </Label>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={loading}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {loading ? 'Clearing...' : 'Clear All Test Data'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>This action cannot be undone. This will permanently delete:</p>
                      <ul className="list-disc list-inside text-sm">
                        <li>All conversations in your workspace</li>
                        <li>All messages within those conversations</li>
                        {deleteCustomers && <li>All customer records</li>}
                      </ul>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleClearData}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Yes, delete everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
