import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Bot } from 'lucide-react';

interface AISettingsCardProps {
  workspaceId: string;
}

export const AISettingsCard = ({ workspaceId }: AISettingsCardProps) => {
  const [settings, setSettings] = useState({
    auto_send_enabled: false,
    auto_send_threshold: 0.95,
    default_to_drafts: true,
    always_verify: true,
    notify_on_low_confidence: true,
    low_confidence_threshold: 0.7,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data, error } = await supabase
        .from('automation_settings')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (data) {
        setSettings({
          auto_send_enabled: data.auto_send_enabled ?? false,
          auto_send_threshold: Number(data.auto_send_threshold),
          default_to_drafts: data.default_to_drafts ?? true,
          always_verify: data.always_verify ?? true,
          notify_on_low_confidence: data.notify_on_low_confidence ?? true,
          low_confidence_threshold: Number(data.low_confidence_threshold),
        });
      }
      setLoading(false);
    };

    if (workspaceId) fetchSettings();
  }, [workspaceId]);

  const updateSetting = async (key: string, value: boolean | number) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    setSaving(true);

    const { error } = await supabase.from('automation_settings').upsert(
      {
        workspace_id: workspaceId,
        ...newSettings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );

    setSaving(false);
    if (error) {
      toast.error('Failed to save settings');
      console.error('Settings save error:', error);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <CardTitle>AI Behavior</CardTitle>
        </div>
        <CardDescription>Configure how BizzyBee's AI handles your emails</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Default to drafts - RECOMMENDED */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Default all replies to drafts</Label>
            <p className="text-sm text-muted-foreground">
              Review all AI replies before sending (recommended for new users)
            </p>
          </div>
          <Switch
            checked={settings.default_to_drafts}
            onCheckedChange={(v) => updateSetting('default_to_drafts', v)}
          />
        </div>

        {/* Auto-send toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Auto-send high-confidence replies</Label>
            <p className="text-sm text-muted-foreground">
              Automatically send replies when AI confidence exceeds threshold
            </p>
          </div>
          <Switch
            checked={settings.auto_send_enabled}
            onCheckedChange={(v) => updateSetting('auto_send_enabled', v)}
            disabled={settings.default_to_drafts}
          />
        </div>

        {/* Auto-send threshold slider */}
        {settings.auto_send_enabled && !settings.default_to_drafts && (
          <div className="space-y-3 pl-4 border-l-2 border-primary/20">
            <div className="flex justify-between items-center">
              <Label>Auto-send confidence threshold</Label>
              <span className="text-sm font-medium text-primary">
                {(settings.auto_send_threshold * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[settings.auto_send_threshold]}
              onValueChange={([v]) => updateSetting('auto_send_threshold', v)}
              min={0.85}
              max={0.99}
              step={0.01}
            />
            <p className="text-xs text-muted-foreground">
              Only replies with confidence above this threshold will be sent automatically
            </p>
          </div>
        )}

        {/* Always verify */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Quality verification</Label>
            <p className="text-sm text-muted-foreground">
              Double-check all AI responses for accuracy before presenting
            </p>
          </div>
          <Switch
            checked={settings.always_verify}
            onCheckedChange={(v) => updateSetting('always_verify', v)}
          />
        </div>

        {/* Low confidence notifications */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Low confidence alerts</Label>
            <p className="text-sm text-muted-foreground">
              Notify when AI confidence falls below threshold
            </p>
          </div>
          <Switch
            checked={settings.notify_on_low_confidence}
            onCheckedChange={(v) => updateSetting('notify_on_low_confidence', v)}
          />
        </div>

        {/* Low confidence threshold slider */}
        {settings.notify_on_low_confidence && (
          <div className="space-y-3 pl-4 border-l-2 border-amber-500/30">
            <div className="flex justify-between items-center">
              <Label>Low confidence threshold</Label>
              <span className="text-sm font-medium text-amber-600">
                {(settings.low_confidence_threshold * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[settings.low_confidence_threshold]}
              onValueChange={([v]) => updateSetting('low_confidence_threshold', v)}
              min={0.5}
              max={0.85}
              step={0.05}
            />
            <p className="text-xs text-muted-foreground">
              You'll be notified when AI confidence drops below this level
            </p>
          </div>
        )}

        {saving && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </div>
        )}
      </CardContent>
    </Card>
  );
};
