import { cn } from '@/lib/utils';

interface TranscriptEntry {
  role: 'agent' | 'user';
  content: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

interface CallTranscriptProps {
  transcriptObject: TranscriptEntry[] | null;
  transcriptText?: string | null;
}

export const CallTranscript = ({ transcriptObject, transcriptText }: CallTranscriptProps) => {
  // Structured transcript with chat bubbles
  if (transcriptObject && transcriptObject.length > 0) {
    return (
      <div className="space-y-3 py-2">
        {transcriptObject.map((entry, idx) => {
          const isAgent = entry.role === 'agent';
          return (
            <div
              key={idx}
              className={cn('flex flex-col', isAgent ? 'items-end' : 'items-start')}
            >
              <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-1 px-1">
                {isAgent ? 'AI Agent' : 'Caller'}
              </span>
              <div
                className={cn(
                  'rounded-xl p-3 max-w-[80%] text-sm leading-relaxed',
                  isAgent
                    ? 'bg-teal-50 text-teal-900 border border-teal-100'
                    : 'bg-gray-50 text-gray-900 border border-gray-100'
                )}
              >
                {entry.content}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Plain text fallback
  if (transcriptText) {
    return (
      <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
        <p className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-2">
          Transcript
        </p>
        <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-sans leading-relaxed">
          {transcriptText}
        </pre>
      </div>
    );
  }

  // No transcript available
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-center">
      <p className="text-sm text-[var(--text-secondary)]">
        No transcript available for this call.
      </p>
    </div>
  );
};
