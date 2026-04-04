import { useState, useEffect } from 'react';
import { useAiPhoneConfig } from '@/hooks/useAiPhoneConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { PhoneNumberDisplay } from './PhoneNumberDisplay';
import { ServiceEditor } from './ServiceEditor';
import { OpeningHoursGrid } from './OpeningHoursGrid';
import { VoiceSelector } from './VoiceSelector';
import { Loader2 } from 'lucide-react';
import type { AiPhoneService, AiPhoneOpeningHours } from '@/lib/types';

export const PhoneSettingsForm = () => {
  const { config, isLoading, updateConfig, toggleActive } = useAiPhoneConfig();

  // --- Business Details local state ---
  const [businessName, setBusinessName] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [transferNumber, setTransferNumber] = useState('');

  // --- Services local state ---
  const [services, setServices] = useState<AiPhoneService[]>([]);

  // --- Opening Hours local state ---
  const [openingHours, setOpeningHours] = useState<AiPhoneOpeningHours>({});

  // --- Voice local state ---
  const [voiceId, setVoiceId] = useState('');
  const [voiceName, setVoiceName] = useState('');

  // --- Advanced local state ---
  const [maxCallDuration, setMaxCallDuration] = useState(300);
  const [dataRetentionDays, setDataRetentionDays] = useState(90);
  const [customInstructions, setCustomInstructions] = useState('');
  const [greetingMessage, setGreetingMessage] = useState('');

  // Sync local state when config loads or changes
  useEffect(() => {
    if (!config) return;
    setBusinessName(config.business_name ?? '');
    setBusinessDescription(config.business_description ?? '');
    setTransferNumber(config.transfer_number ?? '');
    setServices(config.services ?? []);
    setOpeningHours(config.opening_hours ?? {});
    setVoiceId(config.voice_id ?? '');
    setVoiceName(config.voice_name ?? '');
    setMaxCallDuration(config.max_call_duration_seconds ?? 300);
    setDataRetentionDays(config.data_retention_days ?? 90);
    setCustomInstructions(config.custom_instructions ?? '');
    setGreetingMessage(config.greeting_message ?? '');
  }, [config]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!config) return null;

  const handleSaveBusinessDetails = () => {
    updateConfig.mutate({
      business_name: businessName,
      business_description: businessDescription,
      transfer_number: transferNumber || null,
    });
  };

  const handleSaveServices = () => {
    updateConfig.mutate({ services });
  };

  const handleSaveOpeningHours = () => {
    updateConfig.mutate({ opening_hours: openingHours });
  };

  const handleSaveVoice = () => {
    updateConfig.mutate({ voice_id: voiceId, voice_name: voiceName });
  };

  const handleSaveAdvanced = () => {
    updateConfig.mutate({
      max_call_duration_seconds: maxCallDuration,
      data_retention_days: dataRetentionDays,
      custom_instructions: customInstructions || null,
      greeting_message: greetingMessage,
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Phone Number Display + Active Toggle */}
      <div className="bg-card p-6 rounded-2xl border border-border/40 shadow-sm">
        <div className="flex items-center justify-between">
          <PhoneNumberDisplay phoneNumber={config.retell_phone_number} />
          <div className="flex items-center gap-3">
            <Label htmlFor="phone-active-toggle" className="text-[13px] text-muted-foreground">
              {config.is_active ? 'Active' : 'Inactive'}
            </Label>
            <Switch
              id="phone-active-toggle"
              checked={config.is_active}
              onCheckedChange={(checked) => toggleActive.mutate(checked)}
              disabled={toggleActive.isPending}
            />
          </div>
        </div>
      </div>

      {/* Accordion Sections */}
      <div className="bg-card rounded-2xl border border-border/40 shadow-sm">
        <Accordion type="single" collapsible className="px-6">
          {/* 1. Business Details */}
          <AccordionItem value="business-details">
            <AccordionTrigger className="text-[15px] font-medium hover:no-underline">
              Business Details
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pb-2">
                <div className="space-y-2">
                  <Label htmlFor="business-name" className="text-[13px]">
                    Business Name
                  </Label>
                  <Input
                    id="business-name"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Smith's Window Cleaning"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="business-description" className="text-[13px]">
                    Business Description
                  </Label>
                  <Textarea
                    id="business-description"
                    value={businessDescription}
                    onChange={(e) => setBusinessDescription(e.target.value)}
                    placeholder="Briefly describe what your business does, your specialities, and service area..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transfer-number" className="text-[13px]">
                    Transfer Number
                  </Label>
                  <Input
                    id="transfer-number"
                    type="tel"
                    value={transferNumber}
                    onChange={(e) => setTransferNumber(e.target.value)}
                    placeholder="e.g. +44 7700 900000"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Calls can be transferred to this number when a customer requests to speak to a
                    human.
                  </p>
                </div>
                <Button
                  onClick={handleSaveBusinessDetails}
                  disabled={updateConfig.isPending}
                  className="mt-2 bg-primary"
                >
                  {updateConfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* 2. Services & Pricing */}
          <AccordionItem value="services">
            <AccordionTrigger className="text-[15px] font-medium hover:no-underline">
              Services &amp; Pricing
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pb-2">
                <ServiceEditor services={services} onChange={setServices} />
                <Button
                  onClick={handleSaveServices}
                  disabled={updateConfig.isPending}
                  className="mt-2 bg-primary"
                >
                  {updateConfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* 3. Opening Hours */}
          <AccordionItem value="opening-hours">
            <AccordionTrigger className="text-[15px] font-medium hover:no-underline">
              Opening Hours
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pb-2">
                <OpeningHoursGrid hours={openingHours} onChange={setOpeningHours} />
                <Button
                  onClick={handleSaveOpeningHours}
                  disabled={updateConfig.isPending}
                  className="mt-2 bg-primary"
                >
                  {updateConfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* 4. Voice */}
          <AccordionItem value="voice">
            <AccordionTrigger className="text-[15px] font-medium hover:no-underline">
              Voice
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pb-2">
                <VoiceSelector
                  voiceId={voiceId}
                  voiceName={voiceName}
                  onChange={(id, name) => {
                    setVoiceId(id);
                    setVoiceName(name);
                  }}
                />
                <Button
                  onClick={handleSaveVoice}
                  disabled={updateConfig.isPending}
                  className="mt-2 bg-primary"
                >
                  {updateConfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* 5. Advanced */}
          <AccordionItem value="advanced">
            <AccordionTrigger className="text-[15px] font-medium hover:no-underline">
              Advanced
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pb-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="max-call-duration" className="text-[13px]">
                      Max Call Duration (seconds)
                    </Label>
                    <Input
                      id="max-call-duration"
                      type="number"
                      min={30}
                      max={3600}
                      value={maxCallDuration}
                      onChange={(e) => setMaxCallDuration(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="data-retention" className="text-[13px]">
                      Data Retention (days)
                    </Label>
                    <Input
                      id="data-retention"
                      type="number"
                      min={7}
                      max={365}
                      value={dataRetentionDays}
                      onChange={(e) => setDataRetentionDays(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="greeting-message" className="text-[13px]">
                    Greeting Message
                  </Label>
                  <Textarea
                    id="greeting-message"
                    value={greetingMessage}
                    onChange={(e) => setGreetingMessage(e.target.value)}
                    placeholder="Hello, thank you for calling..."
                    rows={2}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    The first thing the AI says when it answers a call.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-instructions" className="text-[13px]">
                    Custom Instructions
                  </Label>
                  <Textarea
                    id="custom-instructions"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="Any special instructions for the AI, e.g. tone of voice, topics to avoid..."
                    rows={4}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Additional guidance for the AI when handling calls.
                  </p>
                </div>
                <Button
                  onClick={handleSaveAdvanced}
                  disabled={updateConfig.isPending}
                  className="mt-2 bg-primary"
                >
                  {updateConfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
};
