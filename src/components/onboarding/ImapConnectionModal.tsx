import { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Eye, EyeOff, ExternalLink, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { lookupProvider, type ProviderPreset } from '@/lib/email/providerPresets';
import { logger } from '@/lib/logger';

type ImportMode = 'new_only' | 'last_1000' | 'last_10000' | 'last_30000' | 'all_history';

interface ImapConnectionModalProps {
  open: boolean;
  workspaceId: string;
  provider: 'icloud' | 'imap';
  importMode: ImportMode;
  onClose: () => void;
  onConnected: (email: string) => void;
}

export function ImapConnectionModal({
  open,
  workspaceId,
  provider,
  importMode,
  onClose,
  onConnected,
}: ImapConnectionModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [showManualSettings, setShowManualSettings] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState('993');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const detectTimeoutRef = useRef<number | undefined>(undefined);

  async function runDetection(emailValue: string) {
    if (!emailValue.includes('@')) return;
    setDetecting(true);
    try {
      const result = await lookupProvider(emailValue);
      setPreset(result);
      if (!result) {
        setShowManualSettings(true);
      } else {
        setManualHost(result.host);
        setManualPort(String(result.port));
      }
    } catch (err) {
      logger.error('Provider detection failed', err);
      setShowManualSettings(true);
    } finally {
      setDetecting(false);
    }
  }

  function handleEmailBlur() {
    if (detectTimeoutRef.current) window.clearTimeout(detectTimeoutRef.current);
    void runDetection(email);
  }

  async function handleSubmit() {
    setErrorMessage(null);

    // Validate
    if (!email || !password) {
      setErrorMessage('Email and password are required');
      return;
    }

    const host = preset?.host ?? manualHost;
    const port = preset?.port ?? parseInt(manualPort, 10);
    const secure = preset?.secure ?? true;

    if (!host || !port || Number.isNaN(port)) {
      setErrorMessage('IMAP server and port are required');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('aurinko-create-imap-account', {
        body: { workspaceId, email, password, host, port, secure, importMode },
      });

      if (error) {
        logger.error('Edge function error', error);
        setErrorMessage('Failed to reach email service. Please try again.');
        return;
      }

      if (!data?.success) {
        // Map error codes to friendly messages using preset metadata
        if (data?.error === 'AUTHENTICATION_FAILED') {
          if (preset?.requiresAppPassword === 'always') {
            setErrorMessage(
              `That password didn't work. ${preset.name} requires an app-specific password, not your regular account password.`,
            );
          } else if (preset?.requiresAppPassword === 'with_2fa') {
            setErrorMessage(
              `Authentication failed. If you have 2-factor authentication enabled on your ${preset.name} account, you need an app-specific password.`,
            );
          } else {
            setErrorMessage(
              'Authentication failed. Check your email and password. Some providers require an app-specific password instead of your regular one.',
            );
          }
        } else if (data?.error === 'IMAP_UNREACHABLE') {
          setErrorMessage(data.message ?? "Couldn't reach the mail server");
        } else if (data?.error === 'SERVICE_UNAVAILABLE') {
          setErrorMessage(
            data.message ?? 'Email service temporarily unavailable. Please try again.',
          );
        } else {
          setErrorMessage(data?.message ?? 'Connection failed');
        }
        return;
      }

      toast.success(`Connected to ${email}`);
      onConnected(email);
    } catch (err) {
      logger.error('IMAP submit error', err);
      setErrorMessage('An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = preset
    ? `Connect ${preset.name}`
    : provider === 'icloud'
      ? 'Connect iCloud Mail'
      : 'Connect Email';

  const needsAppPassword = preset?.requiresAppPassword === 'always';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Email field */}
          <div className="space-y-2">
            <Label htmlFor="imap-email">Email address</Label>
            <Input
              id="imap-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleEmailBlur}
              autoFocus
            />
            {detecting && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Detecting provider...
              </p>
            )}
            {preset && !detecting && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Detected: {preset.name}
              </p>
            )}
          </div>

          {/* App-password warning */}
          {needsAppPassword && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-amber-900">
                    {preset?.name} needs an app-specific password
                  </p>
                  <p className="text-amber-800 text-xs mt-1">
                    Your regular account password won't work. You'll need to generate a one-time
                    password for BizzyBee.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowInstructions(!showInstructions)}
                >
                  {showInstructions ? 'Hide' : 'Show me how'} →
                </Button>
                {preset?.appPasswordHelpUrl && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={preset.appPasswordHelpUrl} target="_blank" rel="noopener noreferrer">
                      Generate one now <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                )}
              </div>
              {showInstructions && preset?.instructions && (
                <ol className="text-xs text-amber-900 list-decimal list-inside space-y-1 mt-2 border-t border-amber-200 pt-2">
                  {preset.instructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Password field */}
          <div className="space-y-2">
            <Label htmlFor="imap-password">
              {needsAppPassword ? 'App-specific password' : 'Password'}
            </Label>
            <div className="relative">
              <Input
                id="imap-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={needsAppPassword ? 'font-mono' : undefined}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {preset?.passwordFormatHint && (
              <p className="text-xs text-muted-foreground">{preset.passwordFormatHint}</p>
            )}
          </div>

          {/* Advanced/manual settings */}
          {(showManualSettings || !preset) && (
            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {preset ? 'Advanced settings' : 'Enter your IMAP settings manually'}
              </p>
              <div className="space-y-2">
                <Label htmlFor="imap-host" className="text-xs">
                  IMAP server
                </Label>
                <Input
                  id="imap-host"
                  placeholder="imap.example.com"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imap-port" className="text-xs">
                  Port
                </Label>
                <Input
                  id="imap-port"
                  type="number"
                  value={manualPort}
                  onChange={(e) => setManualPort(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Connect Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
