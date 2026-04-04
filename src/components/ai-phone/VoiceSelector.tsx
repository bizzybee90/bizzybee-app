import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

const VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Warm, professional British female', gender: 'Female' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Deep, authoritative British male', gender: 'Male' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', description: 'Professional, clear British female', gender: 'Female' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', description: 'Young, energetic and friendly', gender: 'Female' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Deep, warm American male', gender: 'Male' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Confident, conversational male', gender: 'Male' },
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
