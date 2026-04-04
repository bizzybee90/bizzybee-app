import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';

interface VoiceDNA {
  openers: { phrase: string; frequency: number }[];
  closers: { phrase: string; frequency: number }[];
  tics: string[];
  tone_keywords: string[];
  avg_response_length: number;
  emoji_usage: string;
}

interface PlaybookEntry {
  category: string;
  frequency: number;
  golden_example?: {
    customer: string;
    owner: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  quote_request: 'Quote Requests',
  booking_request: 'Booking Requests',
  general_inquiry: 'General Inquiries',
  complaint: 'Complaints',
  notification: 'Notifications',
  newsletter: 'Newsletters',
  spam: 'Spam',
  payment_billing: 'Payment & Billing',
  scheduling_inquiry: 'Scheduling',
  complaint_response: 'Complaint Response',
  service_termination: 'Cancellation',
  additional_services: 'Additional Services',
};

export async function generateLearningReportPDF(
  workspaceId: string,
  companyName?: string,
): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Dynamic table pagination for PDF export — tables may not be in generated types.
  // Internal query builder uses `unknown` with explicit result typing.
  const fetchAll = async <T>(
    table: string,
    select: string,
    build?: (q: unknown) => unknown,
  ): Promise<T[]> => {
    const pageSize = 1000;
    let from = 0;
    const rows: T[] = [];
    while (true) {
      let q: unknown = (supabase as unknown as { from: (t: string) => unknown }).from(table);
      q = (q as { select: (s: string) => unknown }).select(select);
      q = (q as { eq: (c: string, v: string) => unknown }).eq('workspace_id', workspaceId);
      q = (q as { range: (f: number, t: number) => unknown }).range(from, from + pageSize - 1);
      if (build) q = build(q);
      const { data, error } = await (q as Promise<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>);
      if (error) throw error;
      const page = (data || []) as T[];
      rows.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  // Helper functions
  const addTitle = (text: string, size = 18) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', 'bold');
    doc.text(text, margin, y);
    y += size * 0.5 + 4;
  };

  const addSubtitle = (text: string) => {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(text, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 8;
  };

  const addText = (text: string, indent = 0) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    doc.text(lines, margin + indent, y);
    y += lines.length * 5 + 2;
  };

  const addBullet = (text: string) => {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('•', margin + 5, y);
    const lines = doc.splitTextToSize(text, contentWidth - 15);
    doc.text(lines, margin + 12, y);
    y += lines.length * 5 + 2;
  };

  const checkPageBreak = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  };

  const addSpacer = (height = 8) => {
    y += height;
  };

  // Fetch all data
  const [profileResult, emails, examples] = await Promise.all([
    supabase
      .from('voice_profiles')
      .select('voice_dna, playbook, emails_analyzed')
      .eq('workspace_id', workspaceId)
      .single(),
    fetchAll<{ category: string | null }>('email_import_queue', 'category', (q) =>
      q.not('category', 'is', null),
    ),
    fetchAll<{ category: string | null }>('example_responses', 'category'),
  ]);

  const voiceDNA = profileResult.data?.voice_dna as unknown as VoiceDNA | null;
  const playbook = profileResult.data?.playbook as unknown as PlaybookEntry[] | null;
  const emailsAnalyzed = profileResult.data?.emails_analyzed || 0;

  // Aggregate category counts
  const categoryCounts: Record<string, number> = {};
  (emails || []).forEach((row) => {
    const cat = row.category || 'unknown';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const totalEmails = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);

  // Example counts by category
  const exampleCounts: Record<string, number> = {};
  (examples || []).forEach((row) => {
    const cat = row.category || 'general';
    exampleCounts[cat] = (exampleCounts[cat] || 0) + 1;
  });

  // ===== HEADER =====
  doc.setFillColor(245, 245, 250);
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('BizzyBee AI Learning Report', margin, 25);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(companyName || 'Your Business', margin, 35);
  doc.text(
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    pageWidth - margin - 50,
    35,
  );

  doc.setTextColor(0, 0, 0);
  y = 55;

  // ===== SUMMARY =====
  addTitle('Summary', 14);
  addText(
    `Analyzed ${totalEmails.toLocaleString()} emails and ${emailsAnalyzed} conversation pairs to create your personalized AI assistant.`,
  );
  addSpacer();

  // ===== CLASSIFICATION BREAKDOWN =====
  addTitle('Email Classification', 14);
  addText('Your inbox has been automatically sorted into the following categories:');
  addSpacer(4);

  sortedCategories.slice(0, 8).forEach(([category, count]) => {
    const percentage = ((count / totalEmails) * 100).toFixed(1);
    const label = CATEGORY_LABELS[category] || category;
    addBullet(`${label}: ${count.toLocaleString()} emails (${percentage}%)`);
  });
  addSpacer();

  // ===== VOICE DNA =====
  checkPageBreak(60);
  addTitle('Your Voice DNA', 14);

  if (voiceDNA) {
    addText('BizzyBee learned your unique communication style:');
    addSpacer(4);

    if (voiceDNA.tone_keywords?.length > 0) {
      addSubtitle('Tone');
      addText(voiceDNA.tone_keywords.slice(0, 5).join(', '), 5);
      addSpacer(4);
    }

    if (voiceDNA.openers?.length > 0) {
      addSubtitle('How you start emails');
      voiceDNA.openers.slice(0, 3).forEach((opener) => {
        const pct = Math.round(opener.frequency * 100);
        addBullet(`"${opener.phrase}" (${pct}% of emails)`);
      });
      addSpacer(4);
    }

    if (voiceDNA.closers?.length > 0) {
      addSubtitle('How you end emails');
      voiceDNA.closers.slice(0, 3).forEach((closer) => {
        const pct = Math.round(closer.frequency * 100);
        addBullet(`"${closer.phrase}" (${pct}% of emails)`);
      });
      addSpacer(4);
    }

    if (voiceDNA.tics?.length > 0) {
      addSubtitle('Your unique style');
      voiceDNA.tics.slice(0, 4).forEach((tic) => {
        addBullet(tic.charAt(0).toUpperCase() + tic.slice(1));
      });
      addSpacer(4);
    }

    addSubtitle('Stats');
    addText(`Average response length: ${voiceDNA.avg_response_length || '~50'} words`, 5);
    addText(`Emoji usage: ${voiceDNA.emoji_usage || 'Rarely'}`, 5);
  } else {
    addText('Voice profile not yet generated.');
  }
  addSpacer();

  // ===== RESPONSE PLAYBOOK =====
  checkPageBreak(80);
  addTitle('Response Playbook', 14);
  addText('Examples of how you typically respond to different situations:');
  addSpacer(4);

  if (playbook && playbook.length > 0) {
    playbook.slice(0, 3).forEach((entry) => {
      checkPageBreak(50);
      const label = CATEGORY_LABELS[entry.category] || entry.category;
      addSubtitle(label);

      if (entry.golden_example) {
        doc.setFont('helvetica', 'italic');
        addText(
          `Customer: "${entry.golden_example.customer.slice(0, 120)}${entry.golden_example.customer.length > 120 ? '...' : ''}"`,
          5,
        );
        doc.setFont('helvetica', 'normal');
        addText(
          `You replied: "${entry.golden_example.owner.slice(0, 150)}${entry.golden_example.owner.length > 150 ? '...' : ''}"`,
          5,
        );
      }
      addSpacer(4);
    });
  } else {
    addText('Playbook not yet generated.');
  }

  // ===== CONFIDENCE ASSESSMENT =====
  checkPageBreak(50);
  addTitle('AI Confidence Assessment', 14);

  const totalExamples = Object.values(exampleCounts).reduce((a, b) => a + b, 0);
  addText(`Based on ${totalExamples} example conversations:`);
  addSpacer(4);

  const highConf = Object.entries(exampleCounts).filter(([, c]) => c >= 10);
  const medConf = Object.entries(exampleCounts).filter(([, c]) => c >= 5 && c < 10);
  const lowConf = Object.entries(exampleCounts).filter(([, c]) => c < 5);

  if (highConf.length > 0) {
    addSubtitle('✓ Strong confidence');
    highConf.forEach(([cat, count]) => {
      addBullet(`${CATEGORY_LABELS[cat] || cat} (${count} examples)`);
    });
    addSpacer(4);
  }

  if (medConf.length > 0) {
    addSubtitle('○ Good confidence');
    medConf.forEach(([cat, count]) => {
      addBullet(`${CATEGORY_LABELS[cat] || cat} (${count} examples)`);
    });
    addSpacer(4);
  }

  if (lowConf.length > 0) {
    addSubtitle('! Will ask for review');
    lowConf.forEach(([cat, count]) => {
      addBullet(`${CATEGORY_LABELS[cat] || cat} (${count} examples)`);
    });
    addText('The AI will create drafts but ask you to review before sending.', 5);
  }

  // ===== FOOTER =====
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `Generated by BizzyBee • Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' },
    );
  }

  // Save
  const filename = `BizzyBee-Learning-Report-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
