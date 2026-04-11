import { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobilePageLayout } from '@/components/layout/MobilePageLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Sidebar } from '@/components/sidebar/Sidebar';
import {
  Search,
  Globe,
  Users,
  FileText,
  Star,
  Trash2,
  Edit,
  Plus,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Settings2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  generation_source: string | null;
  source?: string | null;
  priority?: number;
  created_at: string;
}

const getSourceIcon = (faq: FAQ) => {
  const src = faq.generation_source || faq.source || '';
  if (src.includes('website')) return <Globe className="h-4 w-4 text-blue-500" />;
  if (src.includes('competitor')) return <Users className="h-4 w-4 text-purple-500" />;
  if (src.includes('document')) return <FileText className="h-4 w-4 text-amber-500" />;
  return <Star className="h-4 w-4 text-bb-warm-gray" />;
};

const getPriorityBadge = (priority: number = 0) => {
  if (priority >= 9)
    return (
      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        Your Content
      </Badge>
    );
  if (priority >= 7)
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        High Priority
      </Badge>
    );
  if (priority >= 5)
    return (
      <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
        Competitor
      </Badge>
    );
  return <Badge variant="secondary">Low</Badge>;
};

function FAQCard({
  faq,
  onDelete,
  onEdit,
}: {
  faq: FAQ;
  onDelete: () => void;
  onEdit: (faq: FAQ) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const handleDelete = async () => {
    if (confirm('Delete this FAQ?')) {
      await supabase.from('faqs').delete().eq('id', faq.id);
      onDelete();
    }
  };

  return (
    <div className="bg-bb-cream rounded-lg border-[0.5px] border-bb-border p-5 hover:shadow-md transition-all mb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {getSourceIcon(faq)}
            {getPriorityBadge(faq.priority ?? 0)}
          </div>

          <h3 className="font-medium text-bb-text mb-2">{faq.question}</h3>

          <p
            className={`text-sm text-bb-warm-gray ${!expanded && faq.answer.length > 150 ? 'line-clamp-2' : ''}`}
          >
            {faq.answer}
          </p>

          {faq.answer.length > 150 && (
            <Button
              variant="link"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="px-0 h-auto mt-1"
            >
              {expanded ? (
                <span className="flex items-center gap-1">
                  Show less <ChevronUp className="h-3 w-3" />
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  Show more <ChevronDown className="h-3 w-3" />
                </span>
              )}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(faq)}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeBase() {
  const { workspace, loading: workspaceLoading, entitlements } = useWorkspace();
  const isMobile = useIsMobile();
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddFaq, setShowAddFaq] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [savingFaq, setSavingFaq] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editingFaq, setEditingFaq] = useState<FAQ | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  if (entitlements && !entitlements.features.knowledge_base) {
    const lockedContent = (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-xl border-[0.5px] border-bb-border bg-bb-white">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bb-gold/10 text-bb-gold">
              <BookOpen className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-2xl font-medium text-bb-text">
              Knowledge Base is on paid AI plans
            </h1>
            <p className="mt-3 text-sm text-bb-warm-gray">
              This workspace does not currently include the Knowledge Base. Upgrade to Starter or
              above to unlock FAQs, website learning, and business context that BizzyBee can use in
              replies.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button asChild>
                <Link to="/settings">Review plan</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/">Back to inbox</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );

    if (isMobile) {
      return <MobilePageLayout title="Knowledge Base">{lockedContent}</MobilePageLayout>;
    }

    return (
      <div className="min-h-screen bg-bb-cream flex">
        <Sidebar /> <div className="flex-1">{lockedContent}</div>
      </div>
    );
  }

  const fetchFaqs = useCallback(async () => {
    if (!workspace?.id) return;
    setFetchError(null);

    const { data, error } = await supabase
      .from('faq_database')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('priority', { ascending: false });

    if (error) {
      console.error('Error fetching FAQs:', error);
      setFetchError('Failed to load FAQs. Please try again.');
      setLoading(false);
      return;
    }

    setFaqs(data || []);
    setLoading(false);
  }, [workspace?.id]);

  useEffect(() => {
    if (workspace?.id) {
      void fetchFaqs();
    }
  }, [fetchFaqs, workspace?.id]);

  const handleEditFaq = (faq: FAQ) => {
    setEditingFaq(faq);
    setEditQuestion(faq.question);
    setEditAnswer(faq.answer);
  };

  const handleSaveEdit = async () => {
    if (!editingFaq || !editQuestion.trim() || !editAnswer.trim()) return;
    setSavingEdit(true);
    const { error } = await supabase
      .from('faq_database')
      .update({ question: editQuestion.trim(), answer: editAnswer.trim() })
      .eq('id', editingFaq.id);
    setSavingEdit(false);
    if (error) {
      toast.error('Failed to update FAQ');
      return;
    }
    toast.success('FAQ updated');
    setEditingFaq(null);
    fetchFaqs();
  };

  const handleAddFaq = async () => {
    if (!newQuestion.trim() || !newAnswer.trim() || !workspace?.id) return;
    setSavingFaq(true);
    const { error } = await supabase.from('faq_database').insert([
      {
        workspace_id: workspace.id,
        question: newQuestion.trim(),
        answer: newAnswer.trim(),
        category: 'manual',
        generation_source: 'manual',
        priority: 9,
        is_active: true,
        is_own_content: true,
      },
    ]);
    setSavingFaq(false);
    if (error) {
      toast.error('Failed to save FAQ');
      return;
    }
    toast.success('FAQ added successfully');
    setNewQuestion('');
    setNewAnswer('');
    setShowAddFaq(false);
    fetchFaqs();
  };

  // Group FAQs by source (mutually exclusive — each FAQ appears in exactly one group)
  const getSrc = (f: FAQ) => f.generation_source || f.source || '';
  const groupedFaqs = (() => {
    const website: FAQ[] = [];
    const competitor: FAQ[] = [];
    const document: FAQ[] = [];
    const manual: FAQ[] = [];

    for (const f of faqs) {
      const src = getSrc(f);
      if (src.includes('website')) {
        website.push(f);
      } else if (src.includes('competitor')) {
        competitor.push(f);
      } else if (src.includes('document')) {
        document.push(f);
      } else {
        manual.push(f);
      }
    }

    return { website, competitor, document, manual };
  })();

  const filteredFaqs = faqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filterByTab = (tabFaqs: FAQ[]) => {
    if (!searchQuery) return tabFaqs;
    return tabFaqs.filter(
      (faq) =>
        faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  };

  const activeSourceCount = [
    groupedFaqs.website.length > 0,
    groupedFaqs.competitor.length > 0,
    groupedFaqs.document.length > 0,
    groupedFaqs.manual.length > 0,
  ].filter(Boolean).length;
  const manualFaqCount = groupedFaqs.manual.length;
  const knowledgeChecklist = [
    {
      label: 'Workspace connected',
      complete: Boolean(workspace?.id),
    },
    {
      label: 'Knowledge loaded into BizzyBee',
      complete: faqs.length > 0,
    },
    {
      label: 'Manual business knowledge added',
      complete: manualFaqCount > 0,
    },
    {
      label: 'More than one source represented',
      complete: activeSourceCount > 1,
    },
  ];
  const knowledgeNextStep =
    knowledgeChecklist.find((item) => !item.complete)?.label ?? 'Knowledge module is ready';
  const knowledgeLaunchReady = knowledgeChecklist.every((item) => item.complete);
  const knowledgeLaunchAction = !workspace?.id
    ? { label: 'Open onboarding', to: '/onboarding?reset=true' }
    : manualFaqCount === 0
      ? { label: 'Add manual knowledge', to: '/knowledge-base' }
      : activeSourceCount <= 1
        ? { label: 'Re-run onboarding', to: '/onboarding?reset=true' }
        : null;
  const knowledgeQuickActions = [
    {
      title: 'Add manual knowledge',
      description: 'Capture the company-specific detail BizzyBee cannot infer.',
      action: () => setShowAddFaq(true),
      icon: Plus,
      tone: 'bg-bb-gold/10 text-bb-espresso',
    },
    {
      title: 'Re-run onboarding',
      description: 'Pull more website or onboarding knowledge into the module.',
      to: '/onboarding?reset=true',
      icon: ArrowRight,
      tone: 'bg-blue-100 text-blue-700',
    },
    {
      title: 'Open AI settings',
      description: 'Connect this knowledge to rules, behavior, and training.',
      to: '/settings?category=ai',
      icon: Settings2,
      tone: 'bg-emerald-100 text-emerald-700',
    },
  ];

  if (workspaceLoading) {
    return (
      <div className="flex h-screen bg-bb-linen">
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-bb-warm-gray">Loading...</div>
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <MobilePageLayout>
        <div className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto p-4 space-y-6">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-bb-warm-gray hover:text-bb-text transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to Dashboard</span>
            </Link>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Brain className="h-5 w-5 text-primary" />
                  </div>
                  <h1 className="text-[18px] font-medium text-bb-text">Knowledge Base</h1>
                </div>
                <p className="text-bb-warm-gray">Everything BizzyBee knows about your business</p>
              </div>
              <Button className="gap-2 self-start sm:self-auto" onClick={() => setShowAddFaq(true)}>
                <Plus className="h-4 w-4" />
                Add FAQ
              </Button>
            </div>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-bb-cream rounded-lg border-[0.5px] border-bb-border p-4">
                <div className="flex items-center gap-3">
                  <Globe className="h-8 w-8 text-blue-500" />
                  <div>
                    <p className="text-[20px] font-medium text-bb-text">
                      {groupedFaqs.website.length}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                      From Your Website
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-bb-cream rounded-lg border-[0.5px] border-bb-border p-4">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-purple-500" />
                  <div>
                    <p className="text-[20px] font-medium text-bb-text">
                      {groupedFaqs.competitor.length}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                      From Competitors
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-bb-cream rounded-lg border-[0.5px] border-bb-border p-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 text-amber-500" />
                  <div>
                    <p className="text-[20px] font-medium text-bb-text">
                      {groupedFaqs.document.length}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                      From Documents
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-bb-cream rounded-lg border-[0.5px] border-bb-border p-4">
                <div className="flex items-center gap-3">
                  <BookOpen className="h-8 w-8 text-green-500" />
                  <div>
                    <p className="text-[20px] font-medium text-bb-text">{faqs.length}</p>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray">
                      Total FAQs
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bb-warm-gray" />
              <Input
                placeholder="Search FAQs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {fetchError && (
              <Card className="border-destructive bg-destructive/5 p-4">
                <div className="flex items-center gap-2 text-destructive">
                  <p className="text-sm font-medium">{fetchError}</p>
                  <Button variant="outline" size="sm" onClick={fetchFaqs}>
                    Retry
                  </Button>
                </div>
              </Card>
            )}
            <Tabs defaultValue="all" className="space-y-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">All ({faqs.length})</TabsTrigger>
                <TabsTrigger value="website">Website ({groupedFaqs.website.length})</TabsTrigger>
                <TabsTrigger value="competitors">
                  Competitors ({groupedFaqs.competitor.length})
                </TabsTrigger>
                <TabsTrigger value="documents">
                  Documents ({groupedFaqs.document.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="space-y-3">
                {loading ? (
                  <div className="text-center py-8 text-bb-warm-gray">Loading FAQs...</div>
                ) : filteredFaqs.length > 0 ? (
                  filteredFaqs.map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-bb-warm-gray">No FAQs found</div>
                )}
              </TabsContent>
              <TabsContent value="website" className="space-y-3">
                {filterByTab(groupedFaqs.website).length > 0 ? (
                  filterByTab(groupedFaqs.website).map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-bb-warm-gray">No website FAQs yet</div>
                )}
              </TabsContent>
              <TabsContent value="competitors" className="space-y-3">
                {filterByTab(groupedFaqs.competitor).length > 0 ? (
                  filterByTab(groupedFaqs.competitor).map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-bb-warm-gray">No competitor FAQs yet</div>
                )}
              </TabsContent>
              <TabsContent value="documents" className="space-y-3">
                {filterByTab(groupedFaqs.document).length > 0 ? (
                  filterByTab(groupedFaqs.document).map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-bb-warm-gray">No document FAQs yet</div>
                )}
              </TabsContent>
            </Tabs>
            {faqs.length === 0 && !loading && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <BookOpen className="h-12 w-12 text-bb-muted mb-4" />
                  <h3 className="text-[18px] font-medium text-bb-text mb-2">No knowledge yet</h3>
                  <p className="text-bb-warm-gray text-center mb-4">
                    Complete onboarding to build your knowledge base.
                  </p>
                  <Button asChild>
                    <Link to="/onboarding">Go to Onboarding</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
        <Dialog open={showAddFaq} onOpenChange={setShowAddFaq}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add FAQ</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="faq-question-m">Question</Label>
                <Input
                  id="faq-question-m"
                  placeholder="e.g. What are your opening hours?"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="faq-answer-m">Answer</Label>
                <Textarea
                  id="faq-answer-m"
                  placeholder="e.g. We're open Monday–Friday, 9am–5pm."
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddFaq(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAddFaq}
                disabled={savingFaq || !newQuestion.trim() || !newAnswer.trim()}
              >
                {savingFaq ? 'Saving...' : 'Save FAQ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </MobilePageLayout>
    );
  }

  return (
    <div className="flex h-screen bg-bb-linen">
      {/* Sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          <div className="rounded-[28px] border border-bb-border bg-bb-white px-6 py-6 shadow-[0_18px_40px_rgba(28,21,16,0.05)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <Badge className="w-fit border-bb-gold/25 bg-bb-gold/10 text-bb-espresso hover:bg-bb-gold/10">
                  Knowledge module
                </Badge>
                <div className="space-y-2">
                  <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-bb-text">
                    Knowledge Base
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-bb-warm-gray">
                    This is the source of truth BizzyBee uses for answers, rules, and business
                    context. The goal is not just to store FAQs, but to make knowledge visible,
                    editable, and ready for production use.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button className="gap-2" onClick={() => setShowAddFaq(true)}>
                  <Plus className="h-4 w-4" />
                  Add FAQ
                </Button>
                <Button asChild variant="outline">
                  <Link to="/settings?category=ai">
                    Open AI settings
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
            <Card className="border-[0.5px] border-bb-border bg-bb-white p-5">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
                      Module health
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-bb-text">Knowledge readiness</h2>
                  </div>
                  <Badge
                    className={
                      knowledgeChecklist.every((item) => item.complete)
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                        : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                    }
                  >
                    {knowledgeChecklist.filter((item) => item.complete).length}/
                    {knowledgeChecklist.length} ready
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {knowledgeChecklist.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3"
                    >
                      <span className="text-sm text-bb-text">{item.label}</span>
                      <Badge
                        className={
                          item.complete
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                            : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                        }
                      >
                        {item.complete ? 'Ready' : 'Pending'}
                      </Badge>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
                  <p className="text-sm font-medium text-bb-text">Next knowledge step</p>
                  <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                    {knowledgeNextStep === 'Knowledge module is ready'
                      ? 'Knowledge now has enough structure and source coverage to act like a real production module.'
                      : `${knowledgeNextStep} is the next blocker before Knowledge feels fully operational.`}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="border-[0.5px] border-bb-border bg-bb-white p-5">
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
                    Source mix
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-bb-text">What BizzyBee knows</h2>
                </div>

                <div className="space-y-2">
                  {[
                    {
                      label: 'Website knowledge',
                      value: groupedFaqs.website.length,
                      tone: 'bg-blue-100 text-blue-700',
                    },
                    {
                      label: 'Competitor research',
                      value: groupedFaqs.competitor.length,
                      tone: 'bg-purple-100 text-purple-700',
                    },
                    {
                      label: 'Uploaded documents',
                      value: groupedFaqs.document.length,
                      tone: 'bg-amber-100 text-amber-700',
                    },
                    {
                      label: 'Manual knowledge',
                      value: groupedFaqs.manual.length,
                      tone: 'bg-emerald-100 text-emerald-700',
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-white px-3 py-3"
                    >
                      <span className="text-sm text-bb-text">{item.label}</span>
                      <Badge className={item.tone}>{item.value}</Badge>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
                  <p className="text-sm leading-6 text-bb-warm-gray">
                    Knowledge should not be a dumping ground. It should clearly show where BizzyBee
                    learned something and where you still need to add the company-specific detail
                    that makes replies trustworthy.
                  </p>
                </div>

                <div className="rounded-2xl border border-bb-border bg-bb-cream/60 p-4">
                  <p className="text-sm font-medium text-bb-text">Go-live handoff</p>
                  <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                    {knowledgeLaunchReady
                      ? 'Knowledge now has enough source coverage and manual business context to support a production-grade AI system.'
                      : `${knowledgeNextStep} is the next blocker before Knowledge can be handed over as a fully trusted module.`}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {knowledgeLaunchAction ? (
                      knowledgeLaunchAction.to === '/knowledge-base' ? (
                        <Button size="sm" variant="outline" onClick={() => setShowAddFaq(true)}>
                          {knowledgeLaunchAction.label}
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link to={knowledgeLaunchAction.to}>{knowledgeLaunchAction.label}</Link>
                        </Button>
                      )
                    ) : (
                      <Badge
                        className={
                          knowledgeLaunchReady
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                            : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                        }
                      >
                        {knowledgeLaunchReady
                          ? 'Internal handoff ready'
                          : 'Manual knowledge needed'}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {knowledgeQuickActions.map((action) => {
                    const Icon = action.icon;

                    if ('action' in action) {
                      return (
                        <button
                          key={action.title}
                          type="button"
                          onClick={action.action}
                          className="w-full rounded-xl border border-bb-border bg-bb-white px-3 py-3 text-left transition-colors hover:bg-bb-linen/60"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className={`rounded-xl p-2 ${action.tone}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <ArrowRight className="h-4 w-4 text-bb-warm-gray" />
                          </div>
                          <p className="mt-4 text-sm font-medium text-bb-text">{action.title}</p>
                          <p className="mt-1 text-xs leading-5 text-bb-warm-gray">
                            {action.description}
                          </p>
                        </button>
                      );
                    }

                    return (
                      <Link
                        key={action.title}
                        to={action.to}
                        className="block rounded-xl border border-bb-border bg-bb-white px-3 py-3 transition-colors hover:bg-bb-linen/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className={`rounded-xl p-2 ${action.tone}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <ArrowRight className="h-4 w-4 text-bb-warm-gray" />
                        </div>
                        <p className="mt-4 text-sm font-medium text-bb-text">{action.title}</p>
                        <p className="mt-1 text-xs leading-5 text-bb-warm-gray">
                          {action.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </Card>
          </div>

          <Card className="border-[0.5px] border-bb-border bg-bb-white p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-bb-warm-gray">
                  Go-live handoff
                </p>
                <h2 className="text-lg font-semibold text-bb-text">Knowledge launch path</h2>
                <p className="max-w-2xl text-sm leading-6 text-bb-warm-gray">
                  Knowledge is only first-class when the source mix is clear, the manual business
                  knowledge exists, and the AI team can see exactly what still needs attention.
                </p>
              </div>
              <Badge
                className={
                  knowledgeChecklist.every((item) => item.complete)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                    : 'border-bb-border bg-bb-linen text-bb-warm-gray hover:bg-bb-linen'
                }
              >
                {knowledgeChecklist.filter((item) => item.complete).length}/
                {knowledgeChecklist.length} ready
              </Badge>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {knowledgeChecklist.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-xl border border-bb-border bg-bb-linen/50 px-3 py-3"
                >
                  <span className="text-sm text-bb-text">{item.label}</span>
                  <Badge
                    className={
                      item.complete
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                        : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                    }
                  >
                    {item.complete ? 'Ready' : 'Pending'}
                  </Badge>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-bb-border bg-bb-linen/60 p-4">
              <p className="text-sm font-medium text-bb-text">Next knowledge step</p>
              <p className="mt-2 text-sm leading-6 text-bb-warm-gray">
                {knowledgeLaunchReady
                  ? 'Knowledge is ready to support launch-quality replies, rules, and AI behavior.'
                  : `${knowledgeNextStep} is the final blocker before the module feels complete.`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {knowledgeLaunchAction ? (
                  knowledgeLaunchAction.to === '/knowledge-base' ? (
                    <Button size="sm" variant="outline" onClick={() => setShowAddFaq(true)}>
                      {knowledgeLaunchAction.label}
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link to={knowledgeLaunchAction.to}>{knowledgeLaunchAction.label}</Link>
                    </Button>
                  )
                ) : (
                  <Badge
                    className={
                      knowledgeLaunchReady
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                        : 'border-bb-border bg-bb-white text-bb-warm-gray hover:bg-bb-white'
                    }
                  >
                    {knowledgeLaunchReady ? 'Internal handoff ready' : 'Manual knowledge needed'}
                  </Badge>
                )}
              </div>
            </div>
          </Card>

          {/* Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
              <div className="bg-blue-100 text-blue-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <Globe className="h-5 w-5" />
              </div>
              <p className="text-[20px] font-medium tracking-tight text-bb-text mt-4">
                {groupedFaqs.website.length}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                Website
              </p>
            </div>
            <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
              <div className="bg-purple-100 text-purple-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <Users className="h-5 w-5" />
              </div>
              <p className="text-[20px] font-medium tracking-tight text-bb-text mt-4">
                {groupedFaqs.competitor.length}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                Competitors
              </p>
            </div>
            <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
              <div className="bg-amber-100 text-amber-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <p className="text-[20px] font-medium tracking-tight text-bb-text mt-4">
                {groupedFaqs.document.length}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                Documents
              </p>
            </div>
            <div className="bg-bb-cream border-[0.5px] border-bb-border rounded-lg p-6">
              <div className="bg-emerald-100 text-emerald-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <BookOpen className="h-5 w-5" />
              </div>
              <p className="text-[20px] font-medium tracking-tight text-bb-text mt-4">
                {faqs.length}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-bb-warm-gray mt-1">
                Total FAQs
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-bb-warm-gray" />
            <Input
              placeholder="Search FAQs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="rounded-2xl border border-bb-border bg-bb-white px-4 py-3">
            <p className="text-sm text-bb-warm-gray">
              {searchQuery
                ? `Showing ${filteredFaqs.length} knowledge entries matching "${searchQuery}".`
                : `Showing ${faqs.length} knowledge entries across ${activeSourceCount} active source${activeSourceCount === 1 ? '' : 's'}.`}
            </p>
          </div>

          {/* Error State */}
          {fetchError && (
            <Card className="border-destructive bg-destructive/5 p-4">
              <div className="flex items-center gap-2 text-destructive">
                <p className="text-sm font-medium">{fetchError}</p>
                <Button variant="outline" size="sm" onClick={fetchFaqs}>
                  Retry
                </Button>
              </div>
            </Card>
          )}

          {/* Tabs */}
          <Tabs defaultValue="all" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">All ({faqs.length})</TabsTrigger>
              <TabsTrigger value="website">Website ({groupedFaqs.website.length})</TabsTrigger>
              <TabsTrigger value="competitors">
                Competitors ({groupedFaqs.competitor.length})
              </TabsTrigger>
              <TabsTrigger value="documents">Documents ({groupedFaqs.document.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-3">
              {loading ? (
                <div className="text-center py-8 text-bb-warm-gray">Loading FAQs...</div>
              ) : filteredFaqs.length > 0 ? (
                filteredFaqs.map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-bb-warm-gray">No FAQs found</div>
              )}
            </TabsContent>

            <TabsContent value="website" className="space-y-3">
              {filterByTab(groupedFaqs.website).length > 0 ? (
                filterByTab(groupedFaqs.website).map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-bb-warm-gray">No website FAQs yet</div>
              )}
            </TabsContent>

            <TabsContent value="competitors" className="space-y-3">
              {filterByTab(groupedFaqs.competitor).length > 0 ? (
                filterByTab(groupedFaqs.competitor).map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-bb-warm-gray">No competitor FAQs yet</div>
              )}
            </TabsContent>

            <TabsContent value="documents" className="space-y-3">
              {filterByTab(groupedFaqs.document).length > 0 ? (
                filterByTab(groupedFaqs.document).map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-bb-warm-gray">No document FAQs yet</div>
              )}
            </TabsContent>
          </Tabs>

          {/* Empty State */}
          {faqs.length === 0 && !loading && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BookOpen className="h-12 w-12 text-bb-muted mb-4" />
                <h3 className="text-[18px] font-medium text-bb-text mb-2">No knowledge yet</h3>
                <p className="text-bb-warm-gray text-center mb-4">
                  Complete onboarding to scrape your website and build your knowledge base.
                </p>
                <Button asChild>
                  <Link to="/onboarding">Go to Onboarding</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Edit FAQ Dialog */}
      <Dialog
        open={!!editingFaq}
        onOpenChange={(open) => {
          if (!open) setEditingFaq(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit FAQ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-faq-question">Question</Label>
              <Input
                id="edit-faq-question"
                value={editQuestion}
                onChange={(e) => setEditQuestion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-faq-answer">Answer</Label>
              <Textarea
                id="edit-faq-answer"
                value={editAnswer}
                onChange={(e) => setEditAnswer(e.target.value)}
                className="min-h-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingFaq(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={savingEdit || !editQuestion.trim() || !editAnswer.trim()}
            >
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add FAQ Dialog */}
      <Dialog open={showAddFaq} onOpenChange={setShowAddFaq}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add FAQ</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="faq-question">Question</Label>
              <Input
                id="faq-question"
                placeholder="e.g. What are your opening hours?"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="faq-answer">Answer</Label>
              <Textarea
                id="faq-answer"
                placeholder="e.g. We're open Monday–Friday, 9am–5pm."
                value={newAnswer}
                onChange={(e) => setNewAnswer(e.target.value)}
                className="min-h-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddFaq(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddFaq}
              disabled={savingFaq || !newQuestion.trim() || !newAnswer.trim()}
            >
              {savingFaq ? 'Saving...' : 'Save FAQ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
