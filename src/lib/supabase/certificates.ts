import { supabase } from './client';
import { generateCertificate } from '../certificates/generate-certificate';
import type { Lang } from '@/lib/i18n/types';

// =========================================================
// issueCertificate
// Generates a PDF, uploads to the 'certificates' bucket,
// inserts a row into the certificates table, returns the
// public URL. Throws on any error.
// =========================================================
export async function issueCertificate(opts: {
  projectId:   string;
  stageId:     string;
  stageNumber: number;
  ownerName:   string;
  projectName: string;
  /** Already translated by the caller from `stage_key`. */
  stageName:   string;
  /**
   * The *owner's* language, not the approving admin's. A certificate is rendered once
   * and stored as a PDF; there is no re-render later, so whatever is chosen here is
   * what the owner downloads forever.
   */
  lang:        Lang;
}): Promise<string> {
  const { projectId, stageId, stageNumber, ownerName, projectName, stageName, lang } = opts;

  // 1. Pre-generate a UUID so the PDF can embed the verify URL
  const certId = crypto.randomUUID();

  // 2. Generate PDF blob
  const blob = await generateCertificate({
    projectName,
    stageName,
    stageNumber,
    ownerName,
    issuedAt: new Date(),
    certificateId: certId,
    lang,
  });

  // 3. Upload to 'certificates' bucket — public read bucket
  const storagePath = `${projectId}/${stageId}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('certificates')
    .upload(storagePath, blob, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  // 4. Build public URL
  const { data: urlData } = supabase.storage
    .from('certificates')
    .getPublicUrl(storagePath);

  const pdfUrl = urlData.publicUrl;

  // 5. Insert record
  const { error: insertError } = await supabase
    .from('certificates')
    .insert({
      id:           certId,
      project_id:   projectId,
      stage_id:     stageId,
      stage_number: stageNumber,
      issued_to:    ownerName,
      project_name: projectName,
      stage_name:   stageName,
      storage_path: storagePath,
      pdf_url:      pdfUrl,
    });

  if (insertError) throw insertError;

  return pdfUrl;
}

// =========================================================
// getCertificate — for /verify/:id public page
// =========================================================
export async function getCertificate(id: string) {
  const { data, error } = await supabase
    .from('certificates')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// =========================================================
// What has actually been issued on a project.
//
// 31 Oct 2026. The contractor's Documents tab listed a certificate for every approved
// stage and put a "Share" label beside it that was a `<span>` — no link, no handler.
// Philip: "I can't view any of these documents here." Two separate faults: the label
// was not a control, and the list was derived from STAGES rather than from
// certificates that exist, so a stage approved before certificates were issued showed
// a row with nothing behind it.
//
// This returns what was really issued, keyed by stage, so the tab can offer a button
// only where there is a file to open.
// =========================================================

export interface IssuedCertificate {
  id: string;
  stageId: string;
  pdfUrl: string | null;
}

export async function fetchProjectCertificates(projectId: string): Promise<Map<string, IssuedCertificate>> {
  const out = new Map<string, IssuedCertificate>();
  const { data, error } = await supabase
    .from('certificates')
    .select('id, stage_id, pdf_url')
    .eq('project_id', projectId);
  // A project with no certificates, or a deployment without the table, is an empty
  // map: the tab then shows the stages with no button, which is the truth.
  if (error) return out;
  for (const row of (data ?? []) as { id: string; stage_id: string; pdf_url: string | null }[]) {
    if (row.stage_id) out.set(String(row.stage_id), {
      id: String(row.id), stageId: String(row.stage_id), pdfUrl: row.pdf_url ?? null,
    });
  }
  return out;
}
