import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, authErrorResponse, validateAuth } from '../_shared/auth.ts';
import {
  FeatureGuardError,
  featureGuardErrorResponse,
  requireFeature,
} from '../_shared/entitlements.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AudioRequest {
  workspace_id?: string;
  audio_url: string;
  message_id?: string;
  customer_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const functionName = 'audio-process';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: AudioRequest = await req.clone().json();
    console.log(`[${functionName}] Request:`, {
      workspace_hint: body.workspace_id ?? null,
      message_id: body.message_id ?? null,
      has_audio: !!body.audio_url,
    });

    if (!body.audio_url) throw new Error('audio_url is required');

    let workspaceId = body.workspace_id?.trim();

    if (body.message_id) {
      const { data: message, error: messageError } = await supabase
        .from('messages')
        .select('id, conversation_id')
        .eq('id', body.message_id)
        .maybeSingle();

      if (messageError) {
        throw new Error(`Failed to resolve message workspace: ${messageError.message}`);
      }

      if (!message?.conversation_id) {
        throw new Error('Message not found');
      }

      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('id, workspace_id')
        .eq('id', message.conversation_id)
        .maybeSingle();

      if (conversationError) {
        throw new Error(`Failed to resolve conversation workspace: ${conversationError.message}`);
      }

      if (!conversation?.workspace_id) {
        throw new Error('Conversation not found');
      }

      workspaceId = conversation.workspace_id;
    }

    if (!workspaceId) {
      throw new Error('workspace_id or message_id is required');
    }

    const auth = await validateAuth(req, workspaceId);
    workspaceId = auth.workspaceId;

    await requireFeature({
      supabase,
      workspaceId,
      featureKey: 'ai_inbox',
      functionName,
      action: 'process_audio',
      context: {
        authUserId: auth.userId,
        messageId: body.message_id ?? null,
      },
    });

    // Check for OpenAI API key (needed for Whisper)
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured - needed for audio transcription');
    }

    // Download audio file
    console.log(`[${functionName}] Downloading audio...`);
    let audioBlob: Blob;

    try {
      // Check if it's a Supabase storage URL
      if (body.audio_url.includes('supabase') && body.audio_url.includes('/storage/')) {
        const pathMatch = body.audio_url.match(/\/storage\/v1\/object\/public\/([^?]+)/);
        if (pathMatch) {
          const [bucket, ...pathParts] = pathMatch[1].split('/');
          const filePath = pathParts.join('/');
          const { data, error } = await supabase.storage.from(bucket).download(filePath);
          if (error) throw error;
          audioBlob = data;
        } else {
          throw new Error('Invalid Supabase storage URL');
        }
      } else {
        // External URL
        const audioResponse = await fetch(body.audio_url);
        if (!audioResponse.ok) {
          throw new Error(`Failed to download audio: ${audioResponse.status}`);
        }
        audioBlob = await audioResponse.blob();
      }
    } catch (downloadError: any) {
      throw new Error(`Audio download failed: ${downloadError.message}`);
    }

    console.log(`[${functionName}] Audio downloaded, size: ${audioBlob.size} bytes`);

    // Transcribe with OpenAI Whisper
    console.log(`[${functionName}] Transcribing with Whisper...`);

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      throw new Error(`Whisper API error: ${whisperResponse.status} - ${errorText}`);
    }

    const transcription = await whisperResponse.json();
    const transcript = transcription.text || '';
    const duration = transcription.duration || 0;

    console.log(
      `[${functionName}] Transcription complete: ${transcript.length} chars, ${duration}s`,
    );

    if (!transcript) {
      throw new Error('No transcription generated');
    }

    // Analyze voicemail content with AI
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Get business context
    const { data: businessProfile } = await supabase
      .from('business_profile')
      .select('business_name, industry, services')
      .eq('workspace_id', workspaceId)
      .single();

    const analysisPrompt = `Analyze this voicemail transcription for a ${businessProfile?.industry || 'business'}.

VOICEMAIL TRANSCRIPT:
"${transcript}"

${body.customer_name ? `Caller: ${body.customer_name}` : ''}
Duration: ${Math.round(duration)} seconds

Analyze and extract:
1. Caller's sentiment and urgency level
2. Main purpose of the call
3. Key information (names, numbers, dates mentioned)
4. What action is needed
5. A suggested professional response

Return JSON:
{
  "summary": "Brief 1-2 sentence summary of the voicemail",
  "caller_sentiment": "positive|neutral|negative|urgent",
  "urgency": "high|medium|low",
  "purpose": "inquiry|complaint|follow_up|appointment|quote_request|other",
  "extracted_info": {
    "names_mentioned": [],
    "phone_numbers": [],
    "dates_times": [],
    "amounts": [],
    "key_details": []
  },
  "action_required": "description of what needs to be done",
  "suggested_response": "Professional response to send or talking points for callback"
}`;

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6-20250514',
        max_tokens: 1024,
        system:
          'You are an expert at analyzing voicemail messages for businesses. Extract actionable information. Return valid JSON only.',
        messages: [{ role: 'user', content: analysisPrompt }],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`Anthropic API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.content?.[0]?.text || '';

    // Parse analysis
    let analysis;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      analysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[${functionName}] Failed to parse analysis:`, analysisText);
      analysis = {
        summary: transcript.slice(0, 200),
        caller_sentiment: 'neutral',
        urgency: 'medium',
        purpose: 'other',
        extracted_info: {},
        action_required: 'Review and respond to voicemail',
        suggested_response:
          'Thank you for your call. We received your voicemail and will get back to you shortly.',
      };
    }

    console.log(`[${functionName}] Analysis complete:`, {
      sentiment: analysis.caller_sentiment,
      urgency: analysis.urgency,
      purpose: analysis.purpose,
    });

    // Store voicemail transcript
    const { data: storedTranscript, error: insertError } = await supabase
      .from('voicemail_transcripts')
      .insert({
        workspace_id: workspaceId,
        message_id: body.message_id,
        audio_url: body.audio_url,
        duration_seconds: Math.round(duration),
        transcript: transcript,
        summary: analysis.summary,
        caller_sentiment: analysis.caller_sentiment,
        extracted_info: analysis.extracted_info,
        suggested_response: analysis.suggested_response,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(`[${functionName}] Failed to store transcript:`, insertError);
    }

    // Update message if provided
    if (body.message_id) {
      await supabase
        .from('messages')
        .update({
          is_voicemail: true,
          audio_url: body.audio_url,
        })
        .eq('id', body.message_id);
    }

    const processingDuration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${processingDuration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        transcript_id: storedTranscript?.id,
        transcript: transcript,
        duration_seconds: Math.round(duration),
        analysis: {
          summary: analysis.summary,
          sentiment: analysis.caller_sentiment,
          urgency: analysis.urgency,
          purpose: analysis.purpose,
          extracted_info: analysis.extracted_info,
          action_required: analysis.action_required,
        },
        suggested_response: analysis.suggested_response,
        duration_ms: processingDuration,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    if (error instanceof AuthError) {
      return authErrorResponse(error);
    }
    if (error instanceof FeatureGuardError) {
      return featureGuardErrorResponse(error, corsHeaders);
    }
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        function: functionName,
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
