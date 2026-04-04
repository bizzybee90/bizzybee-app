import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle, Clock, Database, FileText, Shield, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const GDPRDashboard = () => {
  const { workspace } = useWorkspace();
  const { isAdmin } = useUserRole();
  const [stats, setStats] = useState({
    pendingDeletions: 0,
    monthlyExports: 0,
    oldestConversation: '',
    consentRate: 0,
    retentionDays: 365,
    autoDeleteEnabled: false,
  });
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    if (!workspace?.id) return;

    setLoading(true);
    try {
      // Get pending deletion requests
      const { data: customerIds } = await supabase
        .from('customers')
        .select('id')
        .eq('workspace_id', workspace.id);

      const customerIdList = customerIds?.map((c) => c.id) || [];

      const { count: pendingCount } = await supabase
        .from('data_deletion_requests')
        .select('*', { count: 'exact', head: true })
        .in('customer_id', customerIdList)
        .eq('status', 'pending');

      // Get exports from last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count: exportCount } = await supabase
        .from('data_access_logs')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id)
        .eq('action', 'export')
        .gte('created_at', thirtyDaysAgo.toISOString());

      // Get oldest conversation
      const { data: oldestConv } = await supabase
        .from('conversations')
        .select('created_at')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      // Get retention policy
      const { data: policy } = await supabase
        .from('data_retention_policies')
        .select('*')
        .eq('workspace_id', workspace.id)
        .single();

      // Calculate consent rate
      const { count: totalCustomers } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id);

      const { data: consentCustomers } = await supabase
        .from('customer_consents')
        .select('customer_id')
        .in('customer_id', customerIdList)
        .eq('consent_given', true);

      const uniqueConsents = new Set(consentCustomers?.map((c) => c.customer_id) || []).size;
      const consentRate = totalCustomers ? (uniqueConsents / totalCustomers) * 100 : 0;

      setStats({
        pendingDeletions: pendingCount || 0,
        monthlyExports: exportCount || 0,
        oldestConversation: oldestConv?.created_at || '',
        consentRate: Math.round(consentRate),
        retentionDays: policy?.retention_days || 365,
        autoDeleteEnabled: policy?.auto_delete_enabled || false,
      });
    } catch (error) {
      console.error('Error loading GDPR stats:', error);
      toast.error('Failed to load GDPR statistics');
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    if (workspace?.id) {
      void loadStats();
    }
  }, [loadStats, workspace?.id]);

  const runManualCleanup = async () => {
    // cleanup-old-data edge function has been removed
    toast.info('Data cleanup migrated to n8n');
  };

  if (!isAdmin) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Admin access required to view GDPR dashboard
        </p>
      </Card>
    );
  }

  const getDataAgeColor = (): 'default' | 'destructive' | 'secondary' => {
    if (!stats.oldestConversation) return 'secondary';
    const ageInDays = Math.floor(
      (Date.now() - new Date(stats.oldestConversation).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (ageInDays > stats.retentionDays) return 'destructive';
    return 'default';
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">GDPR Compliance Dashboard</h3>
          <p className="text-sm text-muted-foreground">
            Monitor data protection metrics and compliance status
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Pending Deletions */}
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Deletions</p>
                <p className="text-3xl font-bold mt-1">{stats.pendingDeletions}</p>
              </div>
              <Trash2 className="h-5 w-5 text-muted-foreground" />
            </div>
            {stats.pendingDeletions > 0 && (
              <Badge variant="destructive" className="mt-2">
                Action Required
              </Badge>
            )}
          </Card>

          {/* Monthly Exports */}
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Exports (30 days)</p>
                <p className="text-3xl font-bold mt-1">{stats.monthlyExports}</p>
              </div>
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
          </Card>

          {/* Consent Rate */}
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Consent Rate</p>
                <p className="text-3xl font-bold mt-1">{stats.consentRate}%</p>
              </div>
              <Shield className="h-5 w-5 text-muted-foreground" />
            </div>
            {stats.consentRate === 100 ? (
              <Badge variant="default" className="mt-2 bg-green-500">
                Full Compliance
              </Badge>
            ) : (
              <Badge variant="secondary" className="mt-2">
                {100 - stats.consentRate}% missing
              </Badge>
            )}
          </Card>

          {/* Retention Policy */}
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Retention Period</p>
                <p className="text-3xl font-bold mt-1">{stats.retentionDays}</p>
                <p className="text-xs text-muted-foreground">days</p>
              </div>
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <Badge variant={stats.autoDeleteEnabled ? 'default' : 'secondary'} className="mt-2">
              {stats.autoDeleteEnabled ? 'Auto-cleanup enabled' : 'Manual cleanup'}
            </Badge>
          </Card>

          {/* Oldest Data */}
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Oldest Conversation</p>
                <p className="text-xl font-bold mt-1">
                  {stats.oldestConversation
                    ? Math.floor(
                        (Date.now() - new Date(stats.oldestConversation).getTime()) /
                          (1000 * 60 * 60 * 24),
                      )
                    : 0}{' '}
                  days
                </p>
              </div>
              <Database className="h-5 w-5 text-muted-foreground" />
            </div>
            <Badge variant={getDataAgeColor()} className="mt-2">
              {getDataAgeColor() === 'destructive' ? 'Exceeds retention' : 'Within policy'}
            </Badge>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="space-y-3">
          <h4 className="font-semibold">Quick Actions</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button
              onClick={() => (window.location.href = '/settings?tab=deletion')}
              variant="outline"
              disabled={stats.pendingDeletions === 0}
            >
              <AlertCircle className="h-4 w-4 mr-2" />
              Review Deletion Requests ({stats.pendingDeletions})
            </Button>

            <Button onClick={runManualCleanup} variant="outline" disabled={loading}>
              <Trash2 className="h-4 w-4 mr-2" />
              Run Manual Cleanup
            </Button>

            <Button onClick={() => (window.location.href = '/webhooks')} variant="outline">
              <FileText className="h-4 w-4 mr-2" />
              View GDPR Audit Logs
            </Button>

            <Button
              onClick={() => (window.location.href = '/settings?tab=retention')}
              variant="outline"
            >
              <Shield className="h-4 w-4 mr-2" />
              Configure Retention Policy
            </Button>
          </div>
        </div>

        {/* Compliance Status */}
        <Card className="p-4 bg-muted/50">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
            <div>
              <p className="font-semibold">GDPR Compliance Status</p>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                <li>✓ Data retention policy configured</li>
                <li>✓ Consent tracking enabled</li>
                <li>✓ Data access logging active</li>
                <li>✓ Deletion request workflow in place</li>
                <li>✓ Export functionality available</li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </Card>
  );
};
