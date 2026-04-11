import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Mail, Loader2, Coffee, ArrowRight } from 'lucide-react';

const calmMessages = [
  'Your inbox is connected. BizzyBee is finishing setup in the background.',
  'BizzyBee is syncing your mailbox and preparing the next step.',
  'You can keep this tab open while the connection finishes.',
  'Setup is in motion. We will bring you back as soon as it is ready.',
];

export default function EmailAuthSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [randomMessage] = useState(
    () => calmMessages[Math.floor(Math.random() * calmMessages.length)],
  );

  const status = searchParams.get('aurinko');
  const message = searchParams.get('message');

  // If it's an error or cancelled, redirect back to onboarding
  useEffect(() => {
    if (status === 'error' || status === 'cancelled') {
      navigate('/onboarding?step=email&aurinko=' + status + (message ? '&message=' + message : ''));
    }
  }, [status, message, navigate]);

  // If opened as a popup, notify the opener and try to close automatically.
  useEffect(() => {
    if (status !== 'success') return;

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'aurinko-auth-success' }, window.location.origin);
        window.setTimeout(() => {
          window.close();
        }, 150);
      }
    } catch {
      // ignore
    }
  }, [status]);

  const handleReturnToOnboarding = () => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'aurinko-auth-success' }, window.location.origin);
        window.close();
        return;
      }
    } catch {
      // ignore
    }

    navigate('/onboarding?step=email&aurinko=success');
  };

  if (status !== 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Checking connection status...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          {/* Success Icon */}
          <div className="relative mx-auto w-fit">
            <div className="absolute inset-0 bg-success/20 rounded-full blur-xl animate-pulse" />
            <div className="relative bg-success/10 rounded-full p-4">
              <CheckCircle2 className="h-12 w-12 text-success" />
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <CardTitle className="text-2xl">Email connected</CardTitle>
            <CardDescription className="text-base">
              BizzyBee can now import your inbox and learn how you work.
            </CardDescription>
          </div>

          {/* What's happening */}
          <div className="bg-muted/50 rounded-lg p-4 text-left space-y-3">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Synchronizing your inbox</p>
                <p className="text-muted-foreground">
                  BizzyBee is bringing in your messages and setup details now.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Loader2 className="h-5 w-5 text-primary mt-0.5 shrink-0 animate-spin" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Learning your preferences</p>
                <p className="text-muted-foreground">
                  The setup continues in the background while you move on.
                </p>
              </div>
            </div>
          </div>

          {/* Playful message */}
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground bg-primary/5 rounded-lg p-3">
            <Coffee className="h-4 w-4" />
            <span className="italic">{randomMessage}</span>
          </div>

          {/* CTA */}
          <Button 
            onClick={handleReturnToOnboarding}
            size="lg"
            className="w-full gap-2"
          >
            Continue setup
            <ArrowRight className="h-4 w-4" />
          </Button>

          <p className="text-xs text-muted-foreground">
            If this tab stays open, the setup screen is one click away.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
