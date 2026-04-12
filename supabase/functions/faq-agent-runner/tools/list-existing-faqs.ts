import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface ExistingFaq {
  id: string;
  question: string;
  answer: string;
  category: string;
  source_url: string | null;
}

export async function handleListExistingFaqs(
  supabase: SupabaseClient,
  input: { workspace_id: string },
): Promise<{ faqs: ExistingFaq[]; count: number }> {
  const { data, error } = await supabase
    .from('faq_database')
    .select('id, question, answer, category, source_url')
    .eq('workspace_id', input.workspace_id)
    .eq('is_active', true)
    .eq('enabled', true)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(`Failed to load existing FAQs: ${error.message}`);

  const faqs = (data ?? []).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category,
    source_url: row.source_url,
  }));

  return { faqs, count: faqs.length };
}
