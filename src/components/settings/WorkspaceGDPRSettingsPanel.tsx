import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import {
  Shield,
  FileText,
  Building2,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { PanelNotice } from './PanelNotice';

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

interface GDPRSettingsResponse {
  success: boolean;
  settings?: GDPRSettings;
  error?: string;
}

const buildDefaultSettings = (workspaceId: string): GDPRSettings => ({
  workspace_id: workspaceId,
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

export const WorkspaceGDPRSettingsPanel = () => {
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<GDPRSettings | null>(null);
  const [newSubProcessor, setNewSubProcessor] = useState<SubProcessor>({
    name: '',
    purpose: '',
    location: '',
  });

  const hydrateSettings = useCallback(
    (incoming?: Partial<GDPRSettings> | null): GDPRSettings => ({
      ...buildDefaultSettings(workspace?.id ?? ''),
      ...incoming,
      workspace_id: workspace?.id ?? incoming?.workspace_id ?? '',
      sub_processors: Array.isArray(incoming?.sub_processors)
        ? incoming.sub_processors.map((item) => ({
            name: item.name ?? '',
            purpose: item.purpose ?? '',
            location: item.location ?? '',
          }))
        : [],
    }),
    [workspace?.id],
  );

  const loadSettings = useCallback(async () => {
    if (!workspace?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<GDPRSettingsResponse>(
        'workspace-gdpr-settings',
        {
          body: { action: 'load' },
        },
      );

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Could not load GDPR settings');
      }

      setSettings(hydrateSettings(data.settings));
    } catch (error) {
      console.error('Error loading GDPR settings:', error);
      toast.error('Failed to load GDPR settings');
    } finally {
      setLoading(false);
    }
  }, [hydrateSettings, workspace?.id]);

  useEffect(() => {
    if (workspace?.id) {
      void loadSettings();
    }
  }, [loadSettings, workspace?.id]);

  const saveSettings = async () => {
    if (!settings || !workspace?.id) return;

    setSaving(true);
    try {
      const settingsToSave = {
        workspace_id: workspace.id,
        dpa_version: settings.dpa_version,
        dpa_accepted_at: settings.dpa_accepted_at,
        dpa_accepted_by: settings.dpa_accepted_by,
        privacy_policy_url: settings.privacy_policy_url,
        custom_privacy_policy: settings.custom_privacy_policy,
        company_legal_name: settings.company_legal_name,
        company_address: settings.company_address,
        data_protection_officer_email: settings.data_protection_officer_email,
        sub_processors: settings.sub_processors,
      };

      const { data, error } = await supabase.functions.invoke<GDPRSettingsResponse>(
        'workspace-gdpr-settings',
        {
          body: {
            action: 'save',
            settings: settingsToSave,
          },
        },
      );

      if (error) {
        throw error;
      }

      if (!data?.success || !data.settings) {
        throw new Error(data?.error || 'Could not save GDPR settings');
      }

      setSettings(hydrateSettings(data.settings));
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

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke<GDPRSettingsResponse>(
        'workspace-gdpr-settings',
        {
          body: {
            action: 'accept_dpa',
            dpa_version: settings.dpa_version,
          },
        },
      );

      if (error) {
        throw error;
      }

      if (!data?.success || !data.settings) {
        throw new Error(data?.error || 'Could not accept DPA');
      }

      setSettings(hydrateSettings(data.settings));
      toast.success('Data Processing Agreement accepted');
    } catch (error: any) {
      console.error('Error accepting DPA:', error);
      toast.error(error.message || 'Could not accept the DPA');
    } finally {
      setSaving(false);
    }
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

  if (roleLoading || workspaceLoading || loading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!workspace?.id) {
    return (
      <PanelNotice
        icon={Shield}
        title="Finish setup before configuring GDPR settings"
        description="BizzyBee needs a workspace before it can save your legal entity details, privacy policy, and DPA acceptance."
        actionLabel="Open onboarding"
        actionTo="/onboarding?reset=true"
      />
    );
  }

  if (!isAdmin) {
    return (
      <PanelNotice
        icon={Shield}
        title="GDPR settings require admin access"
        description="Only an admin should be able to change the DPA, privacy policy, and data protection contacts for a workspace."
        actionLabel="Open Workspace & Access"
        actionTo="/settings?category=workspace"
      />
    );
  }

  if (!settings) {
    return (
      <PanelNotice
        icon={Shield}
        title="GDPR settings are not ready yet"
        description="BizzyBee could not load the compliance record for this workspace yet. Refresh the page and try again."
      />
    );
  }

  return (
    <Card className="rounded-[28px] border-[0.5px] border-bb-border bg-gradient-to-b from-bb-white to-bb-cream/60 p-6 shadow-[0_18px_40px_rgba(28,21,16,0.05)]">
      <div className="space-y-6">
        <div className="rounded-2xl border border-bb-border bg-bb-white/80 p-5">
          <Badge className="border-bb-gold/25 bg-bb-gold/10 text-bb-espresso hover:bg-bb-gold/10">
            Compliance control
          </Badge>
          <h3 className="mt-3 flex items-center gap-2 text-lg font-semibold text-bb-text">
            <Shield className="h-5 w-5 text-bb-gold" />
            GDPR & Privacy Settings
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-bb-warm-gray">
            Keep the legal and customer-facing privacy details in one place. This is the source
            BizzyBee uses for your GDPR portal, export responses, and internal compliance checks.
          </p>
        </div>

        {/* DPA Acceptance */}
        <Card className="border-[0.5px] border-bb-border bg-bb-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4 className="flex items-center gap-2 font-semibold text-bb-text">
                <FileText className="h-4 w-4 text-bb-gold" />
                Data Processing Agreement (DPA)
              </h4>
              <p className="mt-1 text-sm text-bb-warm-gray">
                Our DPA outlines how we process data on your behalf in compliance with GDPR.
              </p>
            </div>
            <div className="ml-4">
              {settings?.dpa_accepted_at ? (
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Accepted
                </Badge>
              ) : (
                <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50">
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
            <Button onClick={acceptDPA} className="mt-3" size="sm" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Accept DPA (Version {settings?.dpa_version})
            </Button>
          )}
        </Card>

        {/* Company Information */}
        <div className="space-y-4">
          <h4 className="font-semibold flex items-center gap-2 text-bb-text">
            <Building2 className="h-4 w-4 text-bb-gold" />
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
          <h4 className="font-semibold flex items-center gap-2 text-bb-text">
            <FileText className="h-4 w-4 text-bb-gold" />
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
          <h4 className="font-semibold text-bb-text">Sub-processors</h4>
          <p className="text-sm text-bb-warm-gray">
            List third-party services that process customer data on your behalf
          </p>

          {settings?.sub_processors && settings.sub_processors.length > 0 && (
            <div className="space-y-2">
              {settings.sub_processors.map((processor, index) => (
                <Card
                  key={index}
                  className="flex items-center justify-between border-[0.5px] border-bb-border bg-bb-white p-3"
                >
                  <div>
                    <p className="font-medium text-bb-text">{processor.name}</p>
                    <p className="text-sm text-bb-warm-gray">
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

          <Card className="border-[0.5px] border-dashed border-bb-border bg-bb-white/70 p-4">
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
        <div className="flex justify-end border-t border-bb-border-light pt-4">
          <Button onClick={saveSettings} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save GDPR Settings
          </Button>
        </div>
      </div>
    </Card>
  );
};
