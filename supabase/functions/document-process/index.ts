import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessRequest {
  workspace_id: string;
  document_id?: string;
  action: 'process' | 'extract_faqs' | 'delete' | 'list';
}

// Helper function to chunk text
function chunkText(text: string, chunkSize: number, overlap: number): { text: string; page: number }[] {
  const chunks: { text: string; page: number }[] = [];
  let start = 0;
  let page = 1;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunkText = text.slice(start, end);
    
    if (chunkText.trim().length > 50) { // Only add meaningful chunks
      chunks.push({
        text: chunkText,
        page
      });
    }
    
    start = end - overlap;
    if (start >= text.length - overlap) break;
    page++;
  }

  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // --- AUTH CHECK ---
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  // --- END AUTH CHECK ---

  const startTime = Date.now();
  const functionName = 'document-process';

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: ProcessRequest = await req.json();
    console.log(`[${functionName}] Starting:`, body);

    if (!body.workspace_id) throw new Error('workspace_id is required');
    if (!body.action) throw new Error('action is required');

    let result: any;

    switch (body.action) {
      case 'list': {
        const { data: documents, error } = await supabase
          .from('documents')
          .select('id, name, file_type, file_size, status, page_count, processed_at, created_at')
          .eq('workspace_id', body.workspace_id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        result = { documents: documents || [] };
        break;
      }

      case 'process': {
        if (!body.document_id) throw new Error('document_id is required');

        // Fetch document
        const { data: document, error: docError } = await supabase
          .from('documents')
          .select('*')
          .eq('id', body.document_id)
          .eq('workspace_id', body.workspace_id)
          .single();

        if (docError || !document) throw new Error('Document not found');

        // Update status
        await supabase
          .from('documents')
          .update({ status: 'processing' })
          .eq('id', body.document_id);

        // Download file from storage
        const { data: fileData, error: downloadError } = await supabase
          .storage
          .from('documents')
          .download(document.file_path);

        if (downloadError) {
          await supabase.from('documents').update({ 
            status: 'failed', 
            error_message: `Download failed: ${downloadError.message}` 
          }).eq('id', body.document_id);
          throw new Error(`Download failed: ${downloadError.message}`);
        }

        // Extract text based on file type
        let extractedText = '';
        const fileType = document.file_type?.toLowerCase() || '';
        
        if (['txt', 'md', 'text', 'markdown'].includes(fileType)) {
          extractedText = await fileData.text();
        } else if (fileType === 'json') {
          const json = await fileData.text();
          extractedText = JSON.stringify(JSON.parse(json), null, 2);
        } else if (fileType === 'csv') {
          extractedText = await fileData.text();
        } else {
          // For PDF and other formats, try basic text extraction
          try {
            extractedText = await fileData.text();
          } catch {
            extractedText = 'Unable to extract text from this file format';
          }
        }

        console.log(`[${functionName}] Extracted ${extractedText.length} characters from ${document.name}`);

        // Chunk the text (roughly 500 tokens per chunk with overlap)
        const chunks = chunkText(extractedText, 2000, 200);
        console.log(`[${functionName}] Created ${chunks.length} chunks`);

        // Delete existing chunks for this document
        await supabase
          .from('document_chunks')
          .delete()
          .eq('document_id', body.document_id);

        // Generate embeddings and store chunks
        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
        let chunksWithEmbeddings = 0;

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          let embedding = null;

          // Generate embedding if OpenAI key is available
          if (OPENAI_API_KEY) {
            try {
              const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${OPENAI_API_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model: 'text-embedding-3-small',
                  input: chunk.text
                })
              });

              if (embeddingResponse.ok) {
                const embeddingData = await embeddingResponse.json();
                embedding = embeddingData.data?.[0]?.embedding;
                if (embedding) chunksWithEmbeddings++;
              }
            } catch (e) {
              console.error(`[${functionName}] Embedding failed for chunk ${i}:`, e);
            }
          }

          // Store chunk (with or without embedding)
          const { error: insertError } = await supabase.from('document_chunks').insert({
            document_id: body.document_id,
            workspace_id: body.workspace_id,
            chunk_index: i,
            content: chunk.text,
            page_number: chunk.page,
            embedding: embedding ? JSON.stringify(embedding) : null
          });

          if (insertError) {
            console.error(`[${functionName}] Failed to insert chunk ${i}:`, insertError);
          }
        }

        // Update document status
        await supabase
          .from('documents')
          .update({
            status: 'processed',
            extracted_text: extractedText.slice(0, 50000), // Store truncated
            page_count: chunks.length,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', body.document_id);

        result = { 
          chunks_created: chunks.length,
          chunks_with_embeddings: chunksWithEmbeddings,
          text_length: extractedText.length
        };
        break;
      }

      case 'extract_faqs': {
        if (!body.document_id) throw new Error('document_id is required');

        // Fetch document
        const { data: document, error: docError } = await supabase
          .from('documents')
          .select('id, name, workspace_id')
          .eq('id', body.document_id)
          .eq('workspace_id', body.workspace_id)
          .single();

        if (docError || !document) throw new Error('Document not found');

        // Get document chunks
        const { data: chunks } = await supabase
          .from('document_chunks')
          .select('content')
          .eq('document_id', body.document_id)
          .order('chunk_index')
          .limit(20);

        if (!chunks?.length) throw new Error('No chunks found - process document first');

        const documentContent = chunks.map(c => c.content).join('\n\n');

        // Extract FAQs with Claude
        const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
        if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

        const extractPrompt = `Extract FAQs from this document content. Create Q&A pairs for any information a customer might ask about.

Document: ${document.name}

Content:
${documentContent.slice(0, 15000)}

Generate JSON array of FAQs:
[
  {
    "question": "Natural question a customer might ask",
    "answer": "Complete answer from the document",
    "category": "Pricing|Services|Policies|General"
  }
]

Extract 10-20 meaningful FAQs. Only use information actually in the document.`;

        const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6-20250514',
            max_tokens: 4096,
            system: 'Extract FAQs from documents. Respond with valid JSON array only.',
            messages: [
              { role: 'user', content: extractPrompt }
            ]
          })
        });

        if (!aiResponse.ok) throw new Error('FAQ extraction failed');

        const aiData = await aiResponse.json();
        const faqsText = aiData.content?.[0]?.text || '[]';
        
        let faqs;
        try {
          const jsonMatch = faqsText.match(/\[[\s\S]*\]/);
          faqs = JSON.parse(jsonMatch?.[0] || '[]');
        } catch {
          faqs = [];
        }

        console.log(`[${functionName}] Extracted ${faqs.length} FAQs from document`);

        // Insert FAQs into faq_database
        const faqRecords = faqs.map((faq: any) => ({
          workspace_id: body.workspace_id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category || 'General',
          source_url: `document://${document.name}`,
          generation_source: 'document',
          is_own_content: true,
          priority: 7 // Lower than website (9-10) but decent
        }));

        if (faqRecords.length > 0) {
          const { error: faqError } = await supabase.from('faq_database').insert(faqRecords);
          if (faqError) {
            console.error(`[${functionName}] FAQ insert error:`, faqError);
          }
        }

        result = { faqs_extracted: faqRecords.length };
        break;
      }

      case 'delete': {
        if (!body.document_id) throw new Error('document_id is required');

        // Fetch document
        const { data: document, error: docError } = await supabase
          .from('documents')
          .select('file_path')
          .eq('id', body.document_id)
          .eq('workspace_id', body.workspace_id)
          .single();

        if (docError || !document) throw new Error('Document not found');

        // Delete chunks first
        await supabase
          .from('document_chunks')
          .delete()
          .eq('document_id', body.document_id);

        // Delete document record
        await supabase
          .from('documents')
          .delete()
          .eq('id', body.document_id);

        // Delete from storage
        if (document.file_path) {
          await supabase.storage
            .from('documents')
            .remove([document.file_path]);
        }

        result = { deleted: true };
        break;
      }

      default:
        throw new Error(`Unknown action: ${body.action}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[${functionName}] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ success: true, ...result, duration_ms: duration }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${functionName}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: error.message, function: functionName }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
