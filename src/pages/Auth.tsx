import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2 } from 'lucide-react';
import beeLogo from '@/assets/bee-logo.png';

type AuthMode = 'signin' | 'signup' | 'recovery-request' | 'recovery-confirm';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'An error occurred';
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

const Auth = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const isSignUp = mode === 'signup';
  const isSignIn = mode === 'signin';
  const isRecoveryRequest = mode === 'recovery-request';
  const isRecoveryConfirm = mode === 'recovery-confirm';
  const isSubmitting = loading || googleLoading || magicLinkLoading || recoveryLoading;
  const authRedirectUrl = `${window.location.origin}/auth`;

  useEffect(() => {
    const recovery = isRecoveryFlow();

    if (recovery) {
      setMode('recovery-confirm');
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !recovery) {
        navigate('/');
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('recovery-confirm');
        setPassword('');
        setConfirmPassword('');
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }

      if (session) {
        navigate('/');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

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
      toast({
        title: 'Error',
        description: getErrorMessage(error),
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
      toast({
        title: 'Error',
        description: getErrorMessage(error),
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
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl,
      });

      if (error) throw error;

      toast({
        title: 'Reset email sent',
        description: 'Open the latest email from BizzyBee to choose a new password.',
      });
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error),
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
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      toast({
        title: 'Password updated',
        description: 'Your password has been changed successfully.',
      });

      navigate('/');
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);

    try {
      const { error } = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });

      if (error) throw error;
    } catch (error: unknown) {
      toast({
        title: 'Error',
        description: getErrorMessage(error) || 'Google sign-in failed',
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
      ? 'Create your BizzyBee account'
      : mode === 'recovery-request'
        ? 'Reset your password'
        : mode === 'recovery-confirm'
          ? 'Choose a new password'
          : 'Welcome back';

  const description =
    mode === 'signup'
      ? 'Launch your AI customer operations workspace in a few quiet clicks.'
      : mode === 'recovery-request'
        ? 'We will email you a secure link so you can set a new password.'
        : mode === 'recovery-confirm'
          ? 'Set a fresh password and step straight back into your inbox.'
          : 'Sign in to BizzyBee and get every customer conversation back under control.';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#140f09] text-[#fff8eb]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(248,205,111,0.14),_transparent_34%),linear-gradient(180deg,_rgba(32,23,15,0.95)_0%,_rgba(14,10,7,1)_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(249, 207, 118, 0.6) 1px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />
      <div className="absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-[#f4be59]/12 blur-3xl" />
      <div className="absolute right-[-5rem] top-20 h-56 w-56 rounded-full bg-[#cf8e1e]/10 blur-3xl" />
      <div className="absolute bottom-[-8rem] left-[-5rem] h-72 w-72 rounded-full bg-[#5e3a12]/30 blur-3xl" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-[460px]">
          <div className="mb-7 flex flex-col items-center gap-4 text-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-[#4c3520] bg-[#1b140d]/85 px-4 py-2 shadow-[0_20px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
              <img
                src={beeLogo}
                alt="BizzyBee bee icon"
                className="h-10 w-10 rounded-full object-cover"
              />
              <div className="text-left">
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#f1c56a]">BizzyBee</p>
                <p className="text-sm text-[#d2c0a4]">AI customer operations</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.34em] text-[#c69539]">
                The calmest way to handle the hive
              </p>
              <h1 className="font-serif text-4xl tracking-tight text-[#fff6e6] sm:text-[2.6rem]">
                {title}
              </h1>
              <p className="mx-auto max-w-md text-[15px] leading-6 text-[#cbbca3]">{description}</p>
            </div>
          </div>

          <Card
            className="w-full overflow-hidden bg-[#17110c]/88 text-[#fff8eb] backdrop-blur-xl"
            style={{
              borderRadius: '28px',
              border: '1px solid rgba(244, 190, 89, 0.14)',
              boxShadow: '0 35px 80px rgba(0, 0, 0, 0.42)',
            }}
          >
            <CardHeader className="space-y-3 pb-5 text-center">
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
                    {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
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
                        placeholder="Your name"
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
                      placeholder={isSignUp ? 'Use at least 8 characters' : 'Enter your password'}
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
                          {isSignUp ? 'Creating account...' : 'Signing in...'}
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
                            Sending magic link...
                          </>
                        ) : (
                          'Send magic link'
                        )}
                      </Button>
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
                        Sending reset email...
                      </>
                    ) : (
                      'Send reset email'
                    )}
                  </Button>

                  <p className="text-center text-sm leading-6 text-[#9d8c72]">
                    Use the newest email from BizzyBee. The link will bring you straight back here.
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
                        Updating password...
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
        </div>
      </div>
    </div>
  );
};

export default Auth;
