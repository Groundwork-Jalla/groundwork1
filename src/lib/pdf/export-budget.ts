import { jsPDF } from 'jspdf';
import { BUDGET_SLICES, projectBudget } from '@/lib/budget';
import { formatMoney, localeFor } from '@/lib/format';
import { translate, translatePlural, translator, type TKey } from '@/lib/i18n/translate';
import type { Lang } from '@/lib/i18n/types';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

const PAY_LABEL: Record<string, TKey> = {
  paid: 'pdf.payPaid', partial: 'pdf.payPartial', unpaid: 'pdf.payUnpaid',
};

/** Stage name from `stage_key`, falling back to the stored English `name`. */
function stageLabel(lang: Lang, stage: ProjectStageRow): string {
  if (!stage.stage_key) return stage.name;
  const key = `stages.${stage.stage_key}` as TKey;
  const hit = translate(lang, key);
  return hit === key ? stage.name : hit;
}

/**
 * Costing report PDF.
 *
 * `lang` comes from the viewer's toggle — unlike email, whoever generates this is
 * whoever reads it. Money and dates go through the locale-aware formatters rather than
 * `formatUSDFull`, which reads a module-level locale that is only correct by
 * coincidence outside a render.
 */
export async function exportBudgetPDF(
  project: ProjectRow,
  stages: ProjectStageRow[],
  lang: Lang,
): Promise<void> {
  const t = translator(lang);
  const locale = localeFor(lang);
  const money = (n: number) => formatMoney(n, 'USD', locale);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const MARGIN = 16;
  const COL = W - MARGIN * 2;
  let y = MARGIN;

  // Same resolution as the on-screen costing tab, so a downloaded PDF and the app can
  // never quote different figures for the same project.
  const budget = projectBudget(project);
  const total  = budget.total;

  // ── Header ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(t('email.brand'), MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(t('pdf.reportTitle'), MARGIN + 44, y);
  doc.setTextColor(0);
  y += 8;

  // Project name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(project.name, MARGIN, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  const meta = [
    translate(lang, `country.${project.country}` as TKey),
    translatePlural(lang, 'pdf.floors', project.num_floors),
    t('pdf.sqm', { n: project.sqm }),
    t('pdf.finish', { level: translate(lang, `finishLevel.${project.finish_level}` as TKey) }),
  ].join(' · ');
  doc.text(meta, MARGIN, y);
  doc.setTextColor(0);
  y += 5;

  // Date
  doc.text(
    t('pdf.generated', {
      date: new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    }),
    MARGIN, y,
  );
  y += 8;

  // Divider
  doc.setDrawColor(200);
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 6;

  // ── Total ────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(money(total), MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(t('pdf.totalCaption'), MARGIN, y + 6);
  doc.setTextColor(0);
  y += 14;

  // ── Cost breakdown table ─────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(t('pdf.breakdown'), MARGIN, y);
  y += 5;

  // Table header
  doc.setFillColor(20, 20, 20);
  doc.rect(MARGIN, y, COL, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255);
  doc.text(t('pdf.colCategory'), MARGIN + 2, y + 4);
  doc.text('%',                 MARGIN + 80, y + 4);
  doc.text(t('pdf.colAmount'),  MARGIN + 100, y + 4);
  doc.setTextColor(0);
  y += 6;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let rowShade = false;
  for (const slice of BUDGET_SLICES) {
    if (rowShade) {
      doc.setFillColor(245, 245, 245);
      doc.rect(MARGIN, y, COL, 6, 'F');
    }
    doc.text(t(slice.labelKey),        MARGIN + 2,   y + 4);
    doc.text(`${slice.pct}%`,          MARGIN + 80,  y + 4);
    doc.text(money(budget[slice.key]), MARGIN + 100, y + 4);
    y += 6;
    rowShade = !rowShade;
  }

  // Total row
  doc.setFillColor(20, 20, 20);
  doc.rect(MARGIN, y, COL, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255);
  doc.text(t('pdf.total'), MARGIN + 2,   y + 5);
  doc.text('100%',        MARGIN + 80,  y + 5);
  doc.text(money(total),  MARGIN + 100, y + 5);
  doc.setTextColor(0);
  y += 12;

  // ── Payment schedule ─────────────────────────────────
  const sortedStages = [...stages].sort((a, b) => a.stage_number - b.stage_number);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(t('pdf.scheduleTitle'), MARGIN, y);
  y += 5;

  // Check page space
  if (y > 240) { doc.addPage(); y = MARGIN; }

  // Table header
  doc.setFillColor(20, 20, 20);
  doc.rect(MARGIN, y, COL, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255);
  doc.text(t('pdf.colStage'),     MARGIN + 2,   y + 4);
  doc.text('%',                   MARGIN + 95,  y + 4);
  doc.text(t('pdf.colMilestone'), MARGIN + 110, y + 4);
  doc.text(t('pdf.colStatus'),    MARGIN + 155, y + 4);
  doc.setTextColor(0);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  rowShade = false;
  for (const stage of sortedStages) {
    if (y > 270) { doc.addPage(); y = MARGIN; }
    if (rowShade) {
      doc.setFillColor(245, 245, 245);
      doc.rect(MARGIN, y, COL, 6, 'F');
    }
    const payKey = PAY_LABEL[stage.payment_status];
    doc.text(`${stage.stage_number}. ${stageLabel(lang, stage)}`, MARGIN + 2,   y + 4);
    doc.text(`${stage.budget_pct}%`,                              MARGIN + 95,  y + 4);
    doc.text(money(stage.payment_milestone_usd ?? 0),             MARGIN + 110, y + 4);
    doc.text(payKey ? t(payKey) : '—',                            MARGIN + 155, y + 4);
    y += 6;
    rowShade = !rowShade;
  }
  y += 6;

  // ── Disclaimer ───────────────────────────────────────
  if (y > 255) { doc.addPage(); y = MARGIN; }
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  const lines = doc.splitTextToSize(t('pdf.disclaimer'), COL);
  doc.text(lines, MARGIN, y);
  doc.setTextColor(0);

  // Footer
  const footerY = 295;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(160);
  doc.text(t('email.footer'), MARGIN, footerY);
  doc.text(t('pdf.page', { n: 1 }), W - MARGIN, footerY, { align: 'right' });

  doc.save(`${project.name.replace(/\s+/g, '-')}-${t('pdf.fileSuffix')}.pdf`);
}
