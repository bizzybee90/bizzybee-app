import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Mail,
  AlertTriangle,
  ThumbsUp,
  UserPlus,
  MessageCircle,
  Receipt,
  Zap,
  Users,
  Bot,
  Ban,
  Megaphone,
  Briefcase,
  Settings2,
  Info,
  LucideIcon,
  Pencil,
} from 'lucide-react';

interface CategoryConfig {
  icon: LucideIcon;
  label: string;
  className: string;
}

// Per-category tinted pill styles (iOS system colour palette)
const PILL_ENQUIRY = 'pill pill-enquiry border-0';
const PILL_QUOTE = 'pill pill-quote border-0';
const PILL_BOOKING = 'pill pill-booking border-0';
const PILL_COMPLAINT = 'pill pill-complaint border-0';
const PILL_URGENT = 'pill pill-urgent border-0';
const PILL_NEUTRAL = 'pill pill-neutral border-0';

const categoryConfigs: Record<string, CategoryConfig> = {
  // New 9-category taxonomy (primary keys)
  quote: { icon: Receipt, label: 'Quote', className: PILL_QUOTE },
  booking: { icon: MessageCircle, label: 'Booking', className: PILL_BOOKING },
  complaint: { icon: AlertTriangle, label: 'Complaint', className: PILL_COMPLAINT },
  follow_up: { icon: MessageCircle, label: 'Follow-up', className: PILL_ENQUIRY },
  inquiry: { icon: Mail, label: 'Enquiry', className: PILL_ENQUIRY },
  notification: { icon: Bot, label: 'Auto', className: PILL_NEUTRAL },
  newsletter: { icon: Megaphone, label: 'Marketing', className: PILL_NEUTRAL },
  spam: { icon: Ban, label: 'Spam', className: PILL_NEUTRAL },
  personal: { icon: Users, label: 'Personal', className: PILL_NEUTRAL },

  // Legacy category keys (backwards compatibility)
  customer_inquiry: { icon: Mail, label: 'Enquiry', className: PILL_ENQUIRY },
  customer_complaint: { icon: AlertTriangle, label: 'Complaint', className: PILL_COMPLAINT },
  customer_feedback: { icon: ThumbsUp, label: 'Feedback', className: PILL_QUOTE },
  complaint_dispute: { icon: AlertTriangle, label: 'Complaint', className: PILL_COMPLAINT },

  // Specific request types
  booking_request: { icon: MessageCircle, label: 'Booking', className: PILL_BOOKING },
  quote_request: { icon: Receipt, label: 'Quote', className: PILL_QUOTE },
  cancellation_request: { icon: AlertTriangle, label: 'Cancel', className: PILL_COMPLAINT },
  reschedule_request: { icon: MessageCircle, label: 'Reschedule', className: PILL_BOOKING },

  // Lead categories
  lead_new: { icon: UserPlus, label: 'New Lead', className: PILL_QUOTE },
  lead_followup: { icon: MessageCircle, label: 'Follow-up', className: PILL_ENQUIRY },

  // Financial categories
  supplier_invoice: { icon: Receipt, label: 'Invoice', className: PILL_NEUTRAL },
  supplier_urgent: { icon: Zap, label: 'Supplier Urgent', className: PILL_URGENT },
  receipt_confirmation: { icon: Receipt, label: 'Receipt', className: PILL_NEUTRAL },
  payment_confirmation: { icon: Receipt, label: 'Payment', className: PILL_NEUTRAL },

  // Partner/Business
  partner_request: { icon: Users, label: 'Partner', className: PILL_NEUTRAL },

  // Automated/System
  automated_notification: { icon: Bot, label: 'Auto', className: PILL_NEUTRAL },
  internal_system: { icon: Settings2, label: 'System', className: PILL_NEUTRAL },
  informational_only: { icon: Info, label: 'Info', className: PILL_NEUTRAL },

  // Noise categories
  spam_phishing: { icon: Ban, label: 'Spam', className: PILL_NEUTRAL },
  marketing_newsletter: { icon: Megaphone, label: 'Marketing', className: PILL_NEUTRAL },
  recruitment_hr: { icon: Briefcase, label: 'Recruitment', className: PILL_NEUTRAL },
  misdirected: { icon: AlertTriangle, label: 'Misdirected', className: PILL_COMPLAINT },
};

// Keyword-based fallback matching for non-standard classifications
const getConfigByKeyword = (classification: string): CategoryConfig | null => {
  const lower = classification.toLowerCase();
  
  // Payment/Receipt related
  if (lower.includes('payment') && (lower.includes('confirm') || lower.includes('received'))) {
    return { icon: Receipt, label: 'Payment', className: PILL_NEUTRAL };
  }
  if (lower.includes('receipt') || lower.includes('stripe') || lower.includes('paypal')) {
    return { icon: Receipt, label: 'Receipt', className: PILL_NEUTRAL };
  }
  
  // Invoice related
  if (lower.includes('invoice') || lower.includes('billing') || lower.includes('bill')) {
    return { icon: Receipt, label: 'Invoice', className: PILL_NEUTRAL };
  }
  
  // Marketing
  if (lower.includes('marketing') || lower.includes('newsletter') || lower.includes('promo')) {
    return { icon: Megaphone, label: 'Marketing', className: PILL_NEUTRAL };
  }
  
  // Customer requests - be specific
  if (lower.includes('booking') || lower.includes('appointment') || lower.includes('schedule')) {
    return { icon: MessageCircle, label: 'Booking', className: PILL_BOOKING };
  }
  if (lower.includes('quote') || lower.includes('estimate') || lower.includes('pricing')) {
    return { icon: Receipt, label: 'Quote', className: PILL_QUOTE };
  }
  if (lower.includes('cancel')) {
    return { icon: AlertTriangle, label: 'Cancel', className: PILL_COMPLAINT };
  }
  if (lower.includes('reschedule') || lower.includes('rebook') || lower.includes('change date')) {
    return { icon: MessageCircle, label: 'Reschedule', className: PILL_BOOKING };
  }
  
  // General enquiry
  if (lower.includes('enquiry') || lower.includes('inquiry') || lower.includes('question')) {
    return { icon: Mail, label: 'Enquiry', className: PILL_ENQUIRY };
  }
  
  // Complaints/Issues
  if (lower.includes('complaint') || lower.includes('issue') || lower.includes('problem') || lower.includes('unhappy')) {
    return { icon: AlertTriangle, label: 'Complaint', className: PILL_COMPLAINT };
  }
  
  // Feedback
  if (lower.includes('feedback') || lower.includes('review') || lower.includes('thank')) {
    return { icon: ThumbsUp, label: 'Feedback', className: PILL_QUOTE };
  }
  
  return null;
};

// British English spelling normalisation
const toBritishLabel = (label: string): string => {
  const map: Record<string, string> = {
    'Inquiry': 'Enquiry',
    'inquiry': 'enquiry',
  };
  return map[label] || label;
};

export const getCategoryConfig = (classification: string | null | undefined): CategoryConfig | null => {
  if (!classification) return null;
  const config = categoryConfigs[classification] || getConfigByKeyword(classification);
  if (!config) return null;
  return { ...config, label: toBritishLabel(config.label) };
};

interface CategoryLabelProps {
  classification: string | null | undefined;
  size?: 'xs' | 'sm' | 'md';
  showIcon?: boolean;
  className?: string;
  editable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export const CategoryLabel = ({ 
  classification, 
  size = 'sm', 
  showIcon = true,
  className,
  editable = false,
  onClick
}: CategoryLabelProps) => {
  const config = getCategoryConfig(classification);
  if (!config) return null;

  const Icon = config.icon;
  
  const sizeClasses = {
    xs: 'text-[10px] px-1.5 py-0.5',
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  };

  const iconSizes = {
    xs: 'h-2.5 w-2.5',
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
  };

  const handleClick = (e: React.MouseEvent) => {
    if (editable && onClick) {
      e.stopPropagation();
      onClick(e);
    }
  };

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "rounded-full border flex items-center gap-1 font-medium",
        sizeClasses[size],
        config.className,
        editable && "cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all group",
        className
      )}
      onClick={handleClick}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {config.label}
      {editable && (
        <Pencil className={cn(
          iconSizes[size], 
          "ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        )} />
      )}
    </Badge>
  );
};
