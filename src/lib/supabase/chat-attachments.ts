import { supabase } from './client';

// =========================================================
// Files and voice notes on a conversation (124).
//
// A build is discussed in photographs. A client asking "is this crack normal?" sends a
// picture; a contractor answering sends three more. Making them describe it in words is
// making them use WhatsApp instead, which is the thing this thread exists to replace.
//
// ── Paths, never URLs ───────────────────────────────────────────────────────────────
// The bucket is private, and what is stored on the message is the object's PATH. A URL
// signed today is a URL that works for anyone who has it and stops working in an hour;
// neither is a property you want in a row that outlives the conversation. Links are
// signed on demand, when somebody who may read the message asks for one.
// =========================================================

export const CHAT_BUCKET = 'chat-attachments';

/** 25 MB, matching the bucket. A minute of voice is ~1 MB; a phone photo is 2–6 MB. */
export const MAX_ATTACHMENT_MB = 25;

export interface ChatAttachment {
  /** Object path in `chat-attachments`. Never a URL. */
  path: string;
  name: string;
  type: string;
  size: number;
  /** `voice` gets a player; everything else gets a download link. */
  kind: 'file' | 'voice';
}

/** What the bucket will take. Anything else is refused before it is uploaded. */
const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv', 'text/plain',
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav',
]);

export const ATTACHMENT_ACCEPT = [...ALLOWED].join(',');

export function isImage(a: ChatAttachment): boolean {
  return a.type.startsWith('image/');
}

/**
 * Why this file cannot be sent, or null.
 *
 * Checked here as well as by the bucket, because being told at the moment you pick a
 * file is useful and being told after a 20 MB upload is not.
 */
export function attachmentProblem(file: File): 'size' | 'type' | null {
  if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) return 'size';
  // A browser sometimes reports no type at all for an obscure extension. The bucket is
  // the authority; an empty type is let through for it to decide.
  if (file.type && !ALLOWED.has(file.type)) return 'type';
  return null;
}

/**
 * Put a file on a conversation and describe it.
 *
 * The path carries the conversation id because that is what the storage policy reads:
 * `conversations/<id>/<file>` (124). A name the person chose is never part of the
 * path — it is user input, and it ends up in a URL.
 */
export async function uploadChatAttachment(
  conversationId: string, file: File, kind: 'file' | 'voice' = 'file',
): Promise<ChatAttachment> {
  const ext = (/\.([a-zA-Z0-9]{1,8})$/.exec(file.name)?.[1]
    ?? file.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '')
    ?? 'bin').toLowerCase();
  const path = `conversations/${conversationId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;

  return {
    path,
    name: file.name || (kind === 'voice' ? 'Voice note' : 'Attachment'),
    type: file.type || 'application/octet-stream',
    size: file.size,
    kind,
  };
}

/**
 * A link somebody can actually open, valid for an hour.
 *
 * Signed per view rather than stored: the bucket is private, and a URL kept on the row
 * would either outlive the person's right to see it or expire into a broken image.
 */
export async function signAttachment(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Read whatever is on a message back into the shape the UI renders. */
export function toAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const path = typeof r.path === 'string' ? r.path : '';
    if (!path) return [];
    return [{
      path,
      name: typeof r.name === 'string' && r.name ? r.name : 'Attachment',
      type: typeof r.type === 'string' ? r.type : '',
      size: typeof r.size === 'number' ? r.size : 0,
      kind: r.kind === 'voice' ? 'voice' : 'file',
    } as ChatAttachment];
  });
}
