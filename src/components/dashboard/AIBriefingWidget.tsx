import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export const AIBriefingWidget = () => {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [conversationCount, setConversationCount] = useState(0);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      // Get workspace ID
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setSummary("Please log in to see your email briefing.");
        return;
      }

      const { data: userProfile } = await supabase
        .from('users')
        .select('workspace_id')
        .eq('id', userData.user.id)
        .single();

      if (!userProfile?.workspace_id) {
        setSummary("No workspace configured.");
        return;
      }

      // Daily briefing will be generated once the AI pipeline processes new emails
      setSummary(null);
      setConversationCount(0);
    } catch (error) {
      console.error('Error fetching AI summary:', error);
      setSummary("Unable to generate summary at the moment.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/50 dark:border-amber-800/50">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-amber-600 animate-spin" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Generating your briefing...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200/50 dark:border-amber-800/50">
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                {getGreeting()}!
              </h3>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => fetchSummary(true)}
                disabled={refreshing}
                className="text-amber-700 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            {summary ? (
              <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
                {summary}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed italic">
                Your daily briefing will appear here once BizzyBee has processed new emails.
              </p>
            )}
            {conversationCount > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                Based on {conversationCount} email{conversationCount !== 1 ? 's' : ''} from the last 24 hours
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
