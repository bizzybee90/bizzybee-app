import { Copy, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PhoneNumberDisplayProps {
  phoneNumber: string | null;
  isActive?: boolean;
}

export const PhoneNumberDisplay = ({ phoneNumber, isActive }: PhoneNumberDisplayProps) => {
  const handleCopy = async () => {
    if (!phoneNumber) return;
    try {
      await navigator.clipboard.writeText(phoneNumber);
      toast.success('Phone number copied to clipboard');
    } catch {
      toast.error('Failed to copy phone number');
    }
  };

  if (!phoneNumber) {
    return (
      <p className="text-sm text-muted-foreground">No BizzyBee-managed number provisioned yet</p>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span className="font-mono text-2xl font-semibold text-foreground">{phoneNumber}</span>

      <Button variant="outline" size="icon" onClick={handleCopy} className="shrink-0">
        <Copy className="h-4 w-4" />
      </Button>

      {isActive !== undefined && (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
            isActive
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200',
          )}
        >
          {isActive ? (
            <>
              <CheckCircle className="h-3 w-3" />
              Active
            </>
          ) : (
            <>
              <XCircle className="h-3 w-3" />
              Inactive
            </>
          )}
        </span>
      )}
    </div>
  );
};
