import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface LearningPhase {
  id: 'pairing' | 'voice_dna' | 'embeddings' | 'complete';
  label: string;
  description: string;
}

const LEARNING_PHASES: LearningPhase[] = [
  {
    id: 'pairing',
    label: 'Matching conversations',
    description: 'Finding your replies to customer emails',
  },
  {
    id: 'voice_dna',
    label: 'Extracting voice profile',
    description: 'Learning your greeting style, tone, and patterns',
  },
  {
    id: 'embeddings',
    label: 'Building memory bank',
    description: 'Creating searchable examples for future responses',
  },
  { id: 'complete', label: 'Complete', description: 'Your digital clone is ready!' },
];

// Processing rates based on benchmarks
const RATES = {
  pairing: 500, // emails per second (simple DB operations)
  voice_dna: 100, // emails per second (Claude analysis of 100 pairs)
  embeddings: 10, // examples per second (OpenAI embeddings)
};

interface LearningProgress {
  currentPhase: LearningPhase;
  phaseIndex: number;
  totalPhases: number;
  estimatedSecondsRemaining: number | null;
  emailsImported: number;
  pairsAnalyzed: number;
  voiceProfileComplete: boolean;
  playbookComplete: boolean;
  isComplete: boolean;
  lastUpdatedAt: string | null;
}

interface EmailImportProgressRow {
  emails_received?: number | null;
  pairs_analyzed?: number | null;
  voice_profile_complete?: boolean | null;
  updated_at?: string | null;
  phase1_status?: string | null;
  phase2_status?: string | null;
  current_phase?: string | null;
}

export function useLearningProgress(workspaceId: string | null) {
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  const [hasNotified, setHasNotified] = useState(false);

  const calculateProgress = useCallback((data: EmailImportProgressRow): LearningProgress => {
    const emailCount = data.emails_received || 0;
    const pairsAnalyzed = data.pairs_analyzed || 0;
    const voiceComplete = data.voice_profile_complete || false;
    const lastUpdatedAt = (data.updated_at ?? null) as string | null;
    const phase1Status = data.phase1_status || 'pending';
    const phase2Status = data.phase2_status || 'pending';

    // Determine current phase based on backend phase statuses (more reliable than booleans)
    let phaseIndex = 0;
    let estimatedSeconds: number | null = null;

    const phase1Done = phase1Status === 'complete';
    const phase1Running = phase1Status === 'running';
    const phase2Done = phase2Status === 'complete';
    const phase2Running = phase2Status === 'running';

    if (phase1Done && phase2Done && voiceComplete) {
      phaseIndex = 3; // complete
      estimatedSeconds = 0;
    } else if (
      phase1Done &&
      (phase2Running || phase2Status === 'pending' || phase2Status === 'error')
    ) {
      // Memory bank phase
      phaseIndex = 2;
      // We intentionally avoid showing a fake ETA here; it's highly variable.
      estimatedSeconds = null;
    } else if (phase1Running || (emailCount >= 10 && data.current_phase === 'learning')) {
      // Voice DNA extraction / pairing-to-profile phase
      phaseIndex = 1;
      estimatedSeconds = 60;
    } else {
      // Still importing/pairing
      phaseIndex = 0;
      estimatedSeconds = null;
    }

    return {
      currentPhase: LEARNING_PHASES[phaseIndex],
      phaseIndex,
      totalPhases: LEARNING_PHASES.length - 1, // Exclude 'complete' from count
      estimatedSecondsRemaining: estimatedSeconds,
      emailsImported: emailCount,
      pairsAnalyzed,
      voiceProfileComplete: voiceComplete,
      playbookComplete: phase2Done,
      isComplete: phaseIndex === 3,
      lastUpdatedAt,
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;

    // Initial fetch
    const fetchProgress = async () => {
      const { data } = await supabase
        .from('email_import_progress')
        .select('*')
        .eq('workspace_id', workspaceId)
        .single();

      if (data) {
        setProgress(calculateProgress(data));
      }
    };

    fetchProgress();

    // Poll as a fallback in case realtime doesn't deliver updates.
    // This also lets the UI detect a stale backend (no updates for a while).
    const pollId = window.setInterval(fetchProgress, 10_000);

    // Subscribe to changes
    const channel = supabase
      .channel(`learning-progress-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'email_import_progress',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const newProgress = calculateProgress(payload.new);
          setProgress(newProgress);

          // Toast on completion
          if (newProgress.isComplete && !hasNotified) {
            setHasNotified(true);
            toast.success('Voice profile ready!', {
              description: `Analyzed ${newProgress.emailsImported.toLocaleString()} emails. BizzyBee now knows your communication style.`,
              duration: 8000,
            });
          }
        },
      )
      .subscribe();

    return () => {
      window.clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, calculateProgress, hasNotified]);

  return progress;
}

export function formatTimeRemaining(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '';
  if (seconds < 60) return `~${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes} minute${minutes > 1 ? 's' : ''}`;
}
