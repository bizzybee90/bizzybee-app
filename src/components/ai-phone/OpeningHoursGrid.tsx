import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AiPhoneOpeningHours } from '@/lib/types';

interface OpeningHoursGridProps {
  hours: AiPhoneOpeningHours;
  onChange: (hours: AiPhoneOpeningHours) => void;
}

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const TIME_OPTIONS: string[] = [];
for (let h = 6; h <= 22; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`);
  if (h < 22) {
    TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`);
  }
}

export const OpeningHoursGrid = ({ hours, onChange }: OpeningHoursGridProps) => {
  const updateDay = (day: string, field: 'open' | 'close' | 'closed', value: string | boolean) => {
    const current = hours[day] ?? { open: '09:00', close: '17:00', closed: false };
    onChange({
      ...hours,
      [day]: { ...current, [field]: value },
    });
  };

  return (
    <div className="space-y-3">
      {DAYS.map((day) => {
        const entry = hours[day] ?? { open: '09:00', close: '17:00', closed: false };
        const isClosed = entry.closed ?? false;

        return (
          <div
            key={day}
            className="grid grid-cols-[100px_1fr_auto_1fr_auto] items-center gap-3 md:grid-cols-[120px_140px_auto_140px_auto]"
          >
            <Label className="text-sm font-medium text-foreground">{day}</Label>

            <Select
              value={isClosed ? '' : entry.open}
              onValueChange={(v) => updateDay(day, 'open', v)}
              disabled={isClosed}
            >
              <SelectTrigger className={isClosed ? 'opacity-40' : ''}>
                <SelectValue placeholder="Open" />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-xs text-muted-foreground">to</span>

            <Select
              value={isClosed ? '' : entry.close}
              onValueChange={(v) => updateDay(day, 'close', v)}
              disabled={isClosed}
            >
              <SelectTrigger className={isClosed ? 'opacity-40' : ''}>
                <SelectValue placeholder="Close" />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Switch
                checked={isClosed}
                onCheckedChange={(checked) => updateDay(day, 'closed', checked)}
              />
              <Label className="text-xs whitespace-nowrap text-muted-foreground">Closed</Label>
            </div>
          </div>
        );
      })}
    </div>
  );
};
