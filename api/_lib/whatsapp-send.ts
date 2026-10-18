import { ghlConfig, sendWhatsAppMessage } from '../ghl/_client.js';
import { accessToken } from '../ghl/_oauth.js';

/**
 * Send a WhatsApp message, by whatever carries WhatsApp today.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────
 * Sending was wired straight into GoHighLevel, and GHL sends to a CONTACT RECORD, not to
 * a number: it needs a contact that exists, in the right location, carrying a phone. Live
 * testing failed on exactly that — Groundwork held +237… and the contact it had to send
 * through held nothing, so every message died with CONVERSATIONS_MSG_NO_PHONE. The number
 * was never the problem; the record in between was.
 *
 * Meta's Cloud API takes the number itself. No contact, no CRM sync, nothing to drift.
 * So where it is configured it is used, and GoHighLevel becomes the fallback rather than
 * the dependency — which is also what "we want to send WhatsApp through Groundwork,
 * whether or not it is synchronised to GoHighLevel" asks for.
 *
 * ── The 24-hour window is a WhatsApp rule, not ours ─────────────────────────────────
 * Meta only accepts free text to someone who has messaged the business in the last 24
 * hours. Outside that window a business-initiated message MUST be an approved template,
 * and a plain text send is refused with error 131047. That is not a limitation of this
 * code and cannot be coded around: it is how WhatsApp Business works, and the template
 * has to be submitted to Meta and approved before it can be used.
 *
 * So: free text is attempted, and if Meta refuses for that reason and a template is
 * configured, the template is sent instead. With no template configured the refusal is
 * reported as it is, rather than being logged as a generic failure.
 */

export interface WhatsAppTarget {
  /** E.164, with the +. What Meta sends to. */
  phone: string | null;
  /** GoHighLevel's contact id. Only the GHL path needs it. */
  contactId: string | null;
  conversationId: string | null;
}

export type WhatsAppSendResult =
  | { ok: true; provider: 'meta' | 'ghl'; providerMessageId: string | null }
  | { ok: false; provider: 'meta' | 'ghl' | 'none'; error: string };

interface MetaConfig { phoneNumberId: string; token: string; template: string | null; lang: string }

/**
 * Meta's credentials, from `app_config` first and the environment second.
 *
 * `app_config` first on purpose: adding a row there is a SQL statement, and adding an
 * environment variable is a redeploy — which is the thing that has blocked this project
 * twice already. RLS keeps the table unreadable from the browser (058).
 */
async function metaConfig(svc: { from: (t: string) => any }): Promise<MetaConfig | null> {
  const keys = ['whatsapp_phone_number_id', 'whatsapp_token', 'whatsapp_template', 'whatsapp_template_lang'];
  const { data } = await svc.from('app_config').select('key, value').in('key', keys);
  const row: Record<string, string> = {};
  for (const r of ((data ?? []) as Record<string, unknown>[])) row[String(r.key)] = String(r.value ?? '');

  const phoneNumberId = row.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const token         = row.whatsapp_token           || process.env.WHATSAPP_TOKEN || '';
  if (!phoneNumberId || !token) return null;
  return {
    phoneNumberId, token,
    template: row.whatsapp_template || process.env.WHATSAPP_TEMPLATE || null,
    lang:     row.whatsapp_template_lang || process.env.WHATSAPP_TEMPLATE_LANG || 'en',
  };
}

/** Meta wants digits only — no plus, no spaces. */
const digits = (e164: string) => e164.replace(/[^\d]/g, '');

async function metaSend(cfg: MetaConfig, phone: string, body: string): Promise<WhatsAppSendResult> {
  const url = `https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`;
  const post = async (payload: Record<string, unknown>) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: digits(phone), ...payload }),
    });
    const json = await r.json().catch(() => ({} as Record<string, unknown>));
    return { ok: r.ok, json: json as Record<string, any> };
  };

  const text = await post({ type: 'text', text: { preview_url: false, body } });
  if (text.ok) {
    return { ok: true, provider: 'meta', providerMessageId: text.json?.messages?.[0]?.id ?? null };
  }

  const code = text.json?.error?.code;
  const outsideWindow = code === 131047 || code === 131051;

  // Outside the 24-hour window, only an approved template may be sent. Nothing here can
  // change that — the template must already exist and be approved at Meta.
  if (outsideWindow && cfg.template) {
    const tpl = await post({
      type: 'template',
      template: { name: cfg.template, language: { code: cfg.lang } },
    });
    if (tpl.ok) {
      return { ok: true, provider: 'meta', providerMessageId: tpl.json?.messages?.[0]?.id ?? null };
    }
    return { ok: false, provider: 'meta', error: `template_failed: ${JSON.stringify(tpl.json?.error ?? {})}` };
  }

  if (outsideWindow) {
    // Named precisely, because the fix is operational (approve a template), not a code change.
    return { ok: false, provider: 'meta', error: 'outside_24h_window: a message template is required and none is configured' };
  }
  return { ok: false, provider: 'meta', error: JSON.stringify(text.json?.error ?? { status: 'unknown' }) };
}

/**
 * One call, whichever transport is available. Meta when configured — it needs only the
 * number — and GoHighLevel otherwise, which needs the contact and is why this seam exists.
 */
export async function sendWhatsApp(
  svc: { from: (t: string) => any },
  target: WhatsAppTarget,
  body: string,
): Promise<WhatsAppSendResult> {
  const meta = await metaConfig(svc);
  if (meta && target.phone) return metaSend(meta, target.phone, body);

  const cfg = await ghlConfig();
  if (!cfg) {
    return { ok: false, provider: 'none',
      error: meta ? 'no_phone_for_meta' : 'not_configured: neither Meta nor GoHighLevel is set up' };
  }
  if (!target.contactId) return { ok: false, provider: 'ghl', error: 'no_contact' };

  const bearer = (await accessToken()) ?? undefined;
  const sent = await sendWhatsAppMessage(cfg,
    { contactId: target.contactId, conversationId: target.conversationId, body }, bearer);
  return sent.ok
    ? { ok: true, provider: 'ghl', providerMessageId: sent.data?.messageId ?? null }
    : { ok: false, provider: 'ghl', error: String(sent.error ?? 'provider_failed') };
}
