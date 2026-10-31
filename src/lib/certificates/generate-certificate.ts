import { translator } from '@/lib/i18n/translate';
import { localeFor } from '@/lib/format';
import { siteLink } from '@/lib/site-url';
import type { Lang } from '@/lib/i18n/types';

// =========================================================
// The stage completion certificate.
//
// Redrawn 31 Oct 2026. Favour: "it has to be unique and branded just for Groundwork."
// The previous version was set entirely in Helvetica — jsPDF's built-in default, and
// the typeface of every unstyled PDF ever generated — with no brand colour, an
// illegible 4pt seal, an empty bottom third, and a verify URL printed as a UUID in 6pt
// grey that nobody could use.
//
// ── What makes it ours ──────────────────────────────────────────────────────────────
// Plus Jakarta Sans, the face the product is set in, embedded rather than linked. The
// verified green (#1f4d36) that means "stage verified, funds released" everywhere else
// in the app, used once — on the seal and the rule under the stage — and nowhere else,
// so it reads as a mark rather than decoration. A ten-dot stage spine, the same device
// the app uses on every project row, filled to the stage being certified: it says at a
// glance how far the build has come, which no other certificate can say.
//
// ── The QR is the point ─────────────────────────────────────────────────────────────
// A certificate's value is that it can be checked. The old one printed the URL in grey
// 6pt with a UUID in it; this draws a scannable code to the same /verify page, and a
// short ID a person can read aloud. A certificate nobody can verify is a picture.
//
// ── Still rendered once and stored ──────────────────────────────────────────────────
// `lang` is baked in at generation: a certificate is a stored artefact, not a view, so
// whatever is chosen here is what the owner downloads forever.
// =========================================================

export interface CertificateOptions {
  projectName: string;
  stageName: string;
  stageNumber: number;
  ownerName: string;
  issuedAt: Date;
  certificateId: string;
  lang: Lang;
  /** Where the build is. Printed under the project name when given. */
  location?: string | null;
  /** Who built it. Named beside the owner when known. */
  contractorName?: string | null;
  /** How many stages this project has. The spine is drawn to it; 10 is the standard. */
  totalStages?: number;
}

// ── Brand ─────────────────────────────────────────────────
// Straight from globals.css, so the certificate cannot drift from the product.
const INK: [number, number, number]    = [10, 10, 10];    // --color-ink
const MUTED: [number, number, number]  = [90, 90, 87];    // --color-ink-60
const RULE: [number, number, number]   = [228, 227, 223]; // --color-rule
const CANVAS: [number, number, number] = [247, 247, 245]; // --color-canvas
const VERIFIED: [number, number, number] = [31, 77, 54];  // --color-state-complete

const FONT = 'PlusJakartaSans';

function formatDate(d: Date, lang: Lang): string {
  return d.toLocaleDateString(localeFor(lang), {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/**
 * The first block of the id, upper-cased.
 *
 * A full UUID is unreadable and unsayable. Eight hex characters is enough to find the
 * record and short enough to read down a phone, and the QR carries the whole thing.
 */
function shortId(id: string): string {
  return (id.split('-')[0] ?? id).toUpperCase();
}

export async function generateCertificate(opts: CertificateOptions): Promise<Blob> {
  const {
    projectName, stageName, stageNumber, ownerName, issuedAt, certificateId, lang,
    location = null, contractorName = null, totalStages = 10,
  } = opts;
  const t = translator(lang);

  // Both lazy: jsPDF and ~165 KB of font bytes have no business in the bundle of a
  // contractor who never issues a certificate.
  const [{ jsPDF }, fonts, QRCode] = await Promise.all([
    import('jspdf'),
    import('./certificate-fonts'),
    import('qrcode'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // The brand face, embedded. Registered under one family with two weights so
  // `setFont(FONT, 'bold')` works the way it does for the built-ins.
  doc.addFileToVFS('PlusJakartaSans-Regular.ttf', fonts.PJS_REGULAR);
  doc.addFont('PlusJakartaSans-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('PlusJakartaSans-Bold.ttf', fonts.PJS_BOLD);
  doc.addFont('PlusJakartaSans-Bold.ttf', FONT, 'bold');

  const W = doc.internal.pageSize.getWidth();   // 297
  const H = doc.internal.pageSize.getHeight();  // 210
  const cx = W / 2;

  const ink   = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill  = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const strok = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
  const bold  = (size: number) => { doc.setFont(FONT, 'bold'); doc.setFontSize(size); };
  const text  = (size: number) => { doc.setFont(FONT, 'normal'); doc.setFontSize(size); };

  // ── Ground ──────────────────────────────────────────────
  fill(CANVAS);
  doc.rect(0, 0, W, H, 'F');

  // A single hairline frame. The old one drew two, which read as a clip-art border.
  strok(RULE);
  doc.setLineWidth(0.4);
  doc.rect(10, 10, W - 20, H - 20);

  // ── Masthead ────────────────────────────────────────────
  fill(INK);
  doc.rect(10, 10, W - 20, 24, 'F');

  ink([255, 255, 255]);
  bold(15);
  doc.setCharSpace(0.6);
  doc.text('GROUNDWORK', cx, 21.5, { align: 'center' });
  doc.setCharSpace(0);

  text(6.5);
  doc.setTextColor(170, 170, 166);
  doc.setCharSpace(1.1);
  doc.text(t('cert.brandSub').toUpperCase(), cx, 27.5, { align: 'center' });
  doc.setCharSpace(0);

  // ── Title ───────────────────────────────────────────────
  ink(MUTED);
  text(7.5);
  doc.setCharSpace(2.2);
  doc.text(t('cert.title').toUpperCase(), cx, 48, { align: 'center' });
  doc.setCharSpace(0);

  // ── Who ─────────────────────────────────────────────────
  ink(MUTED);
  text(9);
  doc.text(t('cert.certifies'), cx, 62, { align: 'center' });

  ink(INK);
  bold(26);
  doc.text(ownerName, cx, 77, { align: 'center' });

  ink(MUTED);
  text(9);
  doc.text(t('cert.completed'), cx, 89, { align: 'center' });

  // ── What ────────────────────────────────────────────────
  ink(INK);
  bold(17);
  doc.text(t('cert.stageLine', { n: stageNumber, name: stageName }), cx, 102, { align: 'center' });

  // The one accent on the page, under the thing being certified.
  strok(VERIFIED);
  doc.setLineWidth(1.1);
  doc.line(cx - 26, 106.5, cx + 26, 106.5);

  ink(MUTED);
  text(8.5);
  doc.text(t('cert.ofProject'), cx, 116, { align: 'center' });

  ink(INK);
  bold(13);
  doc.text(projectName, cx, 125, { align: 'center' });

  if (location) {
    ink(MUTED);
    text(8);
    doc.text(location, cx, 132, { align: 'center' });
  }

  // ── The stage spine ─────────────────────────────────────
  //
  // The same ten-dot device the app draws on every project row, so the certificate
  // shows where this stage sits in the whole build. Filled to `stageNumber`, hollow
  // after it. This is the part no generic certificate template has.
  const dots = Math.max(1, totalStages);
  const span = Math.min(150, dots * 15);
  const gap = dots > 1 ? span / (dots - 1) : 0;
  const spineY = 145;
  const startX = cx - span / 2;

  strok(RULE);
  doc.setLineWidth(0.5);
  doc.line(startX, spineY, startX + span, spineY);

  if (stageNumber > 1) {
    strok(VERIFIED);
    doc.setLineWidth(0.9);
    doc.line(startX, spineY, startX + gap * (stageNumber - 1), spineY);
  }

  for (let i = 1; i <= dots; i++) {
    const x = startX + gap * (i - 1);
    if (i <= stageNumber) {
      fill(VERIFIED);
      strok(VERIFIED);
      doc.setLineWidth(0.4);
      doc.circle(x, spineY, i === stageNumber ? 2.6 : 1.7, 'FD');
    } else {
      fill(CANVAS);
      strok(RULE);
      doc.setLineWidth(0.5);
      doc.circle(x, spineY, 1.7, 'FD');
    }
  }

  ink(MUTED);
  text(6.5);
  doc.setCharSpace(0.8);
  doc.text(
    t('cert.stageOfTotal', { n: stageNumber, total: dots }).toUpperCase(),
    cx, spineY + 8, { align: 'center' },
  );
  doc.setCharSpace(0);

  // ── Footer ──────────────────────────────────────────────
  //
  // Three columns on one line, then a band beneath it holding the seal, the id and
  // the QR. The first draft put the QR and the "verified by" column in the same
  // corner and they overlapped; everything below is laid out from explicit bands so
  // that cannot happen again.
  const ruleY  = 158;
  const labelY = 165;
  const valueY = 172;

  strok(RULE);
  doc.setLineWidth(0.4);
  doc.line(26, ruleY, W - 26, ruleY);

  const label = (s2: string, x: number, align: 'left' | 'center' | 'right') => {
    ink(MUTED); text(6);
    doc.setCharSpace(0.9);
    doc.text(s2.toUpperCase(), x, labelY, { align });
    doc.setCharSpace(0);
  };
  const value = (s2: string, x: number, align: 'left' | 'center' | 'right') => {
    ink(INK); bold(9.5);
    doc.text(s2, x, valueY, { align });
  };

  label(t('cert.dateIssued'), 26, 'left');
  value(formatDate(issuedAt, lang), 26, 'left');

  if (contractorName) {
    label(t('cert.builtBy'), cx, 'center');
    value(contractorName, cx, 'center');
  }

  label(t('cert.verifiedBy'), W - 26, 'right');
  value(t('cert.reviewTeam'), W - 26, 'right');

  // ── The seal ────────────────────────────────────────────
  //
  // Was 12mm carrying three lines at 3.5–4.5pt, which prints as a smudge. A solid
  // disc with the stage number reads at any size and says which stage without being
  // read at all.
  const sealY = 186;
  fill(VERIFIED);
  doc.circle(cx, sealY, 10.5, 'F');
  ink([255, 255, 255]);
  bold(13);
  doc.text(String(stageNumber), cx, sealY + 0.6, { align: 'center' });
  text(4.4);
  doc.setCharSpace(0.5);
  doc.text(t('cert.sealVerified').toUpperCase(), cx, sealY + 5.6, { align: 'center' });
  doc.setCharSpace(0);

  // ── Identity, bottom left ───────────────────────────────
  const verifyUrl = siteLink(`verify/${encodeURIComponent(certificateId)}`);

  ink(MUTED);
  text(6);
  doc.setCharSpace(0.9);
  doc.text(t('cert.certificateId').toUpperCase(), 26, 181);
  doc.setCharSpace(0);

  ink(INK);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(shortId(certificateId), 26, 188);

  ink(MUTED);
  text(5.6);
  doc.text(verifyUrl, 26, 194);

  // ── The QR, bottom right ────────────────────────────────
  //
  // 'M' error correction survives a crease or a thumb over a corner, which a printed
  // certificate will meet. Margin 0 because the layout provides it.
  try {
    const qr = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'M', margin: 0, width: 320,
      color: { dark: '#0a0a0aff', light: '#f7f7f5ff' },
    });
    const size = 19;
    const qrX = W - 26 - size;
    const qrY = 176;
    doc.addImage(qr, 'PNG', qrX, qrY, size, size);
    ink(MUTED);
    text(5.6);
    doc.text(t('cert.scanToVerify'), qrX + size / 2, qrY + size + 4, { align: 'center' });
  } catch {
    // A certificate without its QR is still a certificate: the short id and the full
    // URL are printed on the left, so it can be checked by hand.
  }

  return doc.output('blob');
}
