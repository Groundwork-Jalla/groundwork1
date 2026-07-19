import { supabase } from './client';
import { generateCertificate } from '../certificates/generate-certificate';

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
  stageName:   string;
}): Promise<string> {
  const { projectId, stageId, stageNumber, ownerName, projectName, stageName } = opts;

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
