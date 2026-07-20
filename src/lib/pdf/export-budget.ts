import { jsPDF } from 'jspdf';
import { calculateBudget, formatUSDFull } from '@/lib/budget';
import { findCountry } from '@/lib/countries';
import type { ProjectRow, ProjectStageRow } from '@/types/project';

const BUDGET_SLICES = [
  { label: 'Materials',        pct: 41, key: 'materials'   as const },
  { label: 'Labor',            pct: 23, key: 'labor'       as const },
  { label: 'Engineering',      pct: 16, key: 'engineering' as const },
  { label: 'Proj. Management', pct: 10, key: 'management'  as const },
  { label: 'Contingency',      pct: 8,  key: 'contingency' as const },
  { label: 'Permits',          pct: 2,  key: 'permits'     as const },
] as const;

const PAY_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid',
};

export async function exportBudgetPDF(
  project: ProjectRow,
  stages: ProjectStageRow[],
): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const MARGIN = 16;
  const COL = W - MARGIN * 2;
  let y = MARGIN;

  const budget = calculateBudget({
    country:         project.country,
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
    sqm:             Number(project.sqm),
    finishLevel:     project.finish_level,
  });

  const country = findCountry(project.country);
  const total   = project.budget_usd ?? budget.total;

  // ── Header ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Groundwork', MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('by Jalla · Costing Report', MARGIN + 44, y);
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
    country?.name ?? project.country,
    `${project.num_floors} floor${project.num_floors !== 1 ? 's' : ''}`,
    `${project.sqm} sqm`,
    project.finish_level.charAt(0).toUpperCase() + project.finish_level.slice(1) + ' finish',
  ].join(' · ');
  doc.text(meta, MARGIN, y);
  doc.setTextColor(0);
  y += 5;

  // Date
  doc.text(
    `Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
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
  doc.text(formatUSDFull(total), MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Total estimated build cost (USD · indicative)', MARGIN, y + 6);
  doc.setTextColor(0);
  y += 14;

  // ── Cost breakdown table ─────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Cost Breakdown', MARGIN, y);
  y += 5;

  // Table header
  doc.setFillColor(20, 20, 20);
  doc.rect(MARGIN, y, COL, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255);
  doc.text('Category',  MARGIN + 2, y + 4);
  doc.text('%',          MARGIN + 80, y + 4);
  doc.text('Amount (USD)', MARGIN + 100, y + 4);
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
    doc.text(slice.label,                 MARGIN + 2,   y + 4);
    doc.text(`${slice.pct}%`,             MARGIN + 80,  y + 4);
    doc.text(formatUSDFull(budget[slice.key]), MARGIN + 100, y + 4);
    y += 6;
    rowShade = !rowShade;
  }

  // Total row
  doc.setFillColor(20, 20, 20);
  doc.rect(MARGIN, y, COL, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255);
  doc.text('Total',              MARGIN + 2,   y + 5);
  doc.text('100%',               MARGIN + 80,  y + 5);
  doc.text(formatUSDFull(total), MARGIN + 100, y + 5);
  doc.setTextColor(0);
  y += 12;

  // ── Payment schedule ─────────────────────────────────
  const sortedStages = [...stages].sort((a, b) => a.stage_number - b.stage_number);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Payment Milestone Schedule', MARGIN, y);
  y += 5;

  // Check page space
  if (y > 240) { doc.addPage(); y = MARGIN; }

  // Table header
  doc.setFillColor(20, 20, 20);
  doc.rect(MARGIN, y, COL, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255);
  doc.text('Stage',       MARGIN + 2,   y + 4);
  doc.text('%',            MARGIN + 95,  y + 4);
  doc.text('Milestone',    MARGIN + 110, y + 4);
  doc.text('Status',       MARGIN + 155, y + 4);
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
    doc.text(`${stage.stage_number}. ${stage.name}`, MARGIN + 2,   y + 4);
    doc.text(`${stage.budget_pct}%`,                  MARGIN + 95,  y + 4);
    doc.text(formatUSDFull(stage.payment_milestone_usd ?? 0), MARGIN + 110, y + 4);
    doc.text(PAY_LABEL[stage.payment_status] ?? '—',  MARGIN + 155, y + 4);
    y += 6;
    rowShade = !rowShade;
  }
  y += 6;

  // ── Disclaimer ───────────────────────────────────────
  if (y > 255) { doc.addPage(); y = MARGIN; }
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(130);
  const disclaimer = 'Indicative estimate only. Actual costs depend on local market conditions, site specifics, contractor pricing, and current material costs. Confirm final figures with a certified quantity surveyor before committing to any expenditure.';
  const lines = doc.splitTextToSize(disclaimer, COL);
  doc.text(lines, MARGIN, y);
  doc.setTextColor(0);

  // Footer
  const footerY = 295;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(160);
  doc.text('Groundwork by Jalla', MARGIN, footerY);
  doc.text(`Page 1`, W - MARGIN, footerY, { align: 'right' });

  doc.save(`${project.name.replace(/\s+/g, '-')}-costing.pdf`);
}
