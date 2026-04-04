import { useState } from 'react';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAiPhoneConfig } from '@/hooks/useAiPhoneConfig';
import { ServiceEditor } from './ServiceEditor';
import { OpeningHoursGrid } from './OpeningHoursGrid';
import { VoiceSelector } from './VoiceSelector';
import { PhoneNumberDisplay } from './PhoneNumberDisplay';
import type { AiPhoneService, AiPhoneOpeningHours } from '@/lib/types';

const STEPS = [
  'Business Details',
  'Services & Pricing',
  'Opening Hours',
  'Voice Selection',
  'Knowledge Base',
  'Review & Go Live',
] as const;

interface KBEntry {
  title: string;
  content: string;
}

interface FormData {
  business_name: string;
  business_description: string;
  transfer_number: string;
  services: AiPhoneService[];
  opening_hours: AiPhoneOpeningHours;
  voice_id: string;
  voice_name: string;
  kb_entries: KBEntry[];
}

const DEFAULT_HOURS: AiPhoneOpeningHours = {
  Monday:    { open: '09:00', close: '17:00', closed: false },
  Tuesday:   { open: '09:00', close: '17:00', closed: false },
  Wednesday: { open: '09:00', close: '17:00', closed: false },
  Thursday:  { open: '09:00', close: '17:00', closed: false },
  Friday:    { open: '09:00', close: '17:00', closed: false },
  Saturday:  { open: '09:00', close: '17:00', closed: true },
  Sunday:    { open: '09:00', close: '17:00', closed: true },
};

const INITIAL_FORM: FormData = {
  business_name: '',
  business_description: '',
  transfer_number: '',
  services: [{ name: '', description: '', price_from: null, price_to: null, duration_minutes: null }],
  opening_hours: DEFAULT_HOURS,
  voice_id: '21m00Tcm4TlvDq8ikWAM',
  voice_name: 'Rachel',
  kb_entries: [
    { title: 'What areas do you cover?', content: '' },
    { title: 'How much does it cost?', content: '' },
    { title: 'How do I book?', content: '' },
  ],
};

export const OnboardingWizard = () => {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [provisionedNumber, setProvisionedNumber] = useState<string | null>(null);
  const { createConfig, isProvisioning } = useAiPhoneConfig();

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canAdvance = (): boolean => {
    if (step === 0) return form.business_name.trim().length > 0;
    return true;
  };

  const handleProvision = () => {
    createConfig.mutate(
      {
        business_name: form.business_name,
        business_description: form.business_description || null,
        transfer_number: form.transfer_number || null,
        services: form.services.filter((s) => s.name.trim()),
        opening_hours: form.opening_hours,
        voice_id: form.voice_id,
        voice_name: form.voice_name,
        kb_entries: form.kb_entries.filter((e) => e.title.trim() && e.content.trim()),
      },
      {
        onSuccess: (data) => {
          setProvisionedNumber(data?.phone_number ?? null);
        },
      },
    );
  };

  /* ---------- Step renderers ---------- */

  const renderBusinessDetails = () => (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="business_name">
          Business Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id="business_name"
          placeholder="e.g. Sparkle Window Cleaning"
          value={form.business_name}
          onChange={(e) => update('business_name', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="business_description">Business Description</Label>
        <Textarea
          id="business_description"
          placeholder="A short description of your business so the AI knows what you do..."
          rows={3}
          value={form.business_description}
          onChange={(e) => update('business_description', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="transfer_number">Transfer Number</Label>
        <Input
          id="transfer_number"
          type="tel"
          placeholder="e.g. +447700900123"
          value={form.transfer_number}
          onChange={(e) => update('transfer_number', e.target.value)}
        />
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          If the caller asks to speak to a human, the AI will transfer to this number.
        </p>
      </div>
    </div>
  );

  const renderServices = () => (
    <ServiceEditor services={form.services} onChange={(s) => update('services', s)} />
  );

  const renderHours = () => (
    <OpeningHoursGrid hours={form.opening_hours} onChange={(h) => update('opening_hours', h)} />
  );

  const renderVoice = () => (
    <VoiceSelector
      selectedVoiceId={form.voice_id}
      onSelect={(id, name) => {
        update('voice_id', id);
        update('voice_name', name);
      }}
    />
  );

  const renderKnowledgeBase = () => (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        Add answers to common questions your callers ask. The AI will use these to respond accurately.
      </p>
      {form.kb_entries.map((entry, i) => (
        <Card key={i} className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Question / Title</Label>
            <Input
              value={entry.title}
              onChange={(e) => {
                const updated = [...form.kb_entries];
                updated[i] = { ...updated[i], title: e.target.value };
                update('kb_entries', updated);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Answer</Label>
            <Textarea
              rows={2}
              placeholder="Type your answer here..."
              value={entry.content}
              onChange={(e) => {
                const updated = [...form.kb_entries];
                updated[i] = { ...updated[i], content: e.target.value };
                update('kb_entries', updated);
              }}
            />
          </div>
        </Card>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => update('kb_entries', [...form.kb_entries, { title: '', content: '' }])}
      >
        + Add Entry
      </Button>
    </div>
  );

  const renderReview = () => {
    if (provisionedNumber) {
      return (
        <div className="space-y-6 text-center">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Your AI Phone is Live
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Calls to this number will be answered by your AI receptionist.
            </p>
          </div>
          <div className="flex justify-center">
            <PhoneNumberDisplay phoneNumber={provisionedNumber} isActive />
          </div>
        </div>
      );
    }

    const filledServices = form.services.filter((s) => s.name.trim());
    const filledKB = form.kb_entries.filter((e) => e.title.trim() && e.content.trim());

    return (
      <div className="space-y-5">
        <Card className="p-4 space-y-3">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Business
          </h4>
          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-sm">
            <dt style={{ color: 'var(--text-secondary)' }}>Name</dt>
            <dd style={{ color: 'var(--text-primary)' }}>{form.business_name}</dd>
            {form.business_description && (
              <>
                <dt style={{ color: 'var(--text-secondary)' }}>Description</dt>
                <dd style={{ color: 'var(--text-primary)' }}>{form.business_description}</dd>
              </>
            )}
            {form.transfer_number && (
              <>
                <dt style={{ color: 'var(--text-secondary)' }}>Transfer No.</dt>
                <dd style={{ color: 'var(--text-primary)' }}>{form.transfer_number}</dd>
              </>
            )}
          </dl>
        </Card>

        <Card className="p-4 space-y-3">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Services ({filledServices.length})
          </h4>
          {filledServices.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No services added</p>
          ) : (
            <ul className="space-y-1 text-sm" style={{ color: 'var(--text-primary)' }}>
              {filledServices.map((s, i) => (
                <li key={i}>
                  {s.name}
                  {s.price_from != null && (
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {' '}&mdash; from &pound;{s.price_from}
                      {s.price_to != null && <> to &pound;{s.price_to}</>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Voice</h4>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{form.voice_name}</p>
        </Card>

        <Card className="p-4 space-y-3">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Knowledge Base ({filledKB.length} entries)
          </h4>
          {filledKB.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No entries added</p>
          ) : (
            <ul className="space-y-1 text-sm" style={{ color: 'var(--text-primary)' }}>
              {filledKB.map((e, i) => (
                <li key={i}>{e.title}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  };

  const STEP_RENDERERS = [
    renderBusinessDetails,
    renderServices,
    renderHours,
    renderVoice,
    renderKnowledgeBase,
    renderReview,
  ];

  /* ---------- Layout ---------- */

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Progress stepper */}
      <nav className="flex items-center justify-between">
        {STEPS.map((label, i) => {
          const isCompleted = i < step;
          const isCurrent = i === step;

          return (
            <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  isCompleted && 'bg-amber-600 text-white',
                  isCurrent && 'border-2 border-amber-600 text-amber-600',
                  !isCompleted && !isCurrent && 'border border-gray-300 text-gray-400',
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  'hidden text-[10px] font-medium sm:block',
                  isCurrent ? 'text-amber-600' : '',
                )}
                style={!isCurrent ? { color: 'var(--text-secondary)' } : undefined}
              >
                {label}
              </span>
            </div>
          );
        })}
      </nav>

      {/* Step heading */}
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {STEPS[step]}
        </h2>
        <div className="mt-1 h-px w-full" style={{ background: 'var(--separator)' }} />
      </div>

      {/* Step content */}
      <div className="min-h-[260px]">{STEP_RENDERERS[step]()}</div>

      {/* Navigation */}
      {!provisionedNumber && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
          >
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              Next
            </Button>
          ) : (
            <Button
              onClick={handleProvision}
              disabled={isProvisioning || !canAdvance()}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {isProvisioning ? 'Provisioning...' : 'Provision My AI Phone'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
