import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCheck, Mail, FileText, Receipt, Archive } from 'lucide-react';

interface ReviewConversation {
  id: string;
  decision_bucket: string;
  email_classification?: string;
}

interface SmartBatchActionsProps {
  reviewQueue: ReviewConversation[];
  reviewedIds: Set<string>;
  onBatchApprove: (ids: string[], bucket?: string) => void;
  isPending: boolean;
}

const classificationConfig: Record<
  string,
  { icon: React.ReactNode; label: string; minCount: number }
> = {
  receipt_confirmation: {
    icon: <Receipt className="h-3 w-3" />,
    label: 'Receipt confirmations',
    minCount: 2,
  },
  newsletter: {
    icon: <Mail className="h-3 w-3" />,
    label: 'Newsletters',
    minCount: 2,
  },
  automated_notification: {
    icon: <Archive className="h-3 w-3" />,
    label: 'Auto notifications',
    minCount: 2,
  },
  supplier_invoice: {
    icon: <FileText className="h-3 w-3" />,
    label: 'Invoices',
    minCount: 3,
  },
};

const bucketConfig: Record<string, { label: string; minCount: number }> = {
  wait: { label: 'FYI items', minCount: 3 },
  auto_handled: { label: 'Done items', minCount: 3 },
};

export function SmartBatchActions({
  reviewQueue,
  reviewedIds,
  onBatchApprove,
  isPending,
}: SmartBatchActionsProps) {
  // Group unreviewed items by classification and bucket
  const groups = useMemo(() => {
    const unreviewed = reviewQueue.filter((c) => !reviewedIds.has(c.id));

    const byClassification: Record<string, ReviewConversation[]> = {};
    const byBucket: Record<string, ReviewConversation[]> = {};

    unreviewed.forEach((conv) => {
      // Group by email classification
      const classification = conv.email_classification;
      if (classification && classificationConfig[classification]) {
        if (!byClassification[classification]) {
          byClassification[classification] = [];
        }
        byClassification[classification].push(conv);
      }

      // Group by decision bucket
      if (conv.decision_bucket && bucketConfig[conv.decision_bucket]) {
        if (!byBucket[conv.decision_bucket]) {
          byBucket[conv.decision_bucket] = [];
        }
        byBucket[conv.decision_bucket].push(conv);
      }
    });

    return { byClassification, byBucket };
  }, [reviewQueue, reviewedIds]);

  // Filter to groups that meet minimum count threshold
  const eligibleClassificationGroups = Object.entries(groups.byClassification).filter(
    ([key, items]) => items.length >= (classificationConfig[key]?.minCount || 2),
  );

  const eligibleBucketGroups = Object.entries(groups.byBucket).filter(
    ([key, items]) => items.length >= (bucketConfig[key]?.minCount || 2),
  );

  if (eligibleClassificationGroups.length === 0 && eligibleBucketGroups.length === 0) {
    return null;
  }

  return (
    <div className="px-3 py-2 border-b bg-purple-50/50 dark:bg-purple-900/10 space-y-2">
      <span className="text-xs font-medium text-purple-700 dark:text-purple-300 flex items-center gap-1">
        <CheckCheck className="h-3 w-3" />
        Quick approve similar items
      </span>

      <div className="flex flex-wrap gap-1.5">
        {eligibleClassificationGroups.map(([classification, items]) => {
          const config = classificationConfig[classification];
          return (
            <Button
              key={classification}
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 bg-background hover:bg-green-50 hover:border-green-300 hover:text-green-700"
              onClick={() => onBatchApprove(items.map((i) => i.id))}
              disabled={isPending}
            >
              {config.icon}
              {config.label}
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {items.length}
              </Badge>
            </Button>
          );
        })}

        {eligibleBucketGroups.map(([bucket, items]) => {
          const config = bucketConfig[bucket];
          return (
            <Button
              key={bucket}
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 bg-background hover:bg-green-50 hover:border-green-300 hover:text-green-700"
              onClick={() => onBatchApprove(items.map((i) => i.id))}
              disabled={isPending}
            >
              {config.label}
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {items.length}
              </Badge>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
