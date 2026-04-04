import { validateAuth, AuthError, authErrorResponse } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let auth;
    try {
      auth = await validateAuth(req);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err);
      throw err;
    }

    const { workspaceId } = auth;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate date boundaries
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Calls today
    const { count: callsToday } = await supabase
      .from('call_logs')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .gte('start_time', todayMidnight);

    // Calls this week
    const { count: callsThisWeek } = await supabase
      .from('call_logs')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .gte('start_time', sevenDaysAgo);

    // Average duration and resolution rate from completed calls
    const { data: completedCalls } = await supabase
      .from('call_logs')
      .select('duration_seconds, outcome')
      .eq('workspace_id', workspaceId)
      .eq('status', 'completed');

    let avgDuration = 0;
    let resolutionRate = 0;

    if (completedCalls && completedCalls.length > 0) {
      const durations = completedCalls
        .map(c => c.duration_seconds)
        .filter((d): d is number => d != null);

      if (durations.length > 0) {
        avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      }

      const resolvedCount = completedCalls.filter(c => c.outcome === 'resolved').length;
      resolutionRate = Math.round((resolvedCount / completedCalls.length) * 100);
    }

    // Usage for current month
    const { data: usageData } = await supabase
      .from('ai_phone_usage')
      .select('total_minutes, overage_minutes')
      .eq('workspace_id', workspaceId)
      .gte('period_start', currentMonthStart)
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    const minutesUsed = usageData?.total_minutes ?? 0;
    const includedMinutes = 100; // Growth tier default; will be dynamic later
    const overageMinutes = usageData?.overage_minutes ?? 0;

    return new Response(
      JSON.stringify({
        calls_today: callsToday ?? 0,
        calls_this_week: callsThisWeek ?? 0,
        avg_duration_seconds: avgDuration,
        resolution_rate: resolutionRate,
        usage: {
          minutes_used: minutesUsed,
          included_minutes: includedMinutes,
          overage_minutes: overageMinutes,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('retell-call-stats error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
