import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { useWorkspace } from '@/hooks/useWorkspace';

export const RetentionPolicyPanel = () => {
  const [policy, setPolicy] = useState<any>(null);
  const [retentionDays, setRetentionDays] = useState(365);
  const [autoDelete, setAutoDelete] = useState(false);
  const [anonymize, setAnonymize] = useState(true);
  const [excludeVip, setExcludeVip] = useState(true);
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useUserRole();
  const { workspace } = useWorkspace();

  const loadPolicy = useCallback(async () => {
    if (!workspace?.id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('data_retention_policies')
        .select('*')
        .eq('workspace_id', workspace.id)
        .single();

      if (data) {
        setPolicy(data);
        setRetentionDays(data.retention_days);
        setAutoDelete(data.auto_delete_enabled);
        setAnonymize(data.anonymize_instead_of_delete);
        setExcludeVip(data.exclude_vip_customers);
      }
    } catch (error: any) {
      // Policy might not exist yet, that's ok
      console.log('No policy found, will create new one');
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    if (workspace?.id) {
      void loadPolicy();
    }
  }, [loadPolicy, workspace?.id]);

  const handleSave = async () => {
    if (!workspace?.id) {
      toast.error('No workspace found');
      return;
    }

    setLoading(true);
    try {
      const policyData = {
        workspace_id: workspace.id,
        retention_days: retentionDays,
        auto_delete_enabled: autoDelete,
        anonymize_instead_of_delete: anonymize,
        exclude_vip_customers: excludeVip,
      };

      if (policy) {
        await supabase.from('data_retention_policies').update(policyData).eq('id', policy.id);
      } else {
        await supabase.from('data_retention_policies').insert(policyData);
      }

      toast.success('Retention policy saved successfully');
      loadPolicy();
    } catch (error: any) {
      toast.error('Failed to save policy: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Admin access required to manage retention policies
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">Data Retention Policy</h3>
          <p className="text-sm text-muted-foreground">
            GDPR compliance: Configure how long customer data is retained (Storage Limitation -
            Article 5)
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="retention">Retention Period (days)</Label>
            <Input
              id="retention"
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value) || 365)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Data older than {retentionDays} days will be processed according to settings below
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Auto-deletion</Label>
              <p className="text-xs text-muted-foreground">
                Automatically process old data based on retention period
              </p>
            </div>
            <Switch checked={autoDelete} onCheckedChange={setAutoDelete} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Anonymize Instead of Delete</Label>
              <p className="text-xs text-muted-foreground">
                Keep conversation history but remove personal identifiers
              </p>
            </div>
            <Switch checked={anonymize} onCheckedChange={setAnonymize} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Exclude VIP Customers</Label>
              <p className="text-xs text-muted-foreground">
                Don't auto-delete data for VIP tier customers
              </p>
            </div>
            <Switch checked={excludeVip} onCheckedChange={setExcludeVip} />
          </div>

          <Button onClick={handleSave} disabled={loading} className="w-full">
            Save Retention Policy
          </Button>
        </div>
      </div>
    </Card>
  );
};
