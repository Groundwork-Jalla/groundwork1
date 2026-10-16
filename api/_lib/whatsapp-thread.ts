import { ghlConfig, ensureConversation, upsertContact } from '../ghl/_client.js';
import { normalisePhone } from '../ghl/_phone.js';
import { accessToken } from '../ghl/_oauth.js';
import { resolveWhatsAppThread, isDeliverablePhone, type WhatsAppRow }
  from '../../src/lib/admin/whatsapp-shortcut.js';

/**
 * A person's one WhatsApp thread, established through the provider if they have none.
 *
 * ── Why this is its own module ───────────────────────────────────────────────────────
 * It was the body of the `project-whatsapp` handler, interleaved with HTTP responses, so
 * the second caller that needed it — the message fan-out, which has to reach several
 * people in one request — could not have it without copying it. A copy would have been
 * the bad kind: "one person, one chat" is enforced here, by reading the rows and letting
 * provider identity decide, and two implementations of that rule drift into two threads
 * for one person.
 *
 * So the rule lives here once, and the handlers do the HTTP.
 *
 * ── It refuses rather than pretends ──────────────────────────────────────────────────
 * No phone, an unusable phone, a CRM that will not create a contact, a provider that will
 * not open a thread — each is its own reason and creates nothing. A conversation row that
 * exists but cannot carry a message is worse than no row: it looks like a working chat and
 * silently drops what is typed into it.
 */

export type ThreadResult =
  | { ok: true; conversationId: string; contactId: string | null;
      /** The PROVIDER's thread id. Passing it to a send saves re-resolving it per message. */
      ghlConversationId: string | null; created: boolean }
  | { ok: false; reason: 'no_phone' | 'not_configured' | 'contact_failed' | 'provider_failed'
        | 'record_failed' | 'conversations_unavailable' | 'ambiguous';
      conversationIds?: string[]; detail?: string };

/**
 * `svc` must be a service-role client: 091 writes conversations through privileged paths
 * only. Proving who the CALLER is stays with the handler — this does no authorisation,
 * and must never be reached from one that skipped it.
 */
export async function resolveOrEstablishWhatsApp(
  svc: {
    from: (t: string) => any;
  },
  personId: string,
): Promise<ThreadResult> {
  const { data: profile } = await svc
    .from('profiles').select('id, email, full_name, phone, country, ghl_contact_id')
    .eq('id', personId).maybeSingle();

  // ── Is there already a chat with this person? ──────────────────────────────────────
  const { data: convRows, error: convErr } = await svc
    .from('conversations')
    .select('id, person_id, project_id, channel, ghl_conversation_id, ghl_contact_id, last_message_at, created_at')
    .eq('person_id', personId).eq('channel', 'whatsapp');
  if (convErr) return { ok: false, reason: 'conversations_unavailable' };

  const rows: WhatsAppRow[] = ((convRows ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    personId: (r.person_id as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    channel: String(r.channel ?? ''),
    ghlConversationId: (r.ghl_conversation_id as string | null) ?? null,
    ghlContactId: (r.ghl_contact_id as string | null) ?? null,
    lastMessageAt: (r.last_message_at as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }));

  const resolved = resolveWhatsAppThread(rows, personId);
  if (resolved.kind === 'found') {
    const row = rows.find(r => r.id === resolved.conversationId);
    // Opened exactly as it is. project_id is not read, not compared and not written.
    return {
      ok: true, created: false, conversationId: resolved.conversationId,
      contactId: row?.ghlContactId ?? (profile?.ghl_contact_id as string | null) ?? null,
      ghlConversationId: row?.ghlConversationId ?? null,
    };
  }
  if (resolved.kind === 'ambiguous') {
    // Two provider threads for one person is a data problem, not something to resolve by
    // picking one — and certainly not by adding a third.
    return { ok: false, reason: 'ambiguous', conversationIds: resolved.conversationIds };
  }

  // ── Nothing yet: establish the one chat, through the provider ──────────────────────
  const phone = normalisePhone((profile?.phone as string | null) ?? null, (profile?.country as string | null) ?? null);
  if (!profile?.ghl_contact_id && !isDeliverablePhone(phone)) {
    // Without a contact we must create one, and a contact needs a number WhatsApp can
    // reach. `normalisePhone` hands back whatever it was given when it cannot place it,
    // so "it returned something" is not the same as "this is a phone number".
    return { ok: false, reason: 'no_phone' };
  }

  const cfg = await ghlConfig();
  if (!cfg) return { ok: false, reason: 'not_configured' };

  let contactId = (profile?.ghl_contact_id as string | null) ?? null;
  if (!contactId) {
    const made = await upsertContact(cfg, {
      email: (profile?.email as string | null) ?? undefined,
      name: (profile?.full_name as string | null) ?? undefined,
      phone: phone ?? undefined,
      country: (profile?.country as string | null) ?? undefined,
      source: 'groundwork_project_whatsapp',
    } as never);
    if (!made.ok || !made.data?.contactId) {
      console.error('[whatsapp-thread] the CRM would not resolve a contact', made.ok ? 'no id' : made.error);
      return { ok: false, reason: 'contact_failed', detail: made.ok ? 'no_contact_id' : made.error };
    }
    contactId = made.data.contactId;
    // Learn it, so the next call — and every other part of the product — skips this.
    await svc.from('profiles').update({ ghl_contact_id: contactId }).eq('id', personId).is('ghl_contact_id', null);
  }

  const bearer = (await accessToken()) ?? undefined;
  const ghlConversationId = await ensureConversation(cfg, contactId, bearer);
  if (!ghlConversationId) return { ok: false, reason: 'provider_failed' };

  // Another row may already hold this provider thread — a race, or a row whose person
  // differs. The unique index is the authority: on conflict, read back the row that owns
  // it and use that. Nothing is ever overwritten to win a collision.
  const { data: inserted, error: insErr } = await svc.from('conversations')
    .insert({ person_id: personId, channel: 'whatsapp', ghl_contact_id: contactId, ghl_conversation_id: ghlConversationId })
    .select('id').single();

  if (insErr) {
    const { data: owner } = await svc.from('conversations')
      .select('id').eq('ghl_conversation_id', ghlConversationId).maybeSingle();
    if (owner?.id) return { ok: true, conversationId: String(owner.id), contactId, ghlConversationId, created: false };
    console.error('[whatsapp-thread] could not record the conversation:', insErr.message);
    return { ok: false, reason: 'record_failed' };
  }

  return { ok: true, conversationId: String(inserted.id), contactId, ghlConversationId, created: true };
}
