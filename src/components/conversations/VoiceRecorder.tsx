import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// A voice note.
//
// On site, typing is the slow way to say something. Somebody standing on a slab with
// one hand free will record ten seconds; they will not type a paragraph.
//
// ── Which format you get is the browser's choice ────────────────────────────────────
// MediaRecorder produces webm on Chrome and mp4 on Safari, and neither lets you insist.
// The bucket allows both (124) — allowing only one would be a feature that works on
// half the phones in Cameroon and silently fails on the rest.
//
// ── The microphone is released ──────────────────────────────────────────────────────
// Every track is stopped when recording ends and again on unmount. A page that keeps
// the mic open leaves the recording indicator lit, which reads as being listened to.
// =========================================================

/** Formats to try, best first. The first the browser admits to is used. */
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATES.find(t => MediaRecorder.isTypeSupported?.(t));
}

export function VoiceRecorder({ onRecorded, disabled }: {
  onRecorded: (clip: File) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  /** Let go of the microphone. Called on stop, on cancel and on unmount. */
  function release() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    recorder.current = null;
    setRecording(false);
    setSeconds(0);
  }

  useEffect(() => release, []);

  async function start() {
    setProblem(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia
      || typeof MediaRecorder === 'undefined') {
      setProblem(t('chat.voice.unsupported'));
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      cancelled.current = false;
      chunks.current = [];

      const mimeType = pickMimeType();
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = rec;

      rec.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        // A cancelled recording is discarded here rather than by not calling stop():
        // stop() is what releases the microphone, so it always runs.
        if (!cancelled.current && blob.size > 0) {
          // The extension follows the type the browser actually produced, so the file
          // is playable by whoever receives it.
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          onRecorded(new File([blob], `voice-${Date.now()}.${ext}`, { type: type.split(';')[0] }));
        }
        release();
      };

      rec.start();
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      // Refused permission, or no microphone. Both are the person's answer, not an
      // error to shout about.
      setProblem(t('chat.voice.noPermission'));
      release();
    }
  }

  function stop(discard = false) {
    cancelled.current = discard;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else release();
  }

  if (!recording) {
    return (
      <>
        <button
          type="button" onClick={() => void start()} disabled={disabled}
          aria-label={t('chat.voice.record')} title={t('chat.voice.record')}
          className="rounded-lg p-2 text-brand-mid-grey hover:bg-brand-off-white disabled:opacity-40 dark:hover:bg-[#2c2c2c]"
        >
          <Mic className="size-4" aria-hidden />
        </button>
        {problem && <span role="alert" className="text-xs text-state-alert">{problem}</span>}
      </>
    );
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-state-alert/10 px-2.5 py-1.5">
      <span className={cn('size-2 rounded-full bg-state-alert', 'animate-pulse')} aria-hidden />
      <span className="font-mono text-xs tabular-nums text-brand-near-black dark:text-white">
        {mm}:{ss}
      </span>
      <button
        type="button" onClick={() => stop(true)}
        aria-label={t('chat.voice.discard')} title={t('chat.voice.discard')}
        className="rounded p-1 text-brand-mid-grey hover:text-state-alert"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
      <button
        type="button" onClick={() => stop(false)}
        aria-label={t('chat.voice.stop')} title={t('chat.voice.stop')}
        className="rounded p-1 text-brand-near-black dark:text-white"
      >
        <Square className="size-3.5 fill-current" aria-hidden />
      </button>
    </span>
  );
}
