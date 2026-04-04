import { jsPDF } from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import bizzybeeLogoSrc from '@/assets/bizzybee-logo.png';

interface CompetitorFaq {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  source_business: string | null;
  source_url: string | null;
}

interface RefinedFaq {
  question: string;
  answer: string;
  category: string | null;
  original_faq_id: string | null;
}

// ── BizzyBee Brand — warm amber/honey + clean whites (matches KB PDF) ──
const C = {
  amber: [245, 158, 11] as [number, number, number],
  amberDark: [217, 119, 6] as [number, number, number],
  amberLight: [252, 211, 77] as [number, number, number],
  amberPale: [255, 251, 235] as [number, number, number],
  amberSoft: [254, 243, 199] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  background: [249, 250, 251] as [number, number, number],
  foreground: [26, 28, 34] as [number, number, number],
  slate: [71, 85, 105] as [number, number, number],
  muted: [107, 114, 128] as [number, number, number],
  subtle: [156, 163, 175] as [number, number, number],
  border: [229, 231, 235] as [number, number, number],
  green: [22, 163, 74] as [number, number, number],
  greenPale: [220, 252, 231] as [number, number, number],
  orange: [234, 88, 12] as [number, number, number],
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

export async function generateCompetitorResearchPDF(
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
      pageHeader();
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
  const [competitorFaqs, adaptedFaqs] = await Promise.all([
    fetchAll<CompetitorFaq>(
      'faq_database',
      'id, question, answer, category, source_business, source_url',
      (q) =>
        q
          .eq('is_active', true)
          .eq('is_own_content', false)
          .order('category')
          .order('source_business'),
    ),
    fetchAll<RefinedFaq & { id: string }>(
      'faq_database',
      'id, question, answer, category, original_faq_id',
      (q) =>
        q
          .eq('is_active', true)
          .eq('generation_source', 'competitor_adapted')
          .not('original_faq_id', 'is', null),
    ),
  ]);

  // Build lookup: original competitor FAQ id → refined version
  const refinedMap = new Map<string, RefinedFaq>();
  adaptedFaqs.forEach((faq) => {
    if (faq.original_faq_id) refinedMap.set(faq.original_faq_id, faq);
  });
  console.log(
    `[PDF] Found ${competitorFaqs.length} competitor FAQs, ${adaptedFaqs.length} adapted FAQs, refinedMap size: ${refinedMap.size}`,
  );

  // Group by source business
  const bySource: Record<string, CompetitorFaq[]> = {};
  competitorFaqs.forEach((faq) => {
    const key = faq.source_business || 'Unknown Competitor';
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(faq);
  });

  const sources = Object.keys(bySource);
  const adapted = competitorFaqs.filter((f) => refinedMap.has(f.id)).length;

  // ════════════════════════════════════════
  //  PAGE HEADER — warm amber bar (matches KB PDF)
  // ════════════════════════════════════════
  const pageHeader = () => {
    doc.setFillColor(...C.amberPale);
    doc.rect(0, 0, pw, 14, 'F');
    doc.setFillColor(...C.amber);
    doc.rect(0, 13.5, pw, 0.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...C.amberDark);
    doc.text('BizzyBee Competitor Research', mx, 9);
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
  //  COVER PAGE
  // ════════════════════════════════════════
  doc.setFillColor(...C.white);
  doc.rect(0, 0, pw, ph, 'F');

  // Warm amber top strip
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
  doc.text('Competitor Research', pw / 2, 115, { align: 'center' });

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

  // ── Stats cards ──
  const sY = 162;
  const cardW = 48;
  const gap = 8;
  const totalW = cardW * 3 + gap * 2;
  const sX = (pw - totalW) / 2;
  const stats = [
    { label: 'Competitor FAQs', value: String(competitorFaqs.length), accent: C.amber },
    { label: 'Sources', value: String(sources.length), accent: C.green },
    { label: 'Adapted', value: String(adapted), accent: C.orange },
  ];

  stats.forEach((s, i) => {
    const cx = sX + i * (cardW + gap);
    rRect(cx, sY, cardW, 44, 5, C.white);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, sY, cardW, 44, 5, 5, 'S');
    doc.setFillColor(...s.accent);
    doc.circle(cx + 10, sY + 14, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...C.foreground);
    doc.text(s.value, cx + 20, sY + 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.muted);
    doc.text(s.label, cx + 10, sY + 30);
  });

  // "Powered by" footer
  rRect(mx + 20, ph - 50, cw - 40, 18, 4, C.greenPale);
  doc.setFillColor(...C.green);
  doc.roundedRect(mx + 20, ph - 50, 3, 18, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.green);
  doc.text('Powered by BizzyBee AI', pw / 2, ph - 39, { align: 'center' });

  // ════════════════════════════════════════
  //  SUMMARY PAGE
  // ════════════════════════════════════════
  doc.addPage();
  pageHeader();

  sectionTitle('Research Summary');

  // Summary card
  rRect(mx, y, cw, 36, 5, C.amberPale);
  doc.setDrawColor(...C.amberSoft);
  doc.setLineWidth(0.3);
  doc.roundedRect(mx, y, cw, 36, 5, 5, 'S');

  const info = [
    ['COMPETITOR FAQS', String(competitorFaqs.length)],
    ['SOURCES ANALYSED', String(sources.length)],
    ['ADAPTED FOR YOU', String(adapted)],
  ];
  let iy = y + 11;
  info.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.amberDark);
    doc.text(label, mx + 8, iy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...C.foreground);
    doc.text(value, mx + 55, iy);
    iy += 9.5;
  });
  y += 44;

  // Source overview
  sectionTitle('Sources Overview', C.green);

  Object.entries(bySource).forEach(([source, faqs]) => {
    ensureSpace(11);
    const col = catColour(faqs[0]?.category || 'general');
    doc.setFillColor(...col);
    doc.roundedRect(mx + 4, y - 2.5, 3, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.foreground);
    doc.text(source, mx + 11, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(`${faqs.length} FAQs`, mx + 11 + doc.getTextWidth(source) + 4, y + 3);
    y += 10;
  });
  y += 6;

  // ════════════════════════════════════════
  //  FAQ SECTIONS — by source, side-by-side
  // ════════════════════════════════════════
  const colWidth = (cw - 8) / 2;
  const leftX = mx;
  const rightX = mx + colWidth + 8;

  Object.entries(bySource).forEach(([source, faqs]) => {
    doc.addPage();
    pageHeader();

    // Source header — amber pill
    const col = catColour(faqs[0]?.category || 'general');
    rRect(mx, y, cw, 14, 5, col);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...C.white);
    doc.text(source, mx + 8, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${faqs.length} FAQs`, pw - mx - 8, y + 10, { align: 'right' });
    y += 20;

    // Column headers
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.amberDark);
    doc.text('COMPETITOR FAQ', leftX + 2, y);
    doc.text(`ADAPTED FOR ${(companyName || 'YOU').toUpperCase()}`, rightX + 2, y);
    doc.setTextColor(...C.foreground);
    y += 4;
    hLine(y, C.amberSoft, 0.5);
    y += 5;

    faqs.forEach((faq, idx) => {
      const refined = refinedMap.get(faq.id);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const qLinesLeft = doc.splitTextToSize(`Q: ${faq.question}`, colWidth - 6);
      doc.setFont('helvetica', 'normal');
      const aLinesLeft = doc.splitTextToSize(`A: ${faq.answer}`, colWidth - 6);

      let qLinesRight: string[] = [];
      let aLinesRight: string[] = [];
      if (refined) {
        doc.setFont('helvetica', 'bold');
        qLinesRight = doc.splitTextToSize(`Q: ${refined.question}`, colWidth - 6);
        doc.setFont('helvetica', 'normal');
        aLinesRight = doc.splitTextToSize(`A: ${refined.answer}`, colWidth - 6);
      }

      const leftHeight = (qLinesLeft.length + aLinesLeft.length) * 4.5 + 8;
      const rightHeight = refined ? (qLinesRight.length + aLinesRight.length) * 4.5 + 8 : 12;
      const rowHeight = Math.max(leftHeight, rightHeight) + 4;

      ensureSpace(rowHeight + 4);

      const startY = y;

      // Alternating background
      if (idx % 2 === 0) {
        rRect(mx, y - 2, cw, rowHeight, 4, C.background);
      }

      // Left column — competitor
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...C.slate);
      doc.text(qLinesLeft, leftX + 4, y + 2);
      y += qLinesLeft.length * 4.5 + 2;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...C.foreground);
      doc.text(aLinesLeft, leftX + 4, y);

      // Source URL
      if (faq.source_url) {
        const srcY = startY + leftHeight - 4;
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(...C.subtle);
        const srcText = doc.splitTextToSize(`Source: ${faq.source_url}`, colWidth - 8);
        doc.text(srcText[0], leftX + 4, srcY);
        doc.setFont('helvetica', 'normal');
      }

      // Right column — adapted
      let ry = startY;
      if (refined) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C.green);
        doc.text(qLinesRight, rightX + 4, ry + 2);
        ry += qLinesRight.length * 4.5 + 2;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C.foreground);
        doc.text(aLinesRight, rightX + 4, ry);
      } else {
        doc.setFontSize(8);
        doc.setTextColor(...C.subtle);
        doc.setFont('helvetica', 'italic');
        doc.text('No adapted version yet', rightX + 4, startY + 4);
        doc.setFont('helvetica', 'normal');
      }

      // Arrow
      const arrowY = startY + rowHeight / 2;
      doc.setFontSize(11);
      doc.setTextColor(...C.amber);
      doc.text('→', mx + colWidth + 1, arrowY);
      doc.setTextColor(...C.foreground);

      y = startY + rowHeight;

      // Row separator
      if (idx < faqs.length - 1) {
        hLine(y, C.border, 0.2);
        y += 3;
      }
    });
  });

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

  doc.save(`BizzyBee-Competitor-Research-${new Date().toISOString().split('T')[0]}.pdf`);
}
