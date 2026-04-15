import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Mic, SlidersHorizontal, Sparkles, Volume2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { VoiceSelector } from '@/components/ai-phone/VoiceSelector';
import { type VoiceExperienceDraft, type VoiceScenarioId } from './VoiceExperienceStep.config';

const TONE_OPTIONS = ['warm', 'calm', 'concise', 'reassuring', 'polished', 'friendly'];

const SCENARIOS: Array<{
  id: VoiceScenarioId;
  label: string;
  caller: string;
  intent: string;
}> = [
  {
    id: 'new_enquiry',
    label: 'New enquiry',
    caller: 'Hi, I found you on Google and wanted to check if you can help.',
    intent: 'A first-time customer asking for next steps.',
  },
  {
    id: 'quote_request',
    label: 'Quote request',
    caller: 'Could you give me a rough price for the job?',
    intent: 'A customer wants a fast, clear quotation.',
  },
  {
    id: 'booking_change',
    label: 'Booking change',
    caller: 'I need to move my appointment to later this week.',
    intent: 'A customer needs a friendly reschedule.',
  },
];

interface VoiceExperienceStepProps {
  workspaceId?: string;
  businessContext: {
    companyName: string;
    businessType: string;
    websiteUrl: string;
  };
  knowledgeSummary: {
    industryFaqs: number;
    websiteFaqs: number;
  };
  value: VoiceExperienceDraft;
  onChange: (value: VoiceExperienceDraft) => void;
  onNext: () => void;
  onBack: () => void;
}

type WebsiteFaq = {
  question: string;
  answer: string;
  category: string | null;
};

function buildToneSummary(toneDescriptors: string[], formalityScore: number) {
  const toneList =
    toneDescriptors.length > 0 ? toneDescriptors.slice(0, 3) : ['warm', 'reassuring'];
  const formality =
    formalityScore >= 8 ? 'highly polished' : formalityScore <= 4 ? 'relaxed' : 'balanced';
  return `${toneList.join(' · ')} · ${formality}`;
}

function buildGreeting(companyName: string, greeting: string, receptionistName: string) {
  const trimmed = greeting.trim();
  if (trimmed) return trimmed;
  return `Hi, thanks for calling ${companyName || 'your business'}. You’re speaking with ${receptionistName || 'your receptionist'}.`;
}

function buildSignoff(signoff: string) {
  const trimmed = signoff.trim();
  if (trimmed) return trimmed;
  return 'Thanks, speak soon.';
}

function formatWebsiteHost(websiteUrl: string) {
  try {
    return new URL(websiteUrl).host.replace(/^www\./, '');
  } catch {
    return websiteUrl.replace(/^https?:\/\//, '');
  }
}

function firstSentence(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const match = normalized.match(/.+?[.!?](?:\s|$)/);
  return (match?.[0] ?? normalized).trim();
}

function shortenSnippet(text: string, maxLength = 120) {
  const snippet = firstSentence(text);
  if (snippet.length <= maxLength) return snippet;
  return `${snippet.slice(0, maxLength - 1).trimEnd()}…`;
}

function pickRelevantFaq(scenarioId: VoiceScenarioId, faqs: WebsiteFaq[]) {
  const keywordMap: Record<VoiceScenarioId, string[]> = {
    quote_request: ['price', 'pricing', 'quote', 'cost', 'estimate'],
    booking_change: ['book', 'booking', 'appointment', 'reschedule', 'availability'],
    new_enquiry: ['service', 'cover', 'offer', 'area', 'location', 'help'],
  };

  const keywords = keywordMap[scenarioId];
  return (
    faqs.find((faq) => {
      const haystack = `${faq.question} ${faq.answer} ${faq.category ?? ''}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword));
    }) ??
    faqs[0] ??
    null
  );
}

function buildScenarioReply(params: {
  scenarioId: VoiceScenarioId;
  companyName: string;
  selectedVoiceName: string;
  receptionistName: string;
  toneDescriptors: string[];
  formalityScore: number;
  greeting: string;
  signoff: string;
  websiteFaq: WebsiteFaq | null;
}) {
  const {
    scenarioId,
    companyName,
    selectedVoiceName,
    receptionistName,
    toneDescriptors,
    formalityScore,
    greeting,
    signoff,
    websiteFaq,
  } = params;
  const toneSummary = buildToneSummary(toneDescriptors, formalityScore);
  const greetingLine = buildGreeting(companyName, greeting, receptionistName);
  const signoffLine = buildSignoff(signoff);
  const styleLine =
    formalityScore >= 8
      ? 'polished and reassuring'
      : formalityScore <= 4
        ? 'friendly and relaxed'
        : 'calm and professional';
  const knowledgeCue = websiteFaq ? shortenSnippet(websiteFaq.answer) : null;

  switch (scenarioId) {
    case 'quote_request':
      return knowledgeCue
        ? `${greetingLine} From the website, BizzyBee already knows that ${knowledgeCue.toLowerCase()} It would answer in a ${styleLine} way, give the customer a grounded starting point, and then gather the details needed for a proper quote. ${signoffLine}`
        : `${greetingLine} I’d be happy to help with that quote. BizzyBee would keep the tone ${styleLine}, gather the key details, and move the customer toward a clear next step. ${signoffLine}`;
    case 'booking_change':
      return knowledgeCue
        ? `${greetingLine} BizzyBee can already lean on the website detail that ${knowledgeCue.toLowerCase()} It would confirm the change, keep the caller at ease, and make the handoff feel effortless in a ${toneSummary} style. ${signoffLine}`
        : `${greetingLine} No problem at all. BizzyBee would confirm the change, keep the caller at ease, and make the handoff feel effortless in a ${toneSummary} style. ${signoffLine}`;
    case 'new_enquiry':
    default:
      return knowledgeCue
        ? `${greetingLine} Thanks for reaching out. BizzyBee already knows from the website that ${knowledgeCue.toLowerCase()} It would answer as ${selectedVoiceName}, keep things ${styleLine}, and guide the caller toward the right service or booking step. ${signoffLine}`
        : `${greetingLine} Thanks for reaching out. BizzyBee would answer as ${selectedVoiceName}, keep things ${styleLine}, and guide the caller toward the right service or booking step. ${signoffLine}`;
  }
}

export function VoiceExperienceStep({
  workspaceId,
  businessContext,
  knowledgeSummary,
  value,
  onChange,
  onNext,
  onBack,
}: VoiceExperienceStepProps) {
  const [websiteFaqs, setWebsiteFaqs] = useState<WebsiteFaq[]>([]);
  const faqCount = Math.max(
    knowledgeSummary.industryFaqs + knowledgeSummary.websiteFaqs,
    websiteFaqs.length,
  );
  const selectedScenario =
    SCENARIOS.find((scenario) => scenario.id === value.scenarioId) ?? SCENARIOS[0];
  const scenarioFaq = useMemo(
    () => pickRelevantFaq(selectedScenario.id, websiteFaqs),
    [selectedScenario.id, websiteFaqs],
  );

  useEffect(() => {
    if (!workspaceId || workspaceId === 'preview-workspace') {
      setWebsiteFaqs([]);
      return;
    }

    let cancelled = false;

    const loadWebsiteFaqs = async () => {
      const { data, error } = await supabase
        .from('faq_database')
        .select('question, answer, category')
        .eq('workspace_id', workspaceId)
        .eq('is_own_content', true)
        .order('priority', { ascending: false })
        .limit(8);

      if (!cancelled && !error) {
        setWebsiteFaqs((data as WebsiteFaq[] | null) ?? []);
      }
    };

    void loadWebsiteFaqs();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const previewReply = buildScenarioReply({
    scenarioId: selectedScenario.id,
    companyName: businessContext.companyName,
    selectedVoiceName: value.selectedVoiceName,
    receptionistName: value.receptionistName,
    toneDescriptors: value.toneDescriptors,
    formalityScore: value.formalityScore,
    greeting: value.greeting,
    signoff: value.signoff,
    websiteFaq: scenarioFaq,
  });
  const greetingPreview = useMemo(
    () => buildGreeting(businessContext.companyName, value.greeting, value.receptionistName),
    [businessContext.companyName, value.greeting, value.receptionistName],
  );
  const signoffPreview = useMemo(() => buildSignoff(value.signoff), [value.signoff]);
  const websiteHost = formatWebsiteHost(businessContext.websiteUrl);

  const toggleTone = (tone: string) => {
    const normalized = tone.trim().toLowerCase();
    const nextTones = value.toneDescriptors.includes(normalized)
      ? value.toneDescriptors.filter((item) => item !== normalized)
      : [...value.toneDescriptors, normalized];
    onChange({ ...value, toneDescriptors: nextTones });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="text-center space-y-2">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.08em]">
            Voice-first setup
          </Badge>
          <h2 className="text-2xl font-semibold">Shape how BizzyBee sounds</h2>
          <p className="mx-auto max-w-3xl text-sm text-muted-foreground">
            BizzyBee has already read your website and picked up {faqCount.toLocaleString()} useful
            FAQs. Now we shape the receptionist voice, the greeting, and the style of replies before
            we widen out into channels.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-3xl border border-border/60 bg-background p-5 shadow-sm shadow-black/5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Website</p>
            <p className="mt-2 text-base font-semibold text-foreground">{websiteHost}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              BizzyBee is shaping the receptionist around the business it already learned from your
              site.
            </p>
          </div>
          <div className="rounded-3xl border border-border/60 bg-background p-5 shadow-sm shadow-black/5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Voice</p>
            <p className="mt-2 text-base font-semibold text-foreground">
              {value.selectedVoiceName}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {buildToneSummary(value.toneDescriptors, value.formalityScore)}
            </p>
          </div>
          <div className="rounded-3xl border border-border/60 bg-primary/5 p-5 shadow-sm shadow-primary/5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              What this controls
            </p>
            <p className="mt-2 text-base font-semibold text-foreground">
              Greeting, tone, call flow, and first-response style
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Preview now in-browser. Live inbox and phone use the same voice profile once switched
              on.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border/60 shadow-sm shadow-black/5">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mic className="h-5 w-5 text-primary" />
              Choose a receptionist voice
            </CardTitle>
            <CardDescription>
              Pick the voice BizzyBee should use as the first impression on calls and spoken
              replies.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VoiceSelector
              selectedVoiceId={value.selectedVoiceId}
              previewText={previewReply}
              helperText="Instant samples play in your browser here so preview mode still feels alive. Live calls use the BizzyBee voice profile you choose."
              onSelect={(voiceId, voiceName) => {
                const shouldSyncReceptionistName =
                  !value.receptionistName.trim() ||
                  value.receptionistName === value.selectedVoiceName;

                onChange({
                  ...value,
                  selectedVoiceId: voiceId,
                  selectedVoiceName: voiceName,
                  receptionistName: shouldSyncReceptionistName ? voiceName : value.receptionistName,
                });
              }}
            />

            <Accordion
              type="multiple"
              defaultValue={['tone']}
              className="mt-6 space-y-3 rounded-2xl border border-border/60 bg-muted/20 px-4"
            >
              <AccordionItem value="tone" className="border-b border-border/60">
                <AccordionTrigger className="py-4 text-left hover:no-underline">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                      <SlidersHorizontal className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Tune the tone</p>
                      <p className="mt-1 text-sm font-normal text-muted-foreground">
                        Decide how warm, concise, and polished BizzyBee should feel.
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-5">
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-sm font-medium">Tone</Label>
                        <span className="text-xs text-muted-foreground">
                          {buildToneSummary(value.toneDescriptors, value.formalityScore)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {TONE_OPTIONS.map((tone) => {
                          const active = value.toneDescriptors.includes(tone);
                          return (
                            <button
                              key={tone}
                              type="button"
                              onClick={() => toggleTone(tone)}
                              className={cn(
                                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                                active
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                              )}
                            >
                              {tone}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Formality</Label>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">Friendly</span>
                        <Slider
                          min={1}
                          max={10}
                          step={1}
                          value={[value.formalityScore]}
                          onValueChange={([next]) => onChange({ ...value, formalityScore: next })}
                          className="flex-1"
                        />
                        <span className="text-xs text-muted-foreground">Polished</span>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="greeting" className="border-none">
                <AccordionTrigger className="py-4 text-left hover:no-underline">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-primary/10 p-2 text-primary">
                      <MessageCircle className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Greeting and sign-off</p>
                      <p className="mt-1 text-sm font-normal text-muted-foreground">
                        Keep this short and spoken so it feels like a receptionist, not a script.
                      </p>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-5">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="voice-receptionist-name" className="text-sm font-medium">
                        Receptionist name
                      </Label>
                      <Input
                        id="voice-receptionist-name"
                        value={value.receptionistName}
                        onChange={(e) =>
                          onChange({
                            ...value,
                            receptionistName: e.target.value,
                          })
                        }
                        placeholder={value.selectedVoiceName || 'Jessica'}
                      />
                      <p className="text-xs text-muted-foreground">
                        The exact name callers should hear, even if it differs from the selected
                        voice label.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice-greeting" className="text-sm font-medium">
                        Greeting
                      </Label>
                      <Textarea
                        id="voice-greeting"
                        value={value.greeting}
                        onChange={(e) => onChange({ ...value, greeting: e.target.value })}
                        placeholder={`Hi, thanks for calling ${businessContext.companyName || 'your business'}. You’re speaking with ${value.receptionistName || value.selectedVoiceName || 'your receptionist'}.`}
                        rows={3}
                      />
                      <p className="text-xs text-muted-foreground">
                        Use the receptionist name you actually want customers to hear.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice-signoff" className="text-sm font-medium">
                        Sign-off
                      </Label>
                      <Input
                        id="voice-signoff"
                        value={value.signoff}
                        onChange={(e) => onChange({ ...value, signoff: e.target.value })}
                        placeholder="Thanks, speak soon."
                      />
                      <p className="text-xs text-muted-foreground">
                        The close BizzyBee should use once the answer has done its job.
                      </p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-gradient-to-br from-background via-background to-primary/5 shadow-sm shadow-black/5">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircle className="h-5 w-5 text-primary" />
              Preview BizzyBee in action
            </CardTitle>
            <CardDescription>
              Hear how the chosen voice and tone would play out in a few common customer moments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {SCENARIOS.map((scenario) => {
                const active = scenario.id === value.scenarioId;
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => onChange({ ...value, scenarioId: scenario.id })}
                    className={cn(
                      'rounded-2xl border p-4 text-left transition-all',
                      active
                        ? 'border-primary bg-primary/10 shadow-sm shadow-primary/10'
                        : 'border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground">{scenario.label}</p>
                      {active ? (
                        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{scenario.intent}</p>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3 rounded-3xl border border-border/60 bg-background/80 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Caller says
                  </p>
                  <p className="mt-1 text-sm text-foreground">{selectedScenario.caller}</p>
                </div>
                <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {value.selectedVoiceName}
                </div>
              </div>

              <div className="space-y-2 rounded-2xl bg-muted/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    BizzyBee replies
                  </p>
                  <div className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                    <Volume2 className="h-3.5 w-3.5" />
                    Spoken preview ready
                  </div>
                </div>
                <p className="text-sm leading-6 text-foreground">{previewReply}</p>
                {scenarioFaq ? (
                  <div className="rounded-2xl border border-primary/15 bg-background/90 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      Grounded in fresh website knowledge
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {scenarioFaq.question}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {shortenSnippet(scenarioFaq.answer, 150)}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/60 bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Voice</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {value.receptionistName || value.selectedVoiceName}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Tone</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {value.toneDescriptors.slice(0, 3).join(' · ') || 'warm · reassuring'}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Greeting
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm font-medium text-foreground">
                    {greetingPreview}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-primary/25 bg-primary/5 p-4">
                <p className="text-sm font-medium text-foreground">What this unlocks</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  BizzyBee will use this voice profile for receptionist-style replies and future
                  phone setup, so the assistant feels consistent from the very first conversation.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Website knowledge makes the first reply feel grounded. Inbox learning will make
                  the follow-up details even sharper once email is connected.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Sign-off preview:{' '}
                  <span className="font-medium text-foreground">{signoffPreview}</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}
