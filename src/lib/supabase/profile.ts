import { supabase } from './client';

export async function updateProfile(updates: {
  full_name?: string;
  phone?: string;
  country?: string;
}): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: updates });
  if (error) {
    throw new Error(error.message);
  }
}

export async function uploadIdDocument(
  userId: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const MAX_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new Error('File exceeds 5 MB limit');
  }

  const ext = file.name.split('.').pop();
  const path = `${userId}/id_${Date.now()}.${ext}`;

  return new Promise<string>((resolve, reject) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress = Math.min(progress + 6, 90);
      onProgress(progress);
    }, 80);

    supabase.storage
      .from('id-documents')
      .upload(path, file, { upsert: true })
      .then(({ error }) => {
        clearInterval(interval);
        if (error) {
          reject(new Error(`Failed to upload ID document: ${error.message}`));
        } else {
          onProgress(100);
          resolve(path);
        }
      })
      .catch((err: unknown) => {
        clearInterval(interval);
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to upload ID document: ${message}`));
      });
  });
}

export async function getIdDocumentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('id-documents')
    .createSignedUrl(path, 3600);

  if (error || !data) {
    return null;
  }

  return data.signedUrl;
}
