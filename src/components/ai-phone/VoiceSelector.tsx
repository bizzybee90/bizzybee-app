import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

const VOICES = [
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', description: 'Warm, professional British female', gender: 'Female' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', description: 'Confident, friendly British male', gender: 'Male' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', description: 'Clear, elegant British female', gender: 'Female' },
  { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', description: 'Warm, conversational British male', gender: 'Male' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Natural, approachable female', gender: 'Female' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Authoritative, professional British male', gender: 'Male' },
] as const;

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onSelect: (voiceId: string, voiceName: string) => void;
}

export const VoiceSelector = ({ selectedVoiceId, onSelect }: VoiceSelectorProps) => {
  const handlePlay = (e: React.MouseEvent, _voiceId: string) => {
    e.stopPropagation();
    // Placeholder: wire up audio preview later
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {VOICES.map((voice) => {
        const isSelected = selectedVoiceId === voice.id;

        return (
          <button
            key={voice.id}
            type="button"
            onClick={() => onSelect(voice.id, voice.name)}
            className={cn(
              'relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all hover:shadow-md',
              isSelected
                ? 'border-2 border-amber-600 bg-amber-50'
                : 'border hover:border-amber-200'
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {voice.name}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  voice.gender === 'Female'
                    ? 'bg-purple-50 text-purple-700'
                    : 'bg-blue-50 text-blue-700'
                )}
              >
                {voice.gender}
              </span>
            </div>

            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {voice.description}
            </p>

            <button
              type="button"
              onClick={(e) => handlePlay(e, voice.id)}
              className={cn(
                'mt-1 flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                isSelected
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          </button>
        );
      })}
    </div>
  );
};
