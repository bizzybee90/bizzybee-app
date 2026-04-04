import { useState, useEffect } from 'react';
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
  return <Star className="h-4 w-4 text-muted-foreground" />;
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
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-all mb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {getSourceIcon(faq)}
            {getPriorityBadge(faq.priority ?? 0)}
          </div>

          <h3 className="font-medium text-foreground mb-2">{faq.question}</h3>

          <p
            className={`text-sm text-muted-foreground ${!expanded && faq.answer.length > 150 ? 'line-clamp-2' : ''}`}
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
  const { workspace, loading: workspaceLoading } = useWorkspace();
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

  useEffect(() => {
    if (workspace?.id) {
      fetchFaqs();
    }
  }, [workspace?.id]);

  const fetchFaqs = async () => {
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
  };

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

  if (workspaceLoading) {
    return (
      <div className="flex h-screen bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
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
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
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
                  <h1 className="text-2xl font-bold">Knowledge Base</h1>
                </div>
                <p className="text-muted-foreground">
                  Everything BizzyBee knows about your business
                </p>
              </div>
              <Button className="gap-2 self-start sm:self-auto" onClick={() => setShowAddFaq(true)}>
                <Plus className="h-4 w-4" />
                Add FAQ
              </Button>
            </div>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Globe className="h-8 w-8 text-blue-500" />
                    <div>
                      <p className="text-2xl font-bold">{groupedFaqs.website.length}</p>
                      <p className="text-xs text-muted-foreground">From Your Website</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Users className="h-8 w-8 text-purple-500" />
                    <div>
                      <p className="text-2xl font-bold">{groupedFaqs.competitor.length}</p>
                      <p className="text-xs text-muted-foreground">From Competitors</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-amber-500" />
                    <div>
                      <p className="text-2xl font-bold">{groupedFaqs.document.length}</p>
                      <p className="text-xs text-muted-foreground">From Documents</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <BookOpen className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="text-2xl font-bold">{faqs.length}</p>
                      <p className="text-xs text-muted-foreground">Total FAQs</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
                  <div className="text-center py-8 text-muted-foreground">Loading FAQs...</div>
                ) : filteredFaqs.length > 0 ? (
                  filteredFaqs.map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">No FAQs found</div>
                )}
              </TabsContent>
              <TabsContent value="website" className="space-y-3">
                {filterByTab(groupedFaqs.website).length > 0 ? (
                  filterByTab(groupedFaqs.website).map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">No website FAQs yet</div>
                )}
              </TabsContent>
              <TabsContent value="competitors" className="space-y-3">
                {filterByTab(groupedFaqs.competitor).length > 0 ? (
                  filterByTab(groupedFaqs.competitor).map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No competitor FAQs yet
                  </div>
                )}
              </TabsContent>
              <TabsContent value="documents" className="space-y-3">
                {filterByTab(groupedFaqs.document).length > 0 ? (
                  filterByTab(groupedFaqs.document).map((faq) => (
                    <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">No document FAQs yet</div>
                )}
              </TabsContent>
            </Tabs>
            {faqs.length === 0 && !loading && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No knowledge yet</h3>
                  <p className="text-muted-foreground text-center mb-4">
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
    <div className="flex h-screen bg-slate-50/50">
      {/* Sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Knowledge Base</h1>
            <Button className="gap-2" onClick={() => setShowAddFaq(true)}>
              <Plus className="h-4 w-4" />
              Add FAQ
            </Button>
          </div>

          {/* Tinted Glass Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-gradient-to-b from-blue-50/80 to-white border border-blue-100 rounded-3xl p-6 shadow-sm">
              <div className="bg-blue-100 text-blue-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <Globe className="h-5 w-5" />
              </div>
              <p className="text-4xl font-extrabold tracking-tight text-slate-900 mt-4">
                {groupedFaqs.website.length}
              </p>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mt-1">
                Website
              </p>
            </div>
            <div className="bg-gradient-to-b from-purple-50/80 to-white border border-purple-100 rounded-3xl p-6 shadow-sm">
              <div className="bg-purple-100 text-purple-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <Users className="h-5 w-5" />
              </div>
              <p className="text-4xl font-extrabold tracking-tight text-slate-900 mt-4">
                {groupedFaqs.competitor.length}
              </p>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mt-1">
                Competitors
              </p>
            </div>
            <div className="bg-gradient-to-b from-amber-50/80 to-white border border-amber-100 rounded-3xl p-6 shadow-sm">
              <div className="bg-amber-100 text-amber-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <p className="text-4xl font-extrabold tracking-tight text-slate-900 mt-4">
                {groupedFaqs.document.length}
              </p>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mt-1">
                Documents
              </p>
            </div>
            <div className="bg-gradient-to-b from-emerald-50/80 to-white border border-emerald-100 rounded-3xl p-6 shadow-sm">
              <div className="bg-emerald-100 text-emerald-600 rounded-2xl w-12 h-12 flex items-center justify-center">
                <BookOpen className="h-5 w-5" />
              </div>
              <p className="text-4xl font-extrabold tracking-tight text-slate-900 mt-4">
                {faqs.length}
              </p>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mt-1">
                Total FAQs
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search FAQs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
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
                <div className="text-center py-8 text-muted-foreground">Loading FAQs...</div>
              ) : filteredFaqs.length > 0 ? (
                filteredFaqs.map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No FAQs found</div>
              )}
            </TabsContent>

            <TabsContent value="website" className="space-y-3">
              {filterByTab(groupedFaqs.website).length > 0 ? (
                filterByTab(groupedFaqs.website).map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No website FAQs yet</div>
              )}
            </TabsContent>

            <TabsContent value="competitors" className="space-y-3">
              {filterByTab(groupedFaqs.competitor).length > 0 ? (
                filterByTab(groupedFaqs.competitor).map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No competitor FAQs yet</div>
              )}
            </TabsContent>

            <TabsContent value="documents" className="space-y-3">
              {filterByTab(groupedFaqs.document).length > 0 ? (
                filterByTab(groupedFaqs.document).map((faq) => (
                  <FAQCard key={faq.id} faq={faq} onDelete={fetchFaqs} onEdit={handleEditFaq} />
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground">No document FAQs yet</div>
              )}
            </TabsContent>
          </Tabs>

          {/* Empty State */}
          {faqs.length === 0 && !loading && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No knowledge yet</h3>
                <p className="text-muted-foreground text-center mb-4">
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
