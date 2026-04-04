import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import {
  Shield,
  FileText,
  Building2,
  Mail,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

interface SubProcessor {
  name: string;
  purpose: string;
  location: string;
}

interface GDPRSettings {
  id?: string;
  workspace_id: string;
  dpa_version: string;
  dpa_accepted_at: string | null;
  dpa_accepted_by: string | null;
  privacy_policy_url: string | null;
  custom_privacy_policy: string | null;
  company_legal_name: string | null;
  company_address: string | null;
  data_protection_officer_email: string | null;
  sub_processors: SubProcessor[];
}

export const WorkspaceGDPRSettingsPanel = () => {
  const { workspace } = useWorkspace();
  const { isAdmin } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GDPRSettings | null>(null);
  const [newSubProcessor, setNewSubProcessor] = useState<SubProcessor>({
    name: '',
    purpose: '',
    location: '',
  });

  useEffect(() => {
    if (workspace?.id) {
      loadSettings();
    }
  }, [workspace]);

  const loadSettings = async () => {
    if (!workspace?.id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('workspace_gdpr_settings')
        .select('*')
        .eq('workspace_id', workspace.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setSettings({
          ...data,
          sub_processors: Array.isArray(data.sub_processors)
            ? (data.sub_processors as unknown as SubProcessor[])
            : [],
        });
      } else {
        // Create default settings
        setSettings({
          workspace_id: workspace.id,
          dpa_version: 'v1.0',
          dpa_accepted_at: null,
          dpa_accepted_by: null,
          privacy_policy_url: null,
          custom_privacy_policy: null,
          company_legal_name: null,
          company_address: null,
          data_protection_officer_email: null,
          sub_processors: [],
        });
      }
    } catch (error) {
      console.error('Error loading GDPR settings:', error);
      toast.error('Failed to load GDPR settings');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!settings || !workspace?.id) return;

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();

      // Cast sub_processors to Json type for Supabase
      type GDPRInsert = Database['public']['Tables']['workspace_gdpr_settings']['Insert'];
      const settingsToSave: GDPRInsert = {
        workspace_id: workspace.id,
        dpa_version: settings.dpa_version,
        dpa_accepted_at: settings.dpa_accepted_at,
        dpa_accepted_by: settings.dpa_accepted_by,
        privacy_policy_url: settings.privacy_policy_url,
        custom_privacy_policy: settings.custom_privacy_policy,
        company_legal_name: settings.company_legal_name,
        company_address: settings.company_address,
        data_protection_officer_email: settings.data_protection_officer_email,
        sub_processors: JSON.parse(
          JSON.stringify(settings.sub_processors),
        ) as Database['public']['Tables']['workspace_gdpr_settings']['Insert']['sub_processors'],
        updated_at: new Date().toISOString(),
      };

      if (settings.id) {
        const { error } = await supabase
          .from('workspace_gdpr_settings')
          .update(settingsToSave)
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('workspace_gdpr_settings')
          .insert(settingsToSave)
          .select()
          .single();

        if (error) throw error;
        setSettings({ ...settings, id: data.id });
      }

      toast.success('GDPR settings saved successfully');
    } catch (error: any) {
      console.error('Error saving GDPR settings:', error);
      toast.error('Failed to save settings: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const acceptDPA = async () => {
    if (!settings) return;

    const { data: userData } = await supabase.auth.getUser();

    setSettings({
      ...settings,
      dpa_accepted_at: new Date().toISOString(),
      dpa_accepted_by: userData.user?.id || null,
    });

    toast.success('Data Processing Agreement accepted');
  };

  const addSubProcessor = () => {
    if (!newSubProcessor.name || !settings) return;

    setSettings({
      ...settings,
      sub_processors: [...settings.sub_processors, newSubProcessor],
    });

    setNewSubProcessor({ name: '', purpose: '', location: '' });
  };

  const removeSubProcessor = (index: number) => {
    if (!settings) return;

    setSettings({
      ...settings,
      sub_processors: settings.sub_processors.filter((_, i) => i !== index),
    });
  };

  if (!isAdmin) {
    return (
      <Card className="p-6">
        <p className="text-center text-muted-foreground">
          Admin access required to manage GDPR settings
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Shield className="h-5 w-5" />
            GDPR & Privacy Settings
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure your data protection agreement and privacy policies
          </p>
        </div>

        {/* DPA Acceptance */}
        <Card className="p-4 border-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4 className="font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Data Processing Agreement (DPA)
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                Our DPA outlines how we process data on your behalf in compliance with GDPR.
              </p>
            </div>
            <div className="ml-4">
              {settings?.dpa_accepted_at ? (
                <Badge variant="default" className="bg-green-500">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Accepted
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Not Accepted
                </Badge>
              )}
            </div>
          </div>

          {settings?.dpa_accepted_at ? (
            <p className="text-xs text-muted-foreground mt-3">
              Accepted on {new Date(settings.dpa_accepted_at).toLocaleDateString()} (Version{' '}
              {settings.dpa_version})
            </p>
          ) : (
            <Button onClick={acceptDPA} className="mt-3" size="sm">
              Accept DPA (Version {settings?.dpa_version})
            </Button>
          )}
        </Card>

        {/* Company Information */}
        <div className="space-y-4">
          <h4 className="font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Company Information
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company_legal_name">Legal Company Name</Label>
              <Input
                id="company_legal_name"
                value={settings?.company_legal_name || ''}
                onChange={(e) =>
                  setSettings((s) => (s ? { ...s, company_legal_name: e.target.value } : s))
                }
                placeholder="Your Company Ltd"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dpo_email">Data Protection Officer Email</Label>
              <Input
                id="dpo_email"
                type="email"
                value={settings?.data_protection_officer_email || ''}
                onChange={(e) =>
                  setSettings((s) =>
                    s ? { ...s, data_protection_officer_email: e.target.value } : s,
                  )
                }
                placeholder="dpo@company.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company_address">Company Address</Label>
            <Textarea
              id="company_address"
              value={settings?.company_address || ''}
              onChange={(e) =>
                setSettings((s) => (s ? { ...s, company_address: e.target.value } : s))
              }
              placeholder="123 Business Street, City, Country"
              rows={2}
            />
          </div>
        </div>

        {/* Privacy Policy */}
        <div className="space-y-4">
          <h4 className="font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Privacy Policy
          </h4>

          <div className="space-y-2">
            <Label htmlFor="privacy_policy_url">Privacy Policy URL</Label>
            <div className="flex gap-2">
              <Input
                id="privacy_policy_url"
                type="url"
                value={settings?.privacy_policy_url || ''}
                onChange={(e) =>
                  setSettings((s) => (s ? { ...s, privacy_policy_url: e.target.value } : s))
                }
                placeholder="https://yourcompany.com/privacy"
                className="flex-1"
              />
              {settings?.privacy_policy_url && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => window.open(settings.privacy_policy_url!, '_blank')}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom_privacy">Custom Privacy Notice (optional)</Label>
            <Textarea
              id="custom_privacy"
              value={settings?.custom_privacy_policy || ''}
              onChange={(e) =>
                setSettings((s) => (s ? { ...s, custom_privacy_policy: e.target.value } : s))
              }
              placeholder="Additional privacy information specific to your customers..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              This will be included in data export responses and the customer GDPR portal
            </p>
          </div>
        </div>

        {/* Sub-processors */}
        <div className="space-y-4">
          <h4 className="font-semibold">Sub-processors</h4>
          <p className="text-sm text-muted-foreground">
            List third-party services that process customer data on your behalf
          </p>

          {settings?.sub_processors && settings.sub_processors.length > 0 && (
            <div className="space-y-2">
              {settings.sub_processors.map((processor, index) => (
                <Card key={index} className="p-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{processor.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {processor.purpose} • {processor.location}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeSubProcessor(index)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </Card>
              ))}
            </div>
          )}

          <Card className="p-4 bg-muted/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                placeholder="Service name"
                value={newSubProcessor.name}
                onChange={(e) => setNewSubProcessor((s) => ({ ...s, name: e.target.value }))}
              />
              <Input
                placeholder="Purpose"
                value={newSubProcessor.purpose}
                onChange={(e) => setNewSubProcessor((s) => ({ ...s, purpose: e.target.value }))}
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Location"
                  value={newSubProcessor.location}
                  onChange={(e) => setNewSubProcessor((s) => ({ ...s, location: e.target.value }))}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={addSubProcessor}
                  disabled={!newSubProcessor.name}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4 border-t">
          <Button onClick={saveSettings} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save GDPR Settings
          </Button>
        </div>
      </div>
    </Card>
  );
};
