import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Globe, FileText, User } from 'lucide-react';
import { toast } from 'sonner';

interface KnowledgeFaq {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  source: string;
  source_domain: string | null;
  source_url: string | null;
  priority: number;
  is_validated: boolean;
  created_at: string;
}

interface KnowledgeBaseViewerProps {
  workspaceId: string;
}

export function KnowledgeBaseViewer({ workspaceId }: KnowledgeBaseViewerProps) {
  const [faqs, setFaqs] = useState<KnowledgeFaq[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'user_website' | 'competitor'>('all');

  const loadFaqs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('knowledge_base_faqs')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (filter === 'user_website') {
        query = query.eq('source', 'user_website');
      } else if (filter === 'competitor') {
        query = query.eq('source', 'competitor');
      }

      const { data, error } = await query;

      if (error) throw error;
      setFaqs(data || []);
    } catch (err) {
      console.error('Error loading FAQs:', err);
      toast.error('Failed to load knowledge base');
    } finally {
      setLoading(false);
    }
  }, [filter, workspaceId]);

  useEffect(() => {
    void loadFaqs();
  }, [loadFaqs]);

  const handleDelete = async (faqId: string) => {
    try {
      const { error } = await supabase.from('knowledge_base_faqs').delete().eq('id', faqId);

      if (error) throw error;

      setFaqs((prev) => prev.filter((f) => f.id !== faqId));
      toast.success('FAQ deleted');
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete FAQ');
    }
  };

  const userWebsiteCount = faqs.filter((f) => f.source === 'user_website').length;
  const competitorCount = faqs.filter((f) => f.source === 'competitor').length;

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'user_website':
        return <Globe className="h-3 w-3" />;
      case 'competitor':
        return <FileText className="h-3 w-3" />;
      default:
        return <User className="h-3 w-3" />;
    }
  };

  const getSourceLabel = (faq: KnowledgeFaq) => {
    if (faq.source === 'user_website') return 'Your Website';
    if (faq.source === 'competitor' && faq.source_domain) return faq.source_domain;
    return faq.source;
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 10) return 'default';
    if (priority >= 5) return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">
            All ({faqs.length})
          </TabsTrigger>
          <TabsTrigger value="user_website" className="flex-1">
            Your Website ({userWebsiteCount})
          </TabsTrigger>
          <TabsTrigger value="competitor" className="flex-1">
            Competitors ({competitorCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : faqs.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No FAQs found. Analyze your website or mine competitors to build your knowledge base.
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2 pr-4">
            {faqs.map((faq) => (
              <Card key={faq.id} className="group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm mb-1">{faq.question}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2">{faq.answer}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={getPriorityColor(faq.priority)} className="text-xs">
                        {getSourceIcon(faq.source)}
                        <span className="ml-1">{getSourceLabel(faq)}</span>
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleDelete(faq.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {faq.category && (
                    <Badge variant="outline" className="mt-2 text-xs">
                      {faq.category}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
