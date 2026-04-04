import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import bizzybeeLogoSrc from '@/assets/bizzybee-logo.png';

interface FAQItem {
  question: string;
  answer: string;
  category: string | null;
  priority: number | null;
  is_own_content: boolean | null;
  source_type: string | null;
}

interface BusinessFact {
  fact_key: string;
  fact_value: string;
  category: string;
}

// ── BizzyBee Brand — warm amber/honey + clean whites ──
const C = {
  // Brand amber (from logo & app banners)
  amber: [245, 158, 11] as [number, number, number], // #F59E0B
  amberDark: [217, 119, 6] as [number, number, number], // #D97706
  amberLight: [252, 211, 77] as [number, number, number], // #FCD34D
  amberPale: [255, 251, 235] as [number, number, number], // #FFFBEB - warm banner bg
  amberSoft: [254, 243, 199] as [number, number, number], // #FEF3C7

  // Clean whites & backgrounds (from app cards)
  white: [255, 255, 255] as [number, number, number],
  background: [249, 250, 251] as [number, number, number], // #F9FAFB

  // Text
  foreground: [26, 28, 34] as [number, number, number],
  slate: [71, 85, 105] as [number, number, number], // #475569
  muted: [107, 114, 128] as [number, number, number],
  subtle: [156, 163, 175] as [number, number, number],

  // Borders
  border: [229, 231, 235] as [number, number, number],

  // Accent colours (from sidebar icons)
  green: [22, 163, 74] as [number, number, number], // success green
  greenPale: [220, 252, 231] as [number, number, number], // #DCFCE7
  orange: [234, 88, 12] as [number, number, number], // warm orange
  violet: [139, 92, 246] as [number, number, number],
  rose: [225, 29, 72] as [number, number, number],
  sky: [14, 165, 233] as [number, number, number],
  teal: [20, 184, 166] as [number, number, number],
};

const CAT_COLOURS: Record<string, [number, number, number]> = {
  services: C.amber,
  pricing: C.green,
  booking: C.violet,
  policies: C.rose,
  coverage: C.sky,
  process: C.amberDark,
  trust: C.teal,
  contact: C.orange,
  general: C.amber,
};

function catColour(cat: string): [number, number, number] {
  const k = cat.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, col] of Object.entries(CAT_COLOURS)) {
    if (k.includes(key)) return col;
  }
  return C.amber;
}

export async function generateKnowledgeBasePDF(
  workspaceId: string,
  companyName?: string,
): Promise<void> {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mx = 18;
  const cw = pw - mx * 2;
  let y = mx;

  // Dynamic table pagination — tables may not be in generated Supabase types
  const fetchAll = async <T>(
    table: string,
    select: string,
    build?: (q: unknown) => unknown,
  ): Promise<T[]> => {
    const ps = 1000;
    let from = 0;
    const rows: T[] = [];
    while (true) {
      let q: unknown = (supabase as unknown as { from: (t: string) => unknown }).from(table);
      q = (q as { select: (s: string) => unknown }).select(select);
      q = (q as { eq: (c: string, v: string) => unknown }).eq('workspace_id', workspaceId);
      q = (q as { range: (f: number, t: number) => unknown }).range(from, from + ps - 1);
      if (build) q = build(q);
      const { data, error } = await (q as Promise<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>);
      if (error) throw error;
      const page = (data || []) as T[];
      rows.push(...page);
      if (page.length < ps) break;
      from += ps;
    }
    return rows;
  };

  const ensureSpace = (n: number) => {
    if (y + n > ph - 22) {
      doc.addPage();
      y = mx + 4;
    }
  };
  const rRect = (
    x: number,
    ry: number,
    w: number,
    h: number,
    r: number,
    fill: [number, number, number],
  ) => {
    doc.setFillColor(...fill);
    doc.roundedRect(x, ry, w, h, r, r, 'F');
  };
  const hLine = (ly: number, col: [number, number, number] = C.border, w = 0.3) => {
    doc.setDrawColor(...col);
    doc.setLineWidth(w);
    doc.line(mx, ly, pw - mx, ly);
  };

  // ── fetch data ──
  const [faqs, facts, scrapingJob] = await Promise.all([
    fetchAll<FAQItem>(
      'faq_database',
      'question, answer, category, priority, is_own_content, source_type',
      (q) =>
        q.eq('is_active', true).eq('is_own_content', true).order('priority', { ascending: false }),
    ),
    fetchAll<BusinessFact>('business_facts', 'fact_key, fact_value, category'),
    sb
      .from('scraping_jobs')
      .select('website_url, total_pages_found, pages_processed, faqs_found, completed_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r: any) => r.data),
  ]);

  const faqsByCat: Record<string, FAQItem[]> = {};
  faqs.forEach((f) => {
    // Normalize category to Title Case to prevent "Pricing" vs "pricing" duplication
    const raw = f.category || 'General';
    const c = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    (faqsByCat[c] ??= []).push(f);
  });
  const catOrder = Object.entries(faqsByCat).sort((a, b) => b[1].length - a[1].length);

  const factsByCat: Record<string, BusinessFact[]> = {};
  facts.forEach((f) => {
    (factsByCat[f.category] ??= []).push(f);
  });

  // ════════════════════════════════════════
  //  COVER PAGE — warm, clean, BizzyBee
  // ════════════════════════════════════════

  doc.setFillColor(...C.white);
  doc.rect(0, 0, pw, ph, 'F');

  // Warm amber top strip (like the app's greeting banner)
  doc.setFillColor(...C.amber);
  doc.rect(0, 0, pw, 5, 'F');
  doc.setFillColor(...C.amberDark);
  doc.rect(0, 5, pw, 1, 'F');

  // Subtle warm glow behind logo
  rRect(pw / 2 - 28, 44, 56, 56, 28, C.amberPale);

  // Logo
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      img.onload = () => {
        doc.addImage(img, 'PNG', pw / 2 - 20, 52, 40, 40);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = bizzybeeLogoSrc;
    });
  } catch {
    /* skip */
  }

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...C.foreground);
  doc.text('Knowledge Base', pw / 2, 115, { align: 'center' });

  // Amber divider
  doc.setFillColor(...C.amber);
  doc.roundedRect(pw / 2 - 20, 120, 40, 2, 1, 1, 'F');

  // Company name
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...C.amberDark);
  doc.text(`Prepared for ${companyName || 'Your Business'}`, pw / 2, 132, { align: 'center' });

  // Date
  doc.setFontSize(10);
  doc.setTextColor(...C.muted);
  doc.text(
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    pw / 2,
    142,
    { align: 'center' },
  );

  // ── Stats cards — white cards with amber accents (like app dashboard) ──
  const sY = 162;
  const cardW = 48;
  const gap = 8;
  const totalW = cardW * 3 + gap * 2;
  const sX = (pw - totalW) / 2;
  const stats = [
    { label: 'FAQs', value: String(faqs.length), accent: C.amber },
    { label: 'Categories', value: String(catOrder.length), accent: C.green },
    { label: 'Pages Scraped', value: String(scrapingJob?.pages_processed || 0), accent: C.orange },
  ];

  stats.forEach((s, i) => {
    const cx = sX + i * (cardW + gap);
    // White card with subtle border (like app's dashboard cards)
    rRect(cx, sY, cardW, 44, 5, C.white);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, sY, cardW, 44, 5, 5, 'S');
    // Accent dot
    doc.setFillColor(...s.accent);
    doc.circle(cx + 10, sY + 14, 4, 'F');
    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...C.foreground);
    doc.text(s.value, cx + 20, sY + 17);
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.muted);
    doc.text(s.label, cx + 10, sY + 30);
  });

  // "Powered by" footer with green accent (like app's "You're all caught up")
  rRect(mx + 20, ph - 50, cw - 40, 18, 4, C.greenPale);
  doc.setFillColor(...C.green);
  doc.roundedRect(mx + 20, ph - 50, 3, 18, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.green);
  doc.text('Powered by BizzyBee AI', pw / 2, ph - 39, { align: 'center' });

  if (scrapingJob?.website_url) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.subtle);
    doc.text(scrapingJob.website_url, pw / 2, ph - 22, { align: 'center' });
  }

  // ════════════════════════════════════════
  //  PAGE HEADER — warm amber bar
  // ════════════════════════════════════════
  const pageHeader = () => {
    doc.setFillColor(...C.amberPale);
    doc.rect(0, 0, pw, 14, 'F');
    doc.setFillColor(...C.amber);
    doc.rect(0, 13.5, pw, 0.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...C.amberDark);
    doc.text('BizzyBee Knowledge Base', mx, 9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.muted);
    doc.text(companyName || '', pw - mx, 9, { align: 'right' });
    y = 22;
  };

  const sectionTitle = (text: string, colour: [number, number, number] = C.amber) => {
    ensureSpace(18);
    doc.setFillColor(...colour);
    doc.roundedRect(mx, y, 3, 12, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...C.foreground);
    doc.text(text, mx + 8, y + 9);
    y += 16;
  };

  // ════════════════════════════════════════
  //  SCRAPING SUMMARY
  // ════════════════════════════════════════
  doc.addPage();
  pageHeader();

  if (scrapingJob) {
    sectionTitle('Website Analysis Summary');
    // Warm pale card (like app's amber greeting banner)
    rRect(mx, y, cw, 48, 5, C.amberPale);
    doc.setDrawColor(...C.amberSoft);
    doc.setLineWidth(0.3);
    doc.roundedRect(mx, y, cw, 48, 5, 5, 'S');

    const info = [
      ['Website', scrapingJob.website_url || 'N/A'],
      ['Pages Discovered', String(scrapingJob.total_pages_found || 0)],
      ['Pages Processed', String(scrapingJob.pages_processed || 0)],
      ['FAQs Extracted', String(scrapingJob.faqs_found || 0)],
    ];
    let iy = y + 11;
    info.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.amberDark);
      doc.text(label.toUpperCase(), mx + 8, iy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...C.foreground);
      doc.text(value, mx + 55, iy);
      iy += 9.5;
    });
    y += 56;
  }

  // ════════════════════════════════════════
  //  CATEGORY OVERVIEW
  // ════════════════════════════════════════
  sectionTitle('Category Overview', C.green);

  catOrder.forEach(([cat, items]) => {
    ensureSpace(11);
    const col = catColour(cat);
    doc.setFillColor(...col);
    doc.roundedRect(mx + 4, y - 2.5, 3, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.foreground);
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');
    doc.text(label, mx + 11, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(`${items.length} FAQs`, mx + 11 + doc.getTextWidth(label) + 4, y + 3);
    y += 10;
  });
  y += 6;

  // ════════════════════════════════════════
  //  FAQ SECTIONS
  // ════════════════════════════════════════
  catOrder.forEach(([cat, items]) => {
    doc.addPage();
    pageHeader();

    const col = catColour(cat);
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ');

    // Category header — clean rounded pill
    rRect(mx, y, cw, 14, 5, col);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...C.white);
    doc.text(label, mx + 8, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${items.length} questions`, pw - mx - 8, y + 10, { align: 'right' });
    y += 20;

    items.forEach((faq, idx) => {
      const qLines = doc.splitTextToSize(faq.question, cw - 24);
      const aLines = doc.splitTextToSize(faq.answer, cw - 24);
      const itemH = (qLines.length + aLines.length) * 5 + 14;

      ensureSpace(itemH + 4);
      if (y < 22) pageHeader();

      // Alternating warm background (like app's card style)
      if (idx % 2 === 0) {
        rRect(mx, y - 2, cw, itemH, 4, C.background);
      }

      // Q badge
      doc.setFillColor(...col);
      doc.roundedRect(mx + 4, y + 1, 13, 6, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...C.white);
      doc.text(`Q${idx + 1}`, mx + 10.5, y + 5.5, { align: 'center' });

      // Question
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.foreground);
      doc.text(qLines, mx + 20, y + 6);
      y += qLines.length * 5 + 6;

      // Answer
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...C.slate);
      doc.text(aLines, mx + 20, y);
      y += aLines.length * 5 + 8;
    });
  });

  // ════════════════════════════════════════
  //  BUSINESS FACTS
  // ════════════════════════════════════════
  if (facts.length > 0) {
    doc.addPage();
    pageHeader();
    sectionTitle('Business Facts', C.green);

    Object.entries(factsByCat).forEach(([cat, items]) => {
      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...C.foreground);
      doc.text(cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '), mx + 4, y + 4);
      y += 10;

      items.forEach((f) => {
        ensureSpace(12);
        doc.setFillColor(...C.amber);
        doc.circle(mx + 6, y + 1.5, 1.2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...C.foreground);
        const keyText = f.fact_key.replace(/_/g, ' ');
        doc.text(keyText, mx + 11, y + 3);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C.slate);
        const valLines = doc.splitTextToSize(f.fact_value, cw - 15 - doc.getTextWidth(keyText) - 6);
        if (valLines.length === 1) {
          doc.text(`: ${f.fact_value}`, mx + 11 + doc.getTextWidth(keyText), y + 3);
          y += 7;
        } else {
          y += 5;
          const fullLines = doc.splitTextToSize(f.fact_value, cw - 15);
          doc.text(fullLines, mx + 11, y);
          y += fullLines.length * 4.5 + 3;
        }
      });
      y += 6;
    });
  }

  // ════════════════════════════════════════
  //  FOOTERS
  // ════════════════════════════════════════
  const pc = doc.getNumberOfPages();
  for (let i = 2; i <= pc; i++) {
    doc.setPage(i);
    hLine(ph - 16, C.amberSoft);
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text('Generated by BizzyBee AI', mx, ph - 10);
    doc.setTextColor(...C.amberDark);
    doc.text(`Page ${i - 1} of ${pc - 1}`, pw - mx, ph - 10, { align: 'right' });
  }

  doc.save(`BizzyBee-Knowledge-Base-${new Date().toISOString().split('T')[0]}.pdf`);
}
