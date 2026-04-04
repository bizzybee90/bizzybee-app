import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Tags, Loader2, Plus, X } from 'lucide-react';

interface IndustryKeywordsProps {
  workspaceId: string;
  onComplete: () => void;
}

export const IndustryKeywords = ({ workspaceId, onComplete }: IndustryKeywordsProps) => {
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const generateKeywords = useCallback(async () => {
    setLoading(true);
    try {
      const { data: ctx } = await supabase
        .from('business_context')
        .select('custom_flags')
        .eq('workspace_id', workspaceId)
        .single();
      const flags = ctx?.custom_flags as Record<string, unknown> | null;
      setKeywords((flags?.industry_keywords as string[]) || []);
    } catch (e: any) {
      toast.error('Failed to generate keywords');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void generateKeywords();
  }, [generateKeywords]);

  const addKeyword = () => {
    const kw = newKeyword.trim().toLowerCase();
    if (kw && !keywords.includes(kw)) {
      setKeywords([...keywords, kw]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const saveAndContinue = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('business_context')
        .update({ custom_flags: { industry_keywords: keywords } })
        .eq('workspace_id', workspaceId);

      if (error) throw error;
      toast.success('Keywords saved');
      onComplete();
    } catch (e: any) {
      toast.error('Failed to save keywords');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Analyzing your business...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="h-5 w-5 text-primary" />
          Industry Keywords
        </CardTitle>
        <CardDescription>
          These keywords help us find competitors in your industry. Add or remove as needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {keywords.map((kw) => (
            <Badge key={kw} variant="secondary" className="text-sm py-1 px-2">
              {kw}
              <button onClick={() => removeKeyword(kw)} className="ml-1 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Add keyword..."
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
          />
          <Button variant="outline" size="icon" onClick={addKeyword}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <Button onClick={saveAndContinue} className="w-full" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Continue
        </Button>
      </CardContent>
    </Card>
  );
};
