import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { useWorkspace } from '@/hooks/useWorkspace';
import { Upload, Save, Eye, Building2, Code } from 'lucide-react';
import DOMPurify from 'dompurify';

interface EmailSettings {
  id?: string;
  from_name: string;
  reply_to_email: string;
  signature_html: string;
  logo_url: string;
  company_name: string;
  company_phone: string;
  company_website: string;
  company_address: string;
}

const defaultSettings: EmailSettings = {
  from_name: '',
  reply_to_email: '',
  signature_html: '',
  logo_url: '',
  company_name: '',
  company_phone: '',
  company_website: '',
  company_address: '',
};

export function EmailSettingsPanel() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const [settings, setSettings] = useState<EmailSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [useCustomHtml, setUseCustomHtml] = useState(false);
  const [customHtml, setCustomHtml] = useState('');

  const fetchSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('email_settings')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setSettings(data as EmailSettings);
        // If there's existing signature_html, load it into custom HTML field
        if (data.signature_html) {
          setCustomHtml(data.signature_html);
        }
      }
    } catch (error) {
      logger.error('Error fetching email settings', error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) {
      void fetchSettings();
    }
  }, [fetchSettings, workspaceId]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${workspaceId}/logo-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('email-assets')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('email-assets').getPublicUrl(fileName);

      setSettings((prev) => ({ ...prev, logo_url: publicUrl }));
      toast({ title: 'Logo uploaded successfully' });
    } catch (error) {
      logger.error('Error uploading logo', error);
      toast({ title: 'Failed to upload logo', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const generateSignatureHtml = (): string => {
    const { company_name, company_phone, company_website, company_address, logo_url, from_name } =
      settings;

    return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 12px; color: #333;">
  <tr>
    <td style="padding-right: 15px; vertical-align: top;">
      ${logo_url ? `<img src="${logo_url}" alt="${company_name}" style="max-width: 80px; max-height: 80px;" />` : ''}
    </td>
    <td style="vertical-align: top; border-left: 2px solid #1976d2; padding-left: 15px;">
      ${from_name ? `<div style="font-weight: bold; font-size: 14px; color: #1976d2;">${from_name}</div>` : ''}
      ${company_name ? `<div style="margin-top: 4px;">${company_name}</div>` : ''}
      ${company_phone ? `<div style="margin-top: 4px;">📞 ${company_phone}</div>` : ''}
      ${company_website ? `<div style="margin-top: 4px;">🌐 <a href="${company_website}" style="color: #1976d2;">${company_website.replace(/^https?:\/\//, '')}</a></div>` : ''}
      ${company_address ? `<div style="margin-top: 4px; color: #666;">${company_address}</div>` : ''}
    </td>
  </tr>
</table>
    `.trim();
  };

  // Sanitize HTML to prevent XSS attacks - allows only safe email signature elements
  const sanitizeSignatureHtml = (html: string): string => {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'table',
        'tr',
        'td',
        'th',
        'tbody',
        'thead',
        'div',
        'span',
        'img',
        'a',
        'b',
        'i',
        'strong',
        'em',
        'br',
        'p',
        'hr',
        'font',
      ],
      ALLOWED_ATTR: [
        'style',
        'href',
        'src',
        'alt',
        'width',
        'height',
        'cellpadding',
        'cellspacing',
        'border',
        'align',
        'valign',
        'bgcolor',
        'color',
        'face',
        'size',
        'target',
        'rel',
      ],
    });
  };

  const getSignatureHtml = (): string => {
    const rawHtml = useCustomHtml ? customHtml : generateSignatureHtml();
    return sanitizeSignatureHtml(rawHtml);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const signatureHtml = getSignatureHtml();
      const dataToSave = { ...settings, signature_html: signatureHtml, workspace_id: workspaceId };

      if (settings.id) {
        const { error } = await supabase
          .from('email_settings')
          .update(dataToSave)
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('email_settings')
          .insert(dataToSave)
          .select()
          .single();
        if (error) throw error;
        setSettings((prev) => ({ ...prev, id: data.id, signature_html: signatureHtml }));
      }

      toast({ title: 'Email settings saved' });
    } catch (error) {
      logger.error('Error saving email settings', error);
      toast({ title: 'Failed to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse">Loading email settings...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Email Settings
          </CardTitle>
          <CardDescription>Configure sender information and email signature</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Name</Label>
              <Input
                value={settings.from_name}
                onChange={(e) => setSettings((prev) => ({ ...prev, from_name: e.target.value }))}
                placeholder="MAC Cleaning Support"
              />
            </div>
            <div className="space-y-2">
              <Label>Reply-To Email</Label>
              <Input
                type="email"
                value={settings.reply_to_email}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, reply_to_email: e.target.value }))
                }
                placeholder="support@company.com"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Email Signature
            </div>
            <div className="flex items-center gap-3">
              <Label
                htmlFor="custom-html-toggle"
                className="text-sm font-normal text-muted-foreground"
              >
                {useCustomHtml ? 'Custom HTML' : 'Builder Mode'}
              </Label>
              <Switch
                id="custom-html-toggle"
                checked={useCustomHtml}
                onCheckedChange={setUseCustomHtml}
              />
            </div>
          </CardTitle>
          <CardDescription>
            {useCustomHtml
              ? 'Paste your custom HTML signature directly'
              : 'Fill in your company details to auto-generate a signature'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {useCustomHtml ? (
            <div className="space-y-2">
              <Label>Custom HTML Signature</Label>
              <Textarea
                value={customHtml}
                onChange={(e) => setCustomHtml(e.target.value)}
                placeholder="<table>...</table>"
                className="font-mono text-sm min-h-[200px]"
              />
              <p className="text-xs text-muted-foreground">
                Paste your complete HTML signature. Use inline CSS for best email client
                compatibility.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company Name</Label>
                  <Input
                    value={settings.company_name}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, company_name: e.target.value }))
                    }
                    placeholder="MAC Cleaning Services"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input
                    value={settings.company_phone}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, company_phone: e.target.value }))
                    }
                    placeholder="+44 123 456 7890"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input
                    value={settings.company_website}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, company_website: e.target.value }))
                    }
                    placeholder="https://www.company.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input
                    value={settings.company_address}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, company_address: e.target.value }))
                    }
                    placeholder="123 Main St, London, UK"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Company Logo</Label>
                <div className="flex items-center gap-4">
                  {settings.logo_url && (
                    <img
                      src={settings.logo_url}
                      alt="Logo"
                      className="h-16 w-auto rounded border"
                    />
                  )}
                  <div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      id="logo-upload"
                    />
                    <Button
                      variant="outline"
                      onClick={() => document.getElementById('logo-upload')?.click()}
                      disabled={uploading}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {uploading ? 'Uploading...' : 'Upload Logo'}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Signature Preview</span>
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="h-4 w-4 mr-2" />
              {showPreview ? 'Hide' : 'Show'} Preview
            </Button>
          </CardTitle>
        </CardHeader>
        {showPreview && (
          <CardContent>
            <div
              className="p-4 bg-muted rounded-lg border"
              // getSignatureHtml() is sanitized, but we sanitize again at render-time to make the trust boundary explicit.
              dangerouslySetInnerHTML={{ __html: sanitizeSignatureHtml(getSignatureHtml()) }}
            />
          </CardContent>
        )}
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
