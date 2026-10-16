import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { signAttachment, isImage, type ChatAttachment } from '@/lib/supabase/chat-attachments';
import { useT } from '@/lib/i18n';

// =========================================================
// Showing what was attached to a message.
//
// The bucket is private, so every item needs a signed link before it can be rendered.
// Signed per view and never stored: a URL kept on the row would either outlive the
// person's right to see it or expire into a broken image.
//
// Three shapes, because they are three different things to a reader:
//   · a photograph  — shown, because the point of sending it is to be looked at
//   · a voice note  — a player, because nobody downloads a ten-second clip to hear it
//   · anything else — a named link, because a PDF is opened deliberately
// =========================================================

export function MessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {attachments.map(a => <One key={a.path} attachment={a} />)}
    </div>
  );
}

function One({ attachment }: { attachment: ChatAttachment }) {
  const t = useT();
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    signAttachment(attachment.path)
      .then(u => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [attachment.path]);

  if (url === undefined) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-brand-mid-grey">
      <Loader2 className="size-3 animate-spin" aria-hidden />{attachment.name}
    </span>;
  }
  if (url === null) {
    // Named, so it is clear something was sent and that the problem is opening it —
    // not that the message was empty.
    return <span role="alert" className="text-xs text-brand-mid-grey">
      {t('chat.attachment.unavailable', { name: attachment.name })}
    </span>;
  }

  if (attachment.kind === 'voice') {
    return (
      <audio controls preload="none" src={url} className="h-9 w-full max-w-xs">
        {t('chat.attachment.noAudio')}
      </audio>
    );
  }

  if (isImage(attachment)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url} alt={attachment.name} loading="lazy"
          className="max-h-60 w-auto max-w-full rounded-lg border border-brand-border-grey object-cover dark:border-[#2c2c2c]"
        />
      </a>
    );
  }

  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-brand-border-grey px-2.5 py-1.5 text-xs font-medium text-brand-near-black hover:bg-brand-off-white dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#2c2c2c]"
    >
      <FileText className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{attachment.name}</span>
    </a>
  );
}
