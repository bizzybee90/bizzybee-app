import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Database,
  User,
  Building2,
  Mail,
  BookOpen,
  MessageSquare,
  RefreshCw,
  Shield,
} from 'lucide-react';

interface DiagnosticCheck {
  name: string;
  description: string;
  status: 'pending' | 'checking' | 'success' | 'error';
  details?: string;
  icon: typeof Database;
}

export default function Diagnostics() {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const isMobile = useIsMobile();
  const [checks, setChecks] = useState<DiagnosticCheck[]>([
    {
      name: 'Database Connection',
      description: 'Verify Supabase connection is active',
      status: 'pending',
      icon: Database,
    },
    {
      name: 'Authentication',
      description: 'Check user is authenticated',
      status: 'pending',
      icon: Shield,
    },
    {
      name: 'Workspace',
      description: 'Verify workspace is loaded',
      status: 'pending',
      icon: Building2,
    },
    {
      name: 'Conversations Table',
      description: 'Check conversations data access',
      status: 'pending',
      icon: MessageSquare,
    },
    {
      name: 'Sender Rules',
      description: 'Check sender rules configuration',
      status: 'pending',
      icon: BookOpen,
    },
    {
      name: 'Email Provider',
      description: 'Check email integration status',
      status: 'pending',
      icon: Mail,
    },
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const updateCheck = (name: string, updates: Partial<DiagnosticCheck>) => {
    setChecks((prev) => prev.map((c) => (c.name === name ? { ...c, ...updates } : c)));
  };

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);

    // Reset all to checking
    setChecks((prev) =>
      prev.map((c) => ({ ...c, status: 'checking' as const, details: undefined })),
    );

    // Check 1: Database connection
    try {
      const { error } = await supabase.from('workspaces').select('id').limit(1);
      if (error) throw error;
      updateCheck('Database Connection', { status: 'success', details: 'Connected to Supabase' });
    } catch (err: any) {
      updateCheck('Database Connection', { status: 'error', details: err.message });
    }

    // Check 2: Authentication
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error('No authenticated user');
      updateCheck('Authentication', { status: 'success', details: `Logged in as ${user.email}` });
    } catch (err: any) {
      updateCheck('Authentication', { status: 'error', details: err.message });
    }

    // Check 3: Workspace
    if (workspaceLoading) {
      updateCheck('Workspace', { status: 'checking', details: 'Loading...' });
    } else if (workspace) {
      updateCheck('Workspace', { status: 'success', details: `Workspace: ${workspace.name}` });
    } else {
      updateCheck('Workspace', { status: 'error', details: 'No workspace found' });
    }

    // Check 4: Conversations table
    if (workspace?.id) {
      try {
        const { count, error } = await supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id);
        if (error) throw error;
        updateCheck('Conversations Table', {
          status: 'success',
          details: `${count || 0} conversations found`,
        });
      } catch (err: any) {
        updateCheck('Conversations Table', { status: 'error', details: err.message });
      }

      // Check 5: Sender rules
      try {
        const { count, error } = await supabase
          .from('sender_rules')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspace.id);
        if (error) throw error;
        updateCheck('Sender Rules', {
          status: 'success',
          details: `${count || 0} rules configured`,
        });
      } catch (err: any) {
        updateCheck('Sender Rules', { status: 'error', details: err.message });
      }

      // Check 6: Email provider
      try {
        const { data, error } = await supabase
          .from('email_provider_configs')
          .select('email_address, provider, last_sync_at')
          .eq('workspace_id', workspace.id)
          .limit(1)
          .single();
        if (error && error.code !== 'PGRST116') throw error;
        if (data) {
          const lastSync = data.last_sync_at
            ? new Date(data.last_sync_at).toLocaleString()
            : 'Never';
          updateCheck('Email Provider', {
            status: 'success',
            details: `${data.email_address} (${data.provider}) - Last sync: ${lastSync}`,
          });
        } else {
          updateCheck('Email Provider', {
            status: 'error',
            details: 'No email provider configured',
          });
        }
      } catch (err: any) {
        updateCheck('Email Provider', { status: 'error', details: err.message });
      }
    } else {
      updateCheck('Conversations Table', { status: 'error', details: 'No workspace to check' });
      updateCheck('Sender Rules', { status: 'error', details: 'No workspace to check' });
      updateCheck('Email Provider', { status: 'error', details: 'No workspace to check' });
    }

    setIsRunning(false);
    setLastRun(new Date());
  }, [workspace, workspaceLoading]);

  useEffect(() => {
    // Auto-run on mount
    const timer = setTimeout(() => {
      void runDiagnostics();
    }, 500);
    return () => clearTimeout(timer);
  }, [runDiagnostics, workspace?.id]);

  const successCount = checks.filter((c) => c.status === 'success').length;
  const errorCount = checks.filter((c) => c.status === 'error').length;

  const mainContent = (
    <main className="flex-1 overflow-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Diagnostics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Health check for all system connections
            </p>
          </div>
          <Button onClick={runDiagnostics} disabled={isRunning} variant="outline">
            {isRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Run Diagnostics
          </Button>
        </div>

        {/* Summary */}
        <Card className="p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge
                variant={errorCount === 0 ? 'default' : 'destructive'}
                className="text-sm px-3 py-1"
              >
                {errorCount === 0
                  ? 'All Systems Operational'
                  : `${errorCount} Issue${errorCount !== 1 ? 's' : ''} Found`}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {successCount}/{checks.length} checks passed
              </span>
            </div>
            {lastRun && (
              <span className="text-xs text-muted-foreground">
                Last run: {lastRun.toLocaleTimeString()}
              </span>
            )}
          </div>
        </Card>

        {/* Check List */}
        <div className="space-y-3">
          {checks.map((check) => {
            const Icon = check.icon;
            return (
              <Card key={check.name} className="p-4">
                <div className="flex items-start gap-4">
                  <div
                    className={`p-2 rounded-lg ${
                      check.status === 'success'
                        ? 'bg-green-500/10'
                        : check.status === 'error'
                          ? 'bg-destructive/10'
                          : 'bg-muted'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 ${
                        check.status === 'success'
                          ? 'text-green-600'
                          : check.status === 'error'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{check.name}</h3>
                      {check.status === 'checking' && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {check.status === 'success' && (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                      {check.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
                    </div>
                    <p className="text-sm text-muted-foreground">{check.description}</p>
                    {check.details && (
                      <p
                        className={`text-xs mt-1 ${
                          check.status === 'error' ? 'text-destructive' : 'text-muted-foreground'
                        }`}
                      >
                        {check.details}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );

  if (isMobile) {
    return <MobilePageLayout>{mainContent}</MobilePageLayout>;
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      {mainContent}
    </div>
  );
}
