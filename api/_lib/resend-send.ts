/**
 * One place that talks to Resend, and keeps trying when the answer is "not now".
 *
 * ── Why a retry belongs here and not at the call site ──────────────────────────────
 *
 * Favour, 9 Nov 2026: "an email invite shouldn't even fail." Most of the time it
 * doesn't fail in the sense of being refused — it fails in the sense of being asked at
 * a bad moment. A 429 is a rate limit, a 502 is somebody else's bad minute, and a
 * dropped socket is a Cameroonian mobile connection doing what it does. Every one of
 * those is a retry, and treating them as verdicts is how an invitation disappears.
 *
 * A 4xx that is not 429 is a verdict: a malformed address, a rejected domain, a bad
 * key. Trying that again just spends the rate limit telling us the same thing.
 *
 * ── Bounded, and short ─────────────────────────────────────────────────────────────
 *
 * Two retries, ~0.4s and ~1.2s. This runs inside a serverless invocation somebody is
 * waiting on, so the budget is about a second and a half, not a minute. Anything that
 * survives that is left for the sweeper, which has an hour and no one watching.
 *
 * No imports from `src/`, no `import.meta`: reachable from `api/`. See api/README.md.
 */

export interface SendResult {
  ok: boolean;
  /**
   * Resend's id for the message.
   *
   * The only handle on it afterwards: a delivery receipt arrives quoting this and
   * nothing else, so a send that does not keep it can never be told whether it
   * arrived (178).
   */
  messageId?: string;
  /** Present when it did not send. Short enough to store on the row. */
  error?: string;
  /** True when another attempt later is worth making. */
  retryable?: boolean;
  attempts: number;
}

export interface SendInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

const BACKOFF_MS = [400, 1200];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 429 and 5xx are "ask again"; every other 4xx is an answer. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function sendViaResend(input: SendInput): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  // Not a transient fault and not worth retrying: nothing will send until somebody
  // sets the variable. Named plainly so the stored error says what to do.
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set', retryable: false, attempts: 0 };

  let attempts = 0;
  let last = 'unknown';
  let retryable = true;

  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    attempts++;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
          ...(input.cc?.length ? { cc: input.cc } : {}),
          ...(input.bcc?.length ? { bcc: input.bcc } : {}),
        }),
      });

      if (res.ok) {
        const body = await res.json().catch(() => ({})) as { id?: string };
        return { ok: true, attempts, messageId: typeof body.id === 'string' ? body.id : undefined };
      }

      // The body carries Resend's own reason — "domain is not verified", "invalid
      // `to`" — which is the only thing that makes a stored error actionable.
      const body = await res.text().catch(() => '');
      last = `resend_${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
      retryable = retryableStatus(res.status);
      if (!retryable) break;
    } catch (err) {
      // No response at all: DNS, a dropped socket, a timeout. Always worth another go.
      last = `network: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
      retryable = true;
    }

    if (i < BACKOFF_MS.length) await sleep(BACKOFF_MS[i]);
  }

  return { ok: false, error: last, retryable, attempts };
}
