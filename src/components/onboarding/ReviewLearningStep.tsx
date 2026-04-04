import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  ArrowRight,
  Pencil,
  Trash2,
  Plus,
  X,
  Check,
  MessageSquare,
  Sparkles,
  BarChart3,
  SkipForward,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

interface ReviewLearningStepProps {
  workspaceId: string;
  onComplete: () => void;
  onBack: () => void;
}

interface VoiceProfile {
  id: string;
  tone_descriptors: string[];
  formality_score: number;
  common_phrases: string[];
  greeting_patterns: string[];
  signoff_patterns: string[];
  uses_emojis: boolean;
  uses_exclamations: boolean;
}

interface LearnedResponse {
  id: string;
  email_category: string;
  trigger_phrases: string[];
  response_pattern: string;
  example_response: string;
}

interface InboxInsight {
  total_emails_analyzed: number;
  patterns_learned: number;
  common_inquiry_types: { type: string; count: number }[];
}

export function ReviewLearningStep({ workspaceId, onComplete, onBack }: ReviewLearningStepProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [learnedResponses, setLearnedResponses] = useState<LearnedResponse[]>([]);
  const [insights, setInsights] = useState<InboxInsight | null>(null);
  const [editingVoice, setEditingVoice] = useState(false);
  const [editingResponseId, setEditingResponseId] = useState<string | null>(null);
  const [newPhrase, setNewPhrase] = useState('');
  const [newTone, setNewTone] = useState('');

  const loadLearningData = useCallback(async () => {
    setLoading(true);
    try {
      // Load voice profile
      const { data: voiceData } = await supabase
        .from('voice_profiles')
        .select('*')
        .eq('workspace_id', workspaceId)
        .single();

      if (voiceData) {
        // Parse JSON fields
        const commonPhrases = Array.isArray(voiceData.common_phrases)
          ? (voiceData.common_phrases as string[])
          : [];
        const greetingPatterns = Array.isArray(voiceData.greeting_patterns)
          ? (voiceData.greeting_patterns as string[])
          : [];
        const signoffPatterns = Array.isArray(voiceData.signoff_patterns)
          ? (voiceData.signoff_patterns as string[])
          : [];

        setVoiceProfile({
          id: voiceData.id,
          tone_descriptors: voiceData.tone_descriptors || [],
          formality_score: voiceData.formality_score || 5,
          common_phrases: commonPhrases,
          greeting_patterns: greetingPatterns,
          signoff_patterns: signoffPatterns,
          uses_emojis: voiceData.uses_emojis || false,
          uses_exclamations: voiceData.uses_exclamations || false,
        });
      }

      // Load learned responses
      const { data: responsesData } = await supabase
        .from('learned_responses')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('times_used', { ascending: false })
        .limit(10);

      if (responsesData) {
        setLearnedResponses(
          responsesData.map((r) => ({
            id: r.id,
            email_category: r.email_category || 'General',
            trigger_phrases: r.trigger_phrases || [],
            response_pattern: r.response_pattern || '',
            example_response: r.example_response || '',
          })),
        );
      }

      // Load inbox insights
      const { data: insightsData } = await supabase
        .from('inbox_insights')
        .select('*')
        .eq('workspace_id', workspaceId)
        .single();

      if (insightsData) {
        const inquiryTypes = Array.isArray(insightsData.common_inquiry_types)
          ? (insightsData.common_inquiry_types as { type: string; count: number }[])
          : [];
        setInsights({
          total_emails_analyzed: insightsData.total_emails_analyzed || 0,
          patterns_learned: insightsData.patterns_learned || 0,
          common_inquiry_types: inquiryTypes,
        });
      }
    } catch (error) {
      logger.error('Error loading learning data', error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadLearningData();
  }, [loadLearningData]);

  const saveVoiceProfile = async () => {
    if (!voiceProfile) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('voice_profiles')
        .update({
          tone_descriptors: voiceProfile.tone_descriptors,
          formality_score: voiceProfile.formality_score,
          common_phrases: voiceProfile.common_phrases,
          greeting_patterns: voiceProfile.greeting_patterns,
          signoff_patterns: voiceProfile.signoff_patterns,
          uses_emojis: voiceProfile.uses_emojis,
          uses_exclamations: voiceProfile.uses_exclamations,
        })
        .eq('id', voiceProfile.id);

      if (error) throw error;
      toast.success('Voice profile updated');
      setEditingVoice(false);
    } catch (error) {
      logger.error('Error saving voice profile', error);
      toast.error('Failed to save voice profile');
    } finally {
      setSaving(false);
    }
  };

  const updateResponse = async (response: LearnedResponse) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('learned_responses')
        .update({
          trigger_phrases: response.trigger_phrases,
          response_pattern: response.response_pattern,
        })
        .eq('id', response.id);

      if (error) throw error;
      toast.success('Response pattern updated');
      setEditingResponseId(null);
    } catch (error) {
      logger.error('Error updating response', error);
      toast.error('Failed to update response');
    } finally {
      setSaving(false);
    }
  };

  const deleteResponse = async (id: string) => {
    try {
      const { error } = await supabase.from('learned_responses').delete().eq('id', id);

      if (error) throw error;
      setLearnedResponses((prev) => prev.filter((r) => r.id !== id));
      toast.success('Response pattern removed');
    } catch (error) {
      logger.error('Error deleting response', error);
      toast.error('Failed to remove response');
    }
  };

  const addToneDescriptor = () => {
    if (!newTone.trim() || !voiceProfile) return;
    setVoiceProfile({
      ...voiceProfile,
      tone_descriptors: [...voiceProfile.tone_descriptors, newTone.trim()],
    });
    setNewTone('');
  };

  const removeToneDescriptor = (index: number) => {
    if (!voiceProfile) return;
    setVoiceProfile({
      ...voiceProfile,
      tone_descriptors: voiceProfile.tone_descriptors.filter((_, i) => i !== index),
    });
  };

  const addCommonPhrase = () => {
    if (!newPhrase.trim() || !voiceProfile) return;
    setVoiceProfile({
      ...voiceProfile,
      common_phrases: [...voiceProfile.common_phrases, newPhrase.trim()],
    });
    setNewPhrase('');
  };

  const removeCommonPhrase = (index: number) => {
    if (!voiceProfile) return;
    setVoiceProfile({
      ...voiceProfile,
      common_phrases: voiceProfile.common_phrases.filter((_, i) => i !== index),
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <Skeleton className="h-8 w-64 mx-auto" />
          <Skeleton className="h-4 w-80 mx-auto" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const hasData = voiceProfile || learnedResponses.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2 text-primary mb-2">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold">Review What BizzyBee Learned</h2>
        <p className="text-sm text-muted-foreground">
          Fine-tune your communication style and response patterns before we start
        </p>
      </div>

      {/* Summary Stats */}
      {insights && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-primary">
              {insights.total_emails_analyzed.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Emails Analyzed</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-green-600">{insights.patterns_learned}</div>
            <div className="text-xs text-muted-foreground">Patterns Learned</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-blue-600">{learnedResponses.length}</div>
            <div className="text-xs text-muted-foreground">Response Templates</div>
          </div>
        </div>
      )}

      {!hasData ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground">
              No learning data found yet. This will populate after BizzyBee analyzes your emails.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Voice Profile Section */}
          {voiceProfile && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Your Communication Style
                  </CardTitle>
                  {!editingVoice ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditingVoice(true)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditingVoice(false)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={saveVoiceProfile}
                        disabled={saving}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Save
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Tone Descriptors */}
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Tone
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {voiceProfile.tone_descriptors.map((tone, i) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        {tone}
                        {editingVoice && (
                          <X
                            className="h-3 w-3 cursor-pointer hover:text-destructive"
                            onClick={() => removeToneDescriptor(i)}
                          />
                        )}
                      </Badge>
                    ))}
                    {editingVoice && (
                      <div className="flex gap-1">
                        <Input
                          value={newTone}
                          onChange={(e) => setNewTone(e.target.value)}
                          placeholder="Add tone..."
                          className="h-7 w-24 text-xs"
                          onKeyDown={(e) => e.key === 'Enter' && addToneDescriptor()}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={addToneDescriptor}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Formality Slider */}
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Formality: {voiceProfile.formality_score}/10
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">Casual</span>
                    <Slider
                      value={[voiceProfile.formality_score]}
                      onValueChange={([value]) =>
                        setVoiceProfile({ ...voiceProfile, formality_score: value })
                      }
                      min={1}
                      max={10}
                      step={1}
                      disabled={!editingVoice}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground">Formal</span>
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={voiceProfile.uses_emojis}
                      onCheckedChange={(checked) =>
                        setVoiceProfile({ ...voiceProfile, uses_emojis: checked })
                      }
                      disabled={!editingVoice}
                    />
                    <span className="text-sm">Uses emojis</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={voiceProfile.uses_exclamations}
                      onCheckedChange={(checked) =>
                        setVoiceProfile({ ...voiceProfile, uses_exclamations: checked })
                      }
                      disabled={!editingVoice}
                    />
                    <span className="text-sm">Uses exclamations</span>
                  </div>
                </div>

                {/* Common Phrases */}
                {voiceProfile.common_phrases.length > 0 && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Common Phrases
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {voiceProfile.common_phrases.slice(0, 5).map((phrase, i) => (
                        <Badge key={i} variant="outline" className="gap-1 text-xs">
                          "{phrase}"
                          {editingVoice && (
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-destructive"
                              onClick={() => removeCommonPhrase(i)}
                            />
                          )}
                        </Badge>
                      ))}
                      {editingVoice && (
                        <div className="flex gap-1">
                          <Input
                            value={newPhrase}
                            onChange={(e) => setNewPhrase(e.target.value)}
                            placeholder="Add phrase..."
                            className="h-7 w-32 text-xs"
                            onKeyDown={(e) => e.key === 'Enter' && addCommonPhrase()}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={addCommonPhrase}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Greeting & Signoff */}
                {(voiceProfile.greeting_patterns.length > 0 ||
                  voiceProfile.signoff_patterns.length > 0) && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {voiceProfile.greeting_patterns.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Greeting: </span>
                        <span className="font-medium">"{voiceProfile.greeting_patterns[0]}"</span>
                      </div>
                    )}
                    {voiceProfile.signoff_patterns.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Sign-off: </span>
                        <span className="font-medium">"{voiceProfile.signoff_patterns[0]}"</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Learned Response Patterns */}
          {learnedResponses.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Learned Response Patterns
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {learnedResponses.map((response) => (
                  <Card key={response.id} className="border-border/50">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <Badge variant="secondary" className="mb-2 text-xs">
                            {response.email_category}
                          </Badge>
                          {editingResponseId === response.id ? (
                            <div className="space-y-2">
                              <div>
                                <label className="text-xs text-muted-foreground">
                                  Trigger phrases (comma separated)
                                </label>
                                <Input
                                  value={response.trigger_phrases.join(', ')}
                                  onChange={(e) => {
                                    const phrases = e.target.value
                                      .split(',')
                                      .map((p) => p.trim())
                                      .filter(Boolean);
                                    setLearnedResponses((prev) =>
                                      prev.map((r) =>
                                        r.id === response.id
                                          ? { ...r, trigger_phrases: phrases }
                                          : r,
                                      ),
                                    );
                                  }}
                                  className="h-8 text-sm mt-1"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground">
                                  Response pattern
                                </label>
                                <Textarea
                                  value={response.response_pattern}
                                  onChange={(e) => {
                                    setLearnedResponses((prev) =>
                                      prev.map((r) =>
                                        r.id === response.id
                                          ? { ...r, response_pattern: e.target.value }
                                          : r,
                                      ),
                                    );
                                  }}
                                  className="text-sm mt-1 min-h-[60px]"
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap gap-1 mb-2">
                                {response.trigger_phrases.slice(0, 3).map((phrase, i) => (
                                  <Badge key={i} variant="outline" className="text-xs font-normal">
                                    {phrase}
                                  </Badge>
                                ))}
                                {response.trigger_phrases.length > 3 && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    +{response.trigger_phrases.length - 3} more
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {response.response_pattern || response.example_response}
                              </p>
                            </>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {editingResponseId === response.id ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditingResponseId(null)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="default"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => updateResponse(response)}
                                disabled={saving}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditingResponseId(response.id)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => deleteResponse(response.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onComplete}>
            <SkipForward className="mr-2 h-4 w-4" />
            Skip Review
          </Button>
          <Button onClick={onComplete}>
            Looks Good
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
