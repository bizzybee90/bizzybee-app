import { useToast } from '@/hooks/use-toast';

export function useReviewFeedback() {
  const { toast } = useToast();

  const celebrateConfirmation = () => {
    toast({
      title: "Got it!",
      description: "BizzyBee will remember this.",
      duration: 2000,
    });
  };

  const celebratePatternLearned = (domain: string) => {
    toast({
      title: "Pattern learned",
      description: `BizzyBee will handle emails from @${domain} automatically from now on.`,
      duration: 4000,
    });
  };

  const celebrateQueueComplete = (count: number) => {
    toast({
      title: "All caught up",
      description: `You reviewed ${count} emails. BizzyBee is getting smarter!`,
      duration: 5000,
    });
  };

  const celebrateMilestone = (rulesLearned: number) => {
    toast({
      title: "Milestone reached",
      description: `BizzyBee has learned ${rulesLearned} patterns from your input.`,
      duration: 4000,
    });
  };

  return {
    celebrateConfirmation,
    celebratePatternLearned,
    celebrateQueueComplete,
    celebrateMilestone,
  };
}
