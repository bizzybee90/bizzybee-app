import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Globe,
  Loader2,
  CheckCircle,
  FileText,
  MapPin,
  Search,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

interface WebsiteScrapeProps {
  workspaceId: string;
  onComplete: () => void;
}

interface ScrapeJob {
  id: string;
  status: string;
  pages_found: number;
  pages_scraped: number;
  pages_extracted: number;
  faqs_extracted: number;
  ground_truth_facts: number;
  business_info: any;
  error_message: string | null;
  search_keywords: string[];
}

type JobStatus = 'pending' | 'mapping' | 'scraping' | 'extracting' | 'completed' | 'failed';

const STATUS_CONFIG: Record<JobStatus, { label: string; icon: React.ReactNode; progress: number }> =
  {
    pending: {
      label: 'Starting...',
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      progress: 5,
    },
    mapping: {
      label: 'Discovering pages...',
      icon: <Search className="h-4 w-4 animate-pulse" />,
      progress: 15,
    },
    scraping: {
      label: 'Reading website content...',
      icon: <Globe className="h-4 w-4 animate-pulse" />,
      progress: 40,
    },
    extracting: {
      label: 'Extracting FAQs & knowledge...',
      icon: <Sparkles className="h-4 w-4 animate-pulse" />,
      progress: 75,
    },
    completed: {
      label: 'Complete!',
      icon: <CheckCircle className="h-4 w-4 text-primary" />,
      progress: 100,
    },
    failed: {
      label: 'Failed',
      icon: <AlertCircle className="h-4 w-4 text-destructive" />,
      progress: 0,
    },
  };

export const WebsiteScrape = ({ workspaceId, onComplete }: WebsiteScrapeProps) => {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<ScrapeJob | null>(null);

  // Subscribe to job updates
  useEffect(() => {
    if (!job?.id) return;

    const channel = supabase
      .channel(`website_scrape_${job.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scraping_jobs',
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          const updatedJob = payload.new as ScrapeJob;
          setJob(updatedJob);

          if (updatedJob.status === 'completed') {
            toast.success(`Extracted ${updatedJob.faqs_extracted} FAQs from your website!`);
            setLoading(false);
          } else if (updatedJob.status === 'failed') {
            toast.error(updatedJob.error_message || 'Failed to analyze website');
            setLoading(false);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job?.id]);

  const startScrape = async () => {
    if (!websiteUrl.trim()) {
      toast.error('Please enter your website URL');
      return;
    }

    // Normalize URL
    let url = websiteUrl.trim();
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('start-own-website-analysis', {
        body: {
          workspace_id: workspaceId,
          website_url: url,
          trigger_source: 'onboarding_website_scrape_card',
        },
      });

      if (error) throw error;

      // Set initial job state
      setJob({
        id: data.job_id,
        status: data.status || 'pending',
        pages_found: data.pages_found || 0,
        pages_scraped: data.pages_scraped || 0,
        pages_extracted: 0,
        faqs_extracted: 0,
        ground_truth_facts: 0,
        business_info: null,
        error_message: null,
        search_keywords: [],
      });
    } catch (e: any) {
      toast.error(e.message || 'Failed to start website analysis');
      setLoading(false);
    }
  };

  // Calculate dynamic progress based on actual pages
  const calculateProgress = () => {
    if (!job) return 0;

    const status = job.status as JobStatus;
    const baseProgress = STATUS_CONFIG[status]?.progress || 0;

    if (status === 'scraping' && job.pages_found > 0) {
      const scrapeProgress = (job.pages_scraped / job.pages_found) * 35; // 35% for scraping phase
      return 15 + scrapeProgress; // Start at 15% (after mapping)
    }

    if (status === 'extracting') {
      // Extraction is mostly one big step, but show some progress
      return 75;
    }

    return baseProgress;
  };

  // Completed state
  if (job?.status === 'completed') {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle className="h-12 w-12 text-primary" />

            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Website Analyzed!</h3>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2 justify-center">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span>
                    <strong>{job.faqs_extracted}</strong> FAQs extracted
                  </span>
                </div>
                <div className="flex items-center gap-2 justify-center">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>
                    <strong>{job.ground_truth_facts}</strong> facts captured
                  </span>
                </div>
                <div className="flex items-center gap-2 justify-center">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span>
                    <strong>{job.pages_scraped}</strong> pages analyzed
                  </span>
                </div>
                {job.search_keywords?.length > 0 && (
                  <div className="flex items-center gap-2 justify-center">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span>
                      <strong>{job.search_keywords.length}</strong> keywords found
                    </span>
                  </div>
                )}
              </div>

              {job.business_info?.name && (
                <p className="text-sm text-muted-foreground">
                  Business: <strong>{job.business_info.name}</strong>
                </p>
              )}

              {job.business_info?.services && job.business_info.services.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Services: {job.business_info.services.slice(0, 3).join(', ')}
                  {job.business_info.services.length > 3 && '...'}
                </p>
              )}
            </div>

            <p className="text-sm text-muted-foreground max-w-md">
              These FAQs are your "gold standard" - they'll always take priority over competitor
              content.
            </p>

            <Button onClick={onComplete} className="mt-2">
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Failed state
  if (job?.status === 'failed') {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />

            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Analysis Failed</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                {job.error_message ||
                  'Could not analyze website. Please check the URL and try again.'}
              </p>
            </div>

            <Button
              onClick={() => {
                setJob(null);
                setLoading(false);
              }}
              variant="outline"
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading/progress state
  if (loading && job) {
    const status = (job.status as JobStatus) || 'pending';
    const config = STATUS_CONFIG[status];
    const progress = calculateProgress();

    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="relative">
              <Globe className="h-12 w-12 text-primary" />
              <div className="absolute -right-1 -bottom-1 bg-background rounded-full p-1">
                {config.icon}
              </div>
            </div>

            <div className="w-full max-w-md space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{config.label}</span>
                  <span className="text-muted-foreground">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>

              {/* Progress details */}
              <div className="flex justify-center gap-6 text-sm text-muted-foreground">
                {job.pages_found > 0 && (
                  <div className="flex items-center gap-1">
                    <Search className="h-3 w-3" />
                    <span>{job.pages_found} pages found</span>
                  </div>
                )}
                {job.pages_scraped > 0 && (
                  <div className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    <span>{job.pages_scraped} scraped</span>
                  </div>
                )}
                {job.faqs_extracted > 0 && (
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <span>{job.faqs_extracted} FAQs</span>
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">This usually takes 30-60 seconds</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Initial input state
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <CardTitle>Your Website</CardTitle>
        </div>
        <CardDescription>
          We'll analyze your website to extract FAQs, pricing, services, and learn your
          communication style
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="websiteUrl">Website URL</Label>
          <Input
            id="websiteUrl"
            placeholder="www.yourcompany.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startScrape()}
          />
        </div>

        <Button onClick={startScrape} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Starting analysis...
            </>
          ) : (
            <>
              <Globe className="mr-2 h-4 w-4" />
              Analyze My Website
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          We'll scan your homepage, services, pricing, FAQ, and about pages
        </p>
      </CardContent>
    </Card>
  );
};
