import { jsPDF } from 'jspdf';

export interface CertificateOptions {
  projectName: string;
  stageName: string;
  stageNumber: number;
  ownerName: string;
  issuedAt: Date;
  certificateId: string;
}

// ── Helpers ───────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

// ── PDF generation ────────────────────────────────────────

export async function generateCertificate(opts: CertificateOptions): Promise<Blob> {
  const { projectName, stageName, stageNumber, ownerName, issuedAt, certificateId } = opts;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const W = doc.internal.pageSize.getWidth();   // 297
  const H = doc.internal.pageSize.getHeight();  // 210

  // ── Background ──────────────────────────────────────────
  doc.setFillColor(250, 250, 250);
  doc.rect(0, 0, W, H, 'F');

  // ── Outer border ────────────────────────────────────────
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(1.2);
  doc.rect(8, 8, W - 16, H - 16);

  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.3);
  doc.rect(11, 11, W - 22, H - 22);

  // ── Header band ─────────────────────────────────────────
  doc.setFillColor(10, 10, 10);
  doc.rect(8, 8, W - 16, 26, 'F');

  // ── Header text ─────────────────────────────────────────
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('GROUNDWORK', W / 2, 18, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(200, 200, 200);
  doc.text('by Jalla  ·  Verified Construction Management', W / 2, 24, { align: 'center' });

  // ── "CERTIFICATE OF STAGE COMPLETION" title ─────────────
  doc.setTextColor(10, 10, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('CERTIFICATE OF STAGE COMPLETION', W / 2, 46, { align: 'center' });

  // ── Thin rule under title ────────────────────────────────
  doc.setDrawColor(10, 10, 10);
  doc.setLineWidth(0.4);
  doc.line(W / 2 - 60, 49, W / 2 + 60, 49);

  // ── Body: "This certifies that…" ────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('This is to certify that', W / 2, 62, { align: 'center' });

  // Owner name (large)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(10, 10, 10);
  doc.text(ownerName, W / 2, 76, { align: 'center' });

  // Thin rule under name
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(W / 2 - 50, 80, W / 2 + 50, 80);

  // Body text
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('has successfully completed', W / 2, 91, { align: 'center' });

  // Stage + project
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(10, 10, 10);
  doc.text(`Stage ${stageNumber}: ${stageName}`, W / 2, 103, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('of the construction project', W / 2, 112, { align: 'center' });

  // Project name (medium bold)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(10, 10, 10);
  doc.text(`"${projectName}"`, W / 2, 123, { align: 'center' });

  // ── "Verified and approved by Jalla" stamp area ──────────
  doc.setFillColor(10, 10, 10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(10, 10, 10);

  // Left column: date issued
  const colLeft = W / 2 - 60;
  const colRight = W / 2 + 60;
  const stampY = 145;

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(colLeft, stampY, colLeft + 60, stampY);
  doc.line(colRight - 60, stampY, colRight, stampY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(10, 10, 10);
  doc.text('DATE ISSUED', colLeft + 30, stampY + 6, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(formatDate(issuedAt), colLeft + 30, stampY + 13, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('VERIFIED BY', colRight - 30, stampY + 6, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Jalla Review Team', colRight - 30, stampY + 13, { align: 'center' });

  // ── Groundwork "seal" circle ─────────────────────────────
  doc.setDrawColor(10, 10, 10);
  doc.setLineWidth(0.8);
  doc.circle(W / 2, 147, 12);
  doc.setLineWidth(0.3);
  doc.circle(W / 2, 147, 10.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.setTextColor(10, 10, 10);
  doc.text('GROUNDWORK', W / 2, 145, { align: 'center' });
  doc.setFontSize(4);
  doc.text('✓ VERIFIED', W / 2, 149.5, { align: 'center' });
  doc.setFontSize(3.5);
  doc.text('BY JALLA', W / 2, 153.5, { align: 'center' });

  // ── Footer: certificate ID ───────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(160, 160, 160);
  doc.text(
    `Certificate ID: ${certificateId}  ·  Verify at tryjalla.com/verify/${certificateId}`,
    W / 2, H - 14, { align: 'center' },
  );

  return doc.output('blob');
}
