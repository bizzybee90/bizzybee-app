import { useEffect, useRef, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { isPreviewModeEnabled } from '@/lib/previewMode';
import { playBrowserVoicePreview } from '@/lib/browserVoicePreview';

const VOICES = [
  {
    id: 'cgSgspJ2msm6clMCkdW9',
    name: 'Jessica',
    description: 'Warm, professional British female',
    gender: 'Female',
  },
  {
    id: 'iP95p4xoKVk53GoZ742B',
    name: 'Chris',
    description: 'Confident, friendly British male',
    gender: 'Male',
  },
  {
    id: 'XB0fDUnXU5powFXDhCwa',
    name: 'Charlotte',
    description: 'Clear, elegant British female',
    gender: 'Female',
  },
  {
    id: 'bIHbv24MWmeRgasZH58o',
    name: 'Will',
    description: 'Warm, conversational British male',
    gender: 'Male',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah',
    description: 'Natural, approachable female',
    gender: 'Female',
  },
  {
    id: 'onwK4e9ZLuTAKqWW03F9',
    name: 'Daniel',
    description: 'Authoritative, professional British male',
    gender: 'Male',
  },
] as const;

interface VoiceSelectorProps {
  selectedVoiceId?: string;
  onSelect?: (voiceId: string, voiceName: string) => void;
  voiceId?: string;
  onChange?: (voiceId: string, voiceName: string) => void;
  previewText?: string;
  helperText?: string;
}

export const VoiceSelector = ({
  selectedVoiceId,
  onSelect,
  voiceId,
  onChange,
  previewText,
  helperText,
}: VoiceSelectorProps) => {
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '') ?? '';
  const activeVoiceId = selectedVoiceId ?? voiceId ?? '';
  const isPreviewMode = isPreviewModeEnabled();

  const handleSelectVoice = (nextVoiceId: string, nextVoiceName: string) => {
    onSelect?.(nextVoiceId, nextVoiceName);
    onChange?.(nextVoiceId, nextVoiceName);
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stopPlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const playWithBrowserVoice = async (voice: (typeof VOICES)[number]) => {
    await playBrowserVoicePreview({
      preferredVoiceName: voice.name,
      preferredGender: voice.gender,
      text:
        previewText?.trim() ||
        'Hi, thanks for calling. BizzyBee can help with your enquiry and guide you to the right next step.',
    });
  };

  const handlePlay = async (e: React.MouseEvent, voice: (typeof VOICES)[number]) => {
    e.stopPropagation();
    setPreviewError(null);
    setPreviewingVoiceId(voice.id);

    try {
      stopPlayback();

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const shouldUseBrowserPreview = isPreviewMode || !session?.access_token || !supabaseUrl;
      if (shouldUseBrowserPreview) {
        await playWithBrowserVoice(voice);
        return;
      }

      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-voice-preview`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            voice_id: voice.id,
            text: previewText?.trim() || undefined,
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error ?? `Preview failed (${response.status})`);
        }

        const audioBlob = await response.blob();
        const objectUrl = URL.createObjectURL(audioBlob);
        previewUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        audio.addEventListener('ended', stopPlayback, { once: true });
        audio.addEventListener('error', stopPlayback, { once: true });
        await audio.play();
      } catch {
        await playWithBrowserVoice(voice);
      }
    } catch (error) {
      stopPlayback();
      setPreviewError(error instanceof Error ? error.message : 'Voice preview failed.');
    } finally {
      setPreviewingVoiceId(null);
    }
  };

  return (
    <div className="space-y-3">
      {previewError ? <p className="text-sm text-red-600">{previewError}</p> : null}
      {helperText ? <p className="text-sm text-muted-foreground">{helperText}</p> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {VOICES.map((voice) => {
          const isSelected = activeVoiceId === voice.id;

          return (
            <div
              key={voice.id}
              role="button"
              tabIndex={0}
              aria-label={`Select ${voice.name} voice`}
              onClick={() => handleSelectVoice(voice.id, voice.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelectVoice(voice.id, voice.name);
                }
              }}
              className={cn(
                'relative flex cursor-pointer flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2',
                isSelected
                  ? 'border-2 border-amber-600 bg-amber-50 shadow-sm shadow-amber-100'
                  : 'border bg-background hover:border-amber-200',
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-base font-semibold text-foreground">{voice.name}</span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    voice.gender === 'Female'
                      ? 'bg-purple-50 text-purple-700'
                      : 'bg-blue-50 text-blue-700',
                  )}
                >
                  {voice.gender}
                </span>
              </div>

              <p className="text-sm text-muted-foreground">{voice.description}</p>

              <button
                type="button"
                onClick={(e) => handlePlay(e, voice)}
                className={cn(
                  'mt-2 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-colors',
                  previewingVoiceId === voice.id
                    ? 'bg-amber-700 text-white hover:bg-amber-800'
                    : isSelected
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
                aria-label={`Preview ${voice.name}`}
                disabled={previewingVoiceId === voice.id}
              >
                {previewingVoiceId === voice.id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Playing…
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3.5 w-3.5" />
                    Hear sample
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
