import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import type { Session } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Globe2, Loader2, MessageSquareText, Sparkles } from 'lucide-react';
import { BizzyBeeLogo } from '@/components/branding/BizzyBeeLogo';
import {
  disablePreviewMode,
  enablePreviewMode,
  isLocalhost,
  readOnboardingHandoff,
} from '@/lib/previewMode';
import { useWorkspace } from '@/hooks/useWorkspace';

type AuthMode = 'signin' | 'signup' | 'recovery-request' | 'recovery-confirm';

type AuthToastCopy = {
  title: string;
  description: string;
};

type AuthErrorContext = AuthMode | 'magic-link' | 'oauth';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'An error occurred';
};

const getAuthErrorToast = (error: unknown, context: AuthErrorContext): AuthToastCopy => {
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('rate limit') || normalized.includes('over_email_send_rate_limit')) {
    return {
      title: 'Too many emails sent',
      description: isLocalhost()
        ? 'Local auth emails are throttled. Give it a minute, then try again, or use Open demo preview if you just want to walk the flow.'
        : 'We already sent one recently. Give it a minute, then try again for a fresh BizzyBee link.',
    };
  }

  if (normalized.includes('already registered') || normalized.includes('user already registered')) {
    return {
      title: 'Workspace already exists',
      description:
        'That email already has a BizzyBee account. Sign in instead, or send yourself a magic link to carry on.',
    };
  }

  if (normalized.includes('invalid login credentials')) {
    return {
      title: 'Email or password didn’t match',
      description: 'Try signing in again, or use a magic link if you want the fastest way back in.',
    };
  }

  if (normalized.includes('email not confirmed')) {
    return {
      title: 'Check your inbox first',
      description:
        'We still need you to confirm that email address before you can sign in. Open the latest BizzyBee email and continue from there.',
    };
  }

  if (context === 'signup') {
    return {
      title: 'Couldn’t create workspace',
      description: message,
    };
  }

  if (context === 'magic-link') {
    return {
      title: 'Couldn’t send magic link',
      description: message,
    };
  }

  if (context === 'recovery-request') {
    return {
      title: 'Couldn’t send reset email',
      description: message,
    };
  }

  if (context === 'recovery-confirm') {
    return {
      title: 'Couldn’t update password',
      description: message,
    };
  }

  if (context === 'oauth') {
    return {
      title: 'Couldn’t continue with Google',
      description: message || 'Google sign-in failed',
    };
  }

  return {
    title: 'Something went wrong',
    description: message,
  };
};

const isRecoveryFlow = () =>
  window.location.hash.includes('type=recovery') ||
  window.location.search.includes('type=recovery');

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const onboardingSteps = [
  {
    title: 'Start with your website',
    description:
      'BizzyBee reads your business context first so setup feels tailored from the start.',
    icon: Globe2,
  },
  {
    title: 'Shape tone & responses',
    description:
      'We turn your service details into a clearer voice, reply style, and knowledge base.',
    icon: Sparkles,
  },
  {
    title: 'Connect channels later',
    description:
      'Email, phone, WhatsApp, and Google come after the core setup already feels useful.',
    icon: MessageSquareText,
  },
] as const;

const Auth = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { workspace, loading: workspaceLoading, needsOnboarding } = useWorkspace();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [hasSession, setHasSession] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const canUsePreviewMode = isLocalhost();
  const urlParams = new URLSearchParams(window.location.search);
  const requestedNext = (() => {
    const next = urlParams.get('next');
    return next && next.startsWith('/') ? next : null;
  })();
  const requestedWebsite = urlParams.get('website');

  const isSignUp = mode === 'signup';
  const isSignIn = mode === 'signin';
  const isRecoveryRequest = mode === 'recovery-request';
  const isRecoveryConfirm = mode === 'recovery-confirm';
  const isSubmitting = loading || googleLoading || magicLinkLoading || recoveryLoading;
  const authRedirectParams = new URLSearchParams();
  if (requestedNext) authRedirectParams.set('next', requestedNext);
  if (requestedWebsite) authRedirectParams.set('website', requestedWebsite);
  const authRedirectUrl = `${window.location.origin}/auth${
    authRedirectParams.toString() ? `?${authRedirectParams.toString()}` : ''
  }`;
  const signedInDestination =
    requestedNext ??
    (readOnboardingHandoff()?.step
      ? '/onboarding?preview=0'
      : !workspace?.id || needsOnboarding
        ? '/onboarding'
        : '/');

  // Capture website URL from marketing site query param for onboarding pre-fill
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const website = params.get('website');
    if (website) {
      sessionStorage.setItem('bizzybee_prefill_website', website);
    }
  }, []);

  useEffect(() => {
    const recovery = isRecoveryFlow();
    let cancelled = false;

    const applySession = (nextSession: Session | null) => {
      if (cancelled) {
        return;
      }

      setHasSession(Boolean(nextSession));
      setAuthChecked(true);
    };

    if (recovery) {
      setMode('recovery-confirm');
    }

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        applySession(session);
      })
      .catch(() => {
        applySession(null);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('recovery-confirm');
        setPassword('');
        setConfirmPassword('');
        window.history.replaceState({}, document.title, window.location.pathname);
        applySession(session);
        return;
      }

      applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isRecoveryConfirm) {
      return;
    }

    if (!authChecked || !hasSession || workspaceLoading) {
      return;
    }

    navigate(signedInDestination, { replace: true });
  }, [authChecked, hasSession, isRecoveryConfirm, navigate, signedInDestination, workspaceLoading]);

  const handleAuth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!email || !password || (isSignUp && !name.trim())) {
      toast({
        title: 'Error',
        description: 'Please fill in all fields',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      disablePreviewMode();
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: name.trim(),
            },
            emailRedirectTo: authRedirectUrl,
          },
        });

        if (error) throw error;

        toast({
          title: 'Success!',
          description:
            'Account created. Check your inbox or sign in if email confirmation is disabled.',
        });
        setMode('signin');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        toast({
          title: 'Welcome back!',
          description: 'Successfully signed in.',
        });
      }
    } catch (error: unknown) {
      const toastCopy = getAuthErrorToast(error, mode);
      toast({
        title: toastCopy.title,
        description: toastCopy.description,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      toast({
        title: 'Email required',
        description: 'Enter your email address first and we will send you a magic link.',
        variant: 'destructive',
      });
      return;
    }

    setMagicLinkLoading(true);

    try {
      disablePreviewMode();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authRedirectUrl,
        },
      });

      if (error) throw error;

      toast({
        title: 'Magic link sent',
        description: 'Check your email for a secure sign-in link.',
      });
    } catch (error: unknown) {
      const toastCopy = getAuthErrorToast(error, 'magic-link');
      toast({
        title: toastCopy.title,
        description: toastCopy.description,
        variant: 'destructive',
      });
    } finally {
      setMagicLinkLoading(false);
    }
  };

  const handleRecoveryRequest = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!email) {
      toast({
        title: 'Email required',
        description: 'Enter your email address to receive a reset link.',
        variant: 'destructive',
      });
      return;
    }

    setRecoveryLoading(true);

    try {
      disablePreviewMode();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl,
      });

      if (error) throw error;

      toast({
        title: 'Reset email sent',
        description: 'Open the latest email from BizzyBee to choose a new password.',
      });
    } catch (error: unknown) {
      const toastCopy = getAuthErrorToast(error, 'recovery-request');
      toast({
        title: toastCopy.title,
        description: toastCopy.description,
        variant: 'destructive',
      });
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handlePasswordReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      toast({
        title: 'Error',
        description: 'Please fill in both password fields.',
        variant: 'destructive',
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: 'Password too short',
        description: 'Use at least 8 characters for your new password.',
        variant: 'destructive',
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: 'Passwords do not match',
        description: 'Re-enter the same password in both fields.',
        variant: 'destructive',
      });
      return;
    }

    setRecoveryLoading(true);

    try {
      disablePreviewMode();
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      toast({
        title: 'Password updated',
        description: 'Your password has been changed successfully.',
      });

      navigate(signedInDestination, { replace: true });
    } catch (error: unknown) {
      const toastCopy = getAuthErrorToast(error, 'recovery-confirm');
      toast({
        title: toastCopy.title,
        description: toastCopy.description,
        variant: 'destructive',
      });
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handlePreviewMode = () => {
    enablePreviewMode();
    navigate('/onboarding?preview=1');
  };

  const handleResetPreviewMode = () => {
    disablePreviewMode();
    localStorage.removeItem('bizzybee:onboarding:preview-workspace');
    sessionStorage.removeItem('bizzybee_prefill_website');
    toast({
      title: 'Local preview reset',
      description: 'Preview onboarding has been cleared so you can start again from your website.',
    });
    navigate('/auth', { replace: true });
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);

    try {
      disablePreviewMode();
      const { error } = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });

      if (error) throw error;
    } catch (error: unknown) {
      const toastCopy = getAuthErrorToast(error, 'oauth');
      toast({
        title: toastCopy.title,
        description: toastCopy.description,
        variant: 'destructive',
      });
      setGoogleLoading(false);
    }
  };

  const goToSignIn = () => {
    setMode('signin');
    setPassword('');
    setConfirmPassword('');
  };

  const title =
    mode === 'signup'
      ? 'Create your BizzyBee workspace'
      : mode === 'recovery-request'
        ? 'Reset your password'
        : mode === 'recovery-confirm'
          ? 'Choose a new password'
          : 'Welcome back to BizzyBee';

  const description =
    mode === 'signup'
      ? 'Step zero is simple: create your workspace and we’ll start with your website, not a blank form.'
      : mode === 'recovery-request'
        ? 'We will email you a secure link so you can set a new password.'
        : mode === 'recovery-confirm'
          ? 'Set a fresh password and step straight back into your inbox.'
          : 'Pick up where your onboarding left off and continue building your concierge-led setup.';

  const cardTitle =
    mode === 'signup'
      ? 'Create your workspace'
      : mode === 'recovery-request'
        ? 'Send a reset link'
        : mode === 'recovery-confirm'
          ? 'Set a new password'
          : 'Sign in to continue';

  const cardDescription =
    mode === 'signup'
      ? 'We’ll take you into onboarding right after account creation.'
      : mode === 'recovery-request'
        ? 'We’ll send the newest recovery email to your inbox.'
        : mode === 'recovery-confirm'
          ? 'Choose a new password and get back to your workspace.'
          : 'Your workspace is waiting. Sign in to continue the setup.';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#1c1612] text-[#fff8eb]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(248,215,140,0.18),_transparent_50%),linear-gradient(180deg,_rgba(44,34,24,0.92)_0%,_rgba(22,18,14,1)_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(249, 207, 118, 0.5) 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />
      <div className="absolute left-1/2 top-16 h-96 w-96 -translate-x-1/2 rounded-full bg-[#f4be59]/10 blur-[120px]" />
      <div className="absolute right-[-5rem] top-20 h-56 w-56 rounded-full bg-[#cf8e1e]/8 blur-3xl" />
      <div className="absolute bottom-[-8rem] left-[-5rem] h-72 w-72 rounded-full bg-[#5e3a12]/20 blur-3xl" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <main className="order-2 lg:order-1">
            <div className="mb-7 flex flex-col items-start gap-4 text-left">
              <div className="inline-flex flex-col items-start gap-2 rounded-[22px] border border-[#4c3520] bg-[#1b140d]/85 px-5 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <BizzyBeeLogo variant="full" size="md" chip="light" imgClassName="max-w-[140px]" />
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#f1c56a]">
                  AI customer operations
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.34em] text-[#c69539]">
                  Step 0 of onboarding
                </p>
                <h1 className="max-w-xl font-serif text-4xl tracking-tight text-[#fff6e6] text-balance sm:text-[2.8rem]">
                  {title}
                </h1>
                <p className="max-w-xl text-[15px] leading-6 text-[#cbbca3]">{description}</p>
              </div>
            </div>

            <section
              className="rounded-[30px] border border-[#43311d] bg-[#15100b]/70 p-6 shadow-[0_28px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-7"
              aria-label="What happens after sign in"
            >
              <div className="mb-5 flex items-center gap-2 text-[#f3cf77]">
                <Sparkles className="h-4 w-4" />
                <p className="text-xs uppercase tracking-[0.26em]">What happens next</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {onboardingSteps.map((step) => {
                  const Icon = step.icon;

                  return (
                    <div
                      key={step.title}
                      className="rounded-[22px] border border-[#322515] bg-[#1a140e]/85 p-4 shadow-[0_14px_34px_rgba(0,0,0,0.18)]"
                    >
                      <Icon className="mb-3 h-5 w-5 text-[#f0c868]" aria-hidden="true" />
                      <h2 className="text-sm font-semibold text-[#fff3dd]">{step.title}</h2>
                      <p className="mt-2 text-sm leading-6 text-[#ae9d80]">{step.description}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-5 text-sm leading-6 text-[#9f8c70]">
                You’ll see BizzyBee learn your business before you’re asked to connect every
                channel.
              </p>
            </section>
          </main>

          <aside className="order-1 lg:order-2">
            <Card
              className="w-full overflow-hidden bg-[#17110c]/88 text-[#fff8eb] backdrop-blur-xl"
              style={{
                borderRadius: '28px',
                border: '1px solid rgba(244, 190, 89, 0.14)',
                boxShadow: '0 35px 80px rgba(0, 0, 0, 0.42)',
              }}
            >
              <CardHeader className="space-y-2 pb-5">
                {(isRecoveryRequest || isRecoveryConfirm) && (
                  <button
                    type="button"
                    onClick={goToSignIn}
                    disabled={isSubmitting}
                    className="inline-flex w-fit items-center gap-2 self-start rounded-full border border-[#3d2a17] bg-[#120e09] px-3 py-1.5 text-xs font-medium text-[#d4ba92] transition-colors hover:bg-[#1c140d] disabled:opacity-60"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to sign in
                  </button>
                )}
                <CardTitle className="font-serif text-2xl text-[#fff6e6]">{cardTitle}</CardTitle>
                <CardDescription className="text-sm leading-6 text-[#c0af96]">
                  {cardDescription}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                {!isRecoveryRequest && !isRecoveryConfirm && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 w-full rounded-2xl border-[#3b2a18] bg-[#1f1710] text-[#f7efdf] hover:bg-[#2a1e14] hover:text-white"
                      disabled={googleLoading || loading}
                      onClick={handleGoogle}
                    >
                      {googleLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <GoogleIcon />
                      )}
                      Continue with Google
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-[#342516]" />
                      </div>
                      <div className="relative flex justify-center text-[11px] uppercase tracking-[0.26em]">
                        <span className="bg-[#17110c] px-3 text-[#8f7e64]">or</span>
                      </div>
                    </div>
                  </>
                )}

                {(isSignIn || isSignUp) && (
                  <form onSubmit={handleAuth} className="space-y-4">
                    {isSignUp && (
                      <div className="space-y-2">
                        <Label
                          htmlFor="name"
                          className="text-xs uppercase tracking-[0.22em] text-[#b89d72]"
                        >
                          Name
                        </Label>
                        <Input
                          id="name"
                          type="text"
                          placeholder="Your name…"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          disabled={isSubmitting}
                          className="h-[52px] rounded-2xl border-[#3b2a18] bg-[#1c150f] text-[#fff6e6] placeholder:text-[#7f6e57]"
                          required
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label
                        htmlFor="email"
                        className="text-xs uppercase tracking-[0.22em] text-[#b89d72]"
                      >
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isSubmitting}
                        className="h-[52px] rounded-2xl border-[#3b2a18] bg-[#1c150f] text-[#fff6e6] placeholder:text-[#7f6e57]"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label
                        htmlFor="password"
                        className="text-xs uppercase tracking-[0.22em] text-[#b89d72]"
                      >
                        Password
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder={
                          isSignUp ? 'Use at least 8 characters' : 'Enter your password…'
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isSubmitting}
                        className="h-[52px] rounded-2xl border-[#3b2a18] bg-[#1c150f] text-[#fff6e6] placeholder:text-[#7f6e57]"
                        required
                      />
                    </div>

                    {isSignIn && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setMode('recovery-request')}
                          className="text-sm font-medium text-[#92d2cf] transition-colors hover:text-[#b0ece8]"
                          disabled={isSubmitting}
                        >
                          Forgot your password?
                        </button>
                      </div>
                    )}

                    <div className="space-y-3 pt-1">
                      <Button
                        type="submit"
                        className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#d09b35] via-[#edc66d] to-[#f2d287] text-[#24170a] shadow-[0_16px_40px_rgba(208,155,53,0.22)] hover:brightness-105"
                        disabled={loading || googleLoading || magicLinkLoading || recoveryLoading}
                      >
                        {loading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {isSignUp ? 'Creating account…' : 'Signing in…'}
                          </>
                        ) : isSignUp ? (
                          'Create account'
                        ) : (
                          'Sign in'
                        )}
                      </Button>

                      {isSignIn && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-12 w-full rounded-2xl border-[#3b2a18] bg-transparent text-[#d8ccb8] hover:bg-[#20160f] hover:text-[#fff5e2]"
                          disabled={isSubmitting}
                          onClick={handleMagicLink}
                        >
                          {magicLinkLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Sending magic link…
                            </>
                          ) : (
                            'Send magic link'
                          )}
                        </Button>
                      )}
                      {canUsePreviewMode && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-12 w-full rounded-2xl border-[#4a3823] bg-[#16100b] text-[#d8ccb8] hover:bg-[#20160f] hover:text-[#fff5e2]"
                            disabled={isSubmitting}
                            onClick={handlePreviewMode}
                          >
                            Open demo preview
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-12 w-full rounded-2xl border border-[#2d2117] bg-transparent text-[#bca789] hover:bg-[#16100b] hover:text-[#fff5e2]"
                            disabled={isSubmitting}
                            onClick={handleResetPreviewMode}
                          >
                            Reset demo preview
                          </Button>
                        </div>
                      )}
                      {canUsePreviewMode && (
                        <p className="text-center text-xs leading-5 text-[#8f7e64]">
                          Demo preview is for cheap walkthroughs only. Use real sign-in above when
                          you want to test emails, live scraping, or the full onboarding pipeline.
                        </p>
                      )}
                    </div>
                  </form>
                )}

                {isRecoveryRequest && (
                  <form onSubmit={handleRecoveryRequest} className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="recovery-email"
                        className="text-xs uppercase tracking-[0.22em] text-[#b89d72]"
                      >
                        Email
                      </Label>
                      <Input
                        id="recovery-email"
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isSubmitting}
                        className="h-[52px] rounded-2xl border-[#3b2a18] bg-[#1c150f] text-[#fff6e6] placeholder:text-[#7f6e57]"
                        required
                      />
                    </div>

                    <Button
                      type="submit"
                      className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#d09b35] via-[#edc66d] to-[#f2d287] text-[#24170a] shadow-[0_16px_40px_rgba(208,155,53,0.22)] hover:brightness-105"
                      disabled={isSubmitting}
                    >
                      {recoveryLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Sending reset email…
                        </>
                      ) : (
                        'Send reset email'
                      )}
                    </Button>

                    <p className="text-center text-sm leading-6 text-[#9d8c72]">
                      Use the newest email from BizzyBee. The link will bring you straight back
                      here.
                    </p>
                  </form>
                )}

                {isRecoveryConfirm && (
                  <form onSubmit={handlePasswordReset} className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="new-password"
                        className="text-xs uppercase tracking-[0.22em] text-[#b89d72]"
                      >
                        New password
                      </Label>
                      <Input
                        id="new-password"
                        type="password"
                        placeholder="Use at least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isSubmitting}
                        className="h-[52px] rounded-2xl border-[#3b2a18] bg-[#1c150f] text-[#fff6e6] placeholder:text-[#7f6e57]"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label
                        htmlFor="confirm-password"
                        className="text-xs uppercase tracking-[0.22em] text-[#b89d72]"
                      >
                        Confirm password
                      </Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        placeholder="Enter the same password again"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={isSubmitting}
                        className="h-[52px] rounded-2xl border-[#3b2a18] bg-[#1c150f] text-[#fff6e6] placeholder:text-[#7f6e57]"
                        required
                      />
                    </div>

                    <Button
                      type="submit"
                      className="h-12 w-full rounded-2xl bg-gradient-to-r from-[#d09b35] via-[#edc66d] to-[#f2d287] text-[#24170a] shadow-[0_16px_40px_rgba(208,155,53,0.22)] hover:brightness-105"
                      disabled={isSubmitting}
                    >
                      {recoveryLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Updating password…
                        </>
                      ) : (
                        'Update password'
                      )}
                    </Button>
                  </form>
                )}

                {(isSignIn || isSignUp) && (
                  <div className="text-center text-sm">
                    <span className="text-[#8e7d64]">
                      {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMode(isSignUp ? 'signin' : 'signup')}
                      className="font-semibold text-[#8fe0da] transition-colors hover:text-[#b9f2ef]"
                      disabled={isSubmitting}
                    >
                      {isSignUp ? 'Sign in' : 'Sign up'}
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Auth;
