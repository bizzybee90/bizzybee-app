import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { AiPhoneService } from '@/lib/types';

interface ServiceEditorProps {
  services: AiPhoneService[];
  onChange: (services: AiPhoneService[]) => void;
}

const emptyService = (): AiPhoneService => ({
  name: '',
  description: '',
  price_from: null,
  price_to: null,
  duration_minutes: null,
});

export const ServiceEditor = ({ services, onChange }: ServiceEditorProps) => {
  const updateService = (
    index: number,
    field: keyof AiPhoneService,
    value: string | number | null,
  ) => {
    const updated = services.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    onChange(updated);
  };

  const addService = () => {
    onChange([...services, emptyService()]);
  };

  const removeService = (index: number) => {
    onChange(services.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {/* Column headers — hidden on mobile */}
      <div className="hidden md:grid md:grid-cols-[1fr_1fr_100px_100px_100px_40px] gap-2 px-1">
        <Label className="text-xs text-muted-foreground">Service Name</Label>
        <Label className="text-xs text-muted-foreground">Description</Label>
        <Label className="text-xs text-muted-foreground">Price From</Label>
        <Label className="text-xs text-muted-foreground">Price To</Label>
        <Label className="text-xs text-muted-foreground">Duration (min)</Label>
        <span />
      </div>

      {services.map((service, index) => (
        <div
          key={index}
          className="grid grid-cols-1 md:grid-cols-[1fr_1fr_100px_100px_100px_40px] gap-2 rounded-lg border p-3 md:border-0 md:p-0"
        >
          <div>
            <Label className="text-xs md:hidden text-muted-foreground">Service Name</Label>
            <Input
              placeholder="e.g. Window Cleaning"
              value={service.name}
              onChange={(e) => updateService(index, 'name', e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs md:hidden text-muted-foreground">Description</Label>
            <Input
              placeholder="Brief description"
              value={service.description}
              onChange={(e) => updateService(index, 'description', e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs md:hidden text-muted-foreground">Price From</Label>
            <Input
              type="number"
              placeholder="0"
              min={0}
              value={service.price_from ?? ''}
              onChange={(e) =>
                updateService(index, 'price_from', e.target.value ? Number(e.target.value) : null)
              }
            />
          </div>
          <div>
            <Label className="text-xs md:hidden text-muted-foreground">Price To</Label>
            <Input
              type="number"
              placeholder="0"
              min={0}
              value={service.price_to ?? ''}
              onChange={(e) =>
                updateService(index, 'price_to', e.target.value ? Number(e.target.value) : null)
              }
            />
          </div>
          <div>
            <Label className="text-xs md:hidden text-muted-foreground">Duration (min)</Label>
            <Input
              type="number"
              placeholder="60"
              min={0}
              value={service.duration_minutes ?? ''}
              onChange={(e) =>
                updateService(
                  index,
                  'duration_minutes',
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            />
          </div>
          <div className="flex items-end justify-end md:items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeService(index)}
              className="text-red-500 hover:text-red-700 hover:bg-red-50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={addService} className="gap-1.5">
        <Plus className="h-4 w-4" />
        Add Service
      </Button>
    </div>
  );
};
