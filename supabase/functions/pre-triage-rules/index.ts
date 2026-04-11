import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// PRE-TRIAGE DETERMINISTIC RULES ENGINE
// Runs BEFORE the LLM to catch obvious patterns
// with 100% accuracy and zero cost
// ============================================

interface PreTriageResult {
  matched: boolean;
  rule_type: string | null;
  decision_bucket: string | null;
  why_this_needs_you: string | null;
  classification: string | null;
  requires_reply: boolean;
  confidence: number;
  skip_llm: boolean;
}

interface EmailInput {
  from_email: string;
  from_name: string;
  subject: string;
  body: string;
  to_email?: string;
}

// ============================================
// PATTERN DEFINITIONS
// ============================================

const AUTO_HANDLED_SENDER_PATTERNS = [
  // No-reply addresses
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^do-not-reply@/i,
  /^mailer-daemon@/i,

  // Payment & Financial notifications
  /notifications?@stripe\.com$/i,
  /receipts?@stripe\.com$/i,
  /@mail\.stripe\.com$/i,
  /noreply@.*gocardless\.com$/i,
  /notifications?@.*gocardless\.com$/i,
  /messaging-service@.*xero\.com$/i,
  /noreply@.*xero\.com$/i,
  /notifications?@.*freeagent\.com$/i,
  /@.*quickbooks\.intuit\.com$/i,
  /noreply@.*tide\.co$/i,

  // Shipping & Logistics
  /pkginfo@ups\.com$/i,
  /noreply@.*ups\.com$/i,
  /track@.*fedex\.com$/i,
  /noreply@.*royalmail\.com$/i,
  /noreply@.*dpd\.co\.uk$/i,
  /noreply@.*hermes.*\.com$/i,

  // Social & Marketing platforms
  /noreply@.*linkedin\.com$/i,
  /noreply@.*facebook\.com$/i,
  /noreply@.*twitter\.com$/i,
  /noreply@.*instagram\.com$/i,
  /noreply@.*google\.com$/i,

  // Job boards
  /noreply@.*indeed\.com$/i,
  /noreply@.*totaljobs\.com$/i,
  /noreply@.*reed\.co\.uk$/i,

  // Business tools
  /noreply@.*calendly\.com$/i,
  /noreply@.*slack\.com$/i,
  /noreply@.*zoom\.us$/i,
  /noreply@.*teams\.microsoft\.com$/i,

  // System notifications
  /noreply@.*circleloop\.com$/i,
  /alerts?@.*cloudflare\.com$/i,
  /noreply@.*github\.com$/i,

  // Own company system emails
  /noreply@mac-cleaning\.co\.uk$/i,
];

const AUTO_HANDLED_SUBJECT_PATTERNS = [
  // Payment confirmations
  /^receipt for/i,
  /^payment (received|confirmed|successful)/i,
  /^invoice #?\d+/i,
  /^your payment/i,
  /^transaction (complete|confirmed)/i,

  // Shipping notifications
  /^your order (has shipped|is on its way)/i,
  /^shipping confirmation/i,
  /^delivery (update|notification)/i,
  /^tracking number/i,
  /^out for delivery/i,
  /^delivered:/i,

  // Subscriptions
  /^subscription (confirmed|renewed|updated)/i,
  /^welcome to/i,
  /^thank you for (your order|signing up|subscribing)/i,

  // Calendar
  /^calendar (invitation|reminder)/i,
  /^meeting (reminder|scheduled)/i,
  /^invitation:/i,

  // Security/Auth
  /^security (alert|notification)/i,
  /^sign-in (attempt|notification)/i,
  /^password (reset|changed)/i,
  /^verify your email/i,
  /^confirm your email/i,

  // Reports
  /^weekly (report|summary|digest)/i,
  /^monthly (report|summary|digest)/i,
  /^daily (report|summary|digest)/i,
];

const AUTO_HANDLED_BODY_PATTERNS = [
  // Newsletter indicators
  /unsubscribe/i,
  /view (in|this email in) (your )?browser/i,
  /email preferences/i,
  /manage your (email )?preferences/i,
  /update your (email )?preferences/i,
  /click here to unsubscribe/i,
  /opt[ -]?out/i,
  /list-unsubscribe/i,
];

const ACT_NOW_BODY_PATTERNS = [
  // Urgent customer signals
  /\burgent\b/i,
  /\basap\b/i,
  /cancel.*today/i,
  /cancel.*tomorrow/i,
  /cancel.*immediately/i,
  /need.*cancel/i,
  /refund.*request/i,
  /want.*refund/i,
  /demand.*refund/i,
  /complain(t|ing)?/i,
  /disappointed/i,
  /disgusted/i,
  /terrible service/i,
  /worst experience/i,
  /never.*again/i,
  /trading standards/i,
  /ombudsman/i,
  /solicitor/i,
  /lawyer/i,
  /legal action/i,
  /leave.*review/i,
  /bad review/i,
  /social media/i,
];

const QUICK_WIN_SUBJECT_PATTERNS = [
  // Simple confirmation requests
  /^confirm(ation)?:/i,
  /^quick question/i,
  /^can you confirm/i,
  /^please confirm/i,
  /^re: (quote|booking|appointment)/i,
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function matchesAnyPattern(text: string, patterns: RegExp[]): RegExp | null {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return pattern;
    }
  }
  return null;
}

function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || '';
}

// ============================================
// MAIN PRE-TRIAGE FUNCTION
// ============================================

async function runPreTriageRules(
  email: EmailInput,
  senderRules: any[],
  senderBehaviourStats: any | null,
): Promise<PreTriageResult> {
  const fromEmail = email.from_email.toLowerCase();
  const domain = extractDomain(fromEmail);
  const subject = email.subject || '';
  const body = email.body || '';

  console.log('[PreTriage] Checking email from:', fromEmail);

  // ----------------------------------------
  // Priority 1: Check sender_rules table first (user-defined rules)
  // ----------------------------------------
  const matchedRule = senderRules.find((rule) => {
    if (!rule.is_active) return false;
    const pattern = rule.sender_pattern.toLowerCase();
    // Match domain or full email
    return fromEmail.includes(pattern) || domain.includes(pattern);
  });

  if (matchedRule) {
    console.log('[PreTriage] Matched sender rule:', matchedRule.sender_pattern);
    const classification =
      matchedRule.override_classification || matchedRule.default_classification;
    const requiresReply =
      matchedRule.override_requires_reply ?? matchedRule.default_requires_reply ?? false;

    return {
      matched: true,
      rule_type: 'sender_rule',
      decision_bucket: requiresReply ? 'quick_win' : 'auto_handled',
      why_this_needs_you: requiresReply
        ? 'Known sender - review recommended'
        : 'Known sender - auto-handled by rule',
      classification,
      requires_reply: requiresReply,
      confidence: 0.99,
      skip_llm: true,
    };
  }

  // ----------------------------------------
  // Priority 2: Check for ACT_NOW signals (urgent/risk)
  // ----------------------------------------
  const actNowPattern = matchesAnyPattern(body, ACT_NOW_BODY_PATTERNS);
  if (actNowPattern) {
    console.log('[PreTriage] Matched ACT_NOW pattern:', actNowPattern.toString());
    return {
      matched: true,
      rule_type: 'act_now_pattern',
      decision_bucket: 'act_now',
      why_this_needs_you: 'Urgent or risky language detected',
      classification: 'customer_complaint',
      requires_reply: true,
      confidence: 0.85,
      skip_llm: false, // Still send to LLM for better analysis
    };
  }

  // ----------------------------------------
  // Priority 3: Check AUTO_HANDLED sender patterns
  // ----------------------------------------
  const autoSenderPattern = matchesAnyPattern(fromEmail, AUTO_HANDLED_SENDER_PATTERNS);
  if (autoSenderPattern) {
    console.log('[PreTriage] Matched auto-handled sender:', autoSenderPattern.toString());
    return {
      matched: true,
      rule_type: 'auto_sender_pattern',
      decision_bucket: 'auto_handled',
      why_this_needs_you: 'Automated notification - no action needed',
      classification: 'automated_notification',
      requires_reply: false,
      confidence: 0.98,
      skip_llm: true,
    };
  }

  // ----------------------------------------
  // Priority 4: Check AUTO_HANDLED subject patterns
  // ----------------------------------------
  const autoSubjectPattern = matchesAnyPattern(subject, AUTO_HANDLED_SUBJECT_PATTERNS);
  if (autoSubjectPattern) {
    console.log('[PreTriage] Matched auto-handled subject:', autoSubjectPattern.toString());
    return {
      matched: true,
      rule_type: 'auto_subject_pattern',
      decision_bucket: 'auto_handled',
      why_this_needs_you: 'Automated notification - no action needed',
      classification: 'receipt_confirmation',
      requires_reply: false,
      confidence: 0.95,
      skip_llm: true,
    };
  }

  // ----------------------------------------
  // Priority 5: Check for newsletter/marketing indicators in body
  // ----------------------------------------
  const autoBodyPattern = matchesAnyPattern(body, AUTO_HANDLED_BODY_PATTERNS);
  if (autoBodyPattern) {
    console.log(
      '[PreTriage] Matched auto-handled body pattern (newsletter):',
      autoBodyPattern.toString(),
    );
    return {
      matched: true,
      rule_type: 'newsletter_pattern',
      decision_bucket: 'auto_handled',
      why_this_needs_you: 'Newsletter/marketing - no action needed',
      classification: 'marketing_newsletter',
      requires_reply: false,
      confidence: 0.92,
      skip_llm: true,
    };
  }

  // ----------------------------------------
  // Priority 6: Check QUICK_WIN subject patterns
  // ----------------------------------------
  const quickWinPattern = matchesAnyPattern(subject, QUICK_WIN_SUBJECT_PATTERNS);
  if (quickWinPattern) {
    console.log('[PreTriage] Matched quick-win subject:', quickWinPattern.toString());
    return {
      matched: true,
      rule_type: 'quick_win_pattern',
      decision_bucket: 'quick_win',
      why_this_needs_you: 'Simple confirmation request',
      classification: 'customer_inquiry',
      requires_reply: true,
      confidence: 0.8,
      skip_llm: false, // Still send to LLM for drafting
    };
  }

  // ----------------------------------------
  // Priority 7: Use sender behaviour stats for bias
  // ----------------------------------------
  if (senderBehaviourStats) {
    const replyRate = senderBehaviourStats.reply_rate || 0;
    const ignoredRate = senderBehaviourStats.ignored_rate || 0;

    // High ignore rate = likely auto-handled
    if (ignoredRate > 0.8 && senderBehaviourStats.total_messages >= 3) {
      console.log('[PreTriage] High ignore rate sender:', ignoredRate);
      return {
        matched: true,
        rule_type: 'behaviour_ignored',
        decision_bucket: 'auto_handled',
        why_this_needs_you: 'Historically ignored sender',
        classification: 'informational_only',
        requires_reply: false,
        confidence: 0.85,
        skip_llm: true,
      };
    }

    // VIP sender (high reply rate)
    if (replyRate > 0.8 && senderBehaviourStats.total_messages >= 3) {
      console.log('[PreTriage] High reply-rate sender (VIP):', replyRate);
      return {
        matched: true,
        rule_type: 'behaviour_vip',
        decision_bucket: 'act_now',
        why_this_needs_you: 'Important sender - high engagement history',
        classification: 'customer_inquiry',
        requires_reply: true,
        confidence: 0.85,
        skip_llm: false, // Still analyze for nuance
      };
    }
  }

  // ----------------------------------------
  // No match - pass to LLM
  // ----------------------------------------
  console.log('[PreTriage] No pattern matched, passing to LLM');
  return {
    matched: false,
    rule_type: null,
    decision_bucket: null,
    why_this_needs_you: null,
    classification: null,
    requires_reply: true,
    confidence: 0,
    skip_llm: false,
  };
}

// ============================================
// HTTP HANDLER
// ============================================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { email, workspace_id } = await req.clone().json();

    if (!email?.from_email) {
      return new Response(JSON.stringify({ error: 'Missing email data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const auth = await validateAuth(req, workspace_id);
    const workspaceId = auth.workspaceId;

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Fetch sender rules for this workspace
    const { data: senderRules } = await supabase
      .from('sender_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    // Fetch sender behaviour stats if available
    const domain = extractDomain(email.from_email);
    const { data: behaviourStats } = await supabase
      .from('sender_behaviour_stats')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('sender_domain', domain)
      .maybeSingle();

    // Run pre-triage rules
    const result = await runPreTriageRules(email, senderRules || [], behaviourStats);

    const processingTime = Date.now() - startTime;
    console.log('[PreTriage] Result:', {
      matched: result.matched,
      rule_type: result.rule_type,
      bucket: result.decision_bucket,
      skip_llm: result.skip_llm,
      processing_time_ms: processingTime,
    });

    return new Response(
      JSON.stringify({
        ...result,
        processing_time_ms: processingTime,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PreTriage] Error:', error);
    return new Response(
      JSON.stringify({
        error: errorMessage,
        matched: false,
        skip_llm: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
