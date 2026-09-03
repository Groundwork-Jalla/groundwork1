import { ghlConfig } from '../ghl/_client.js';
import { logEmailToCrm } from '../ghl/_email-log.js';
import { syncContractorToApi } from '../ghl/_contractor-sync.js';
import { forwardToGhl } from '../ghl/_forward.js';

/**
 * Put everyone already in Supabase into GoHighLevel, with their correspondence.
 *
 * The CRM was connected after most of these people arrived, so it holds 29 contractors
 * synced piecemeal and almost no homeowners. This walks the whole set: contact, custom
 * fields, tags, pipeline card, and a Conversations thread carrying what we have said to
 * them — which is the thing that makes a contact answerable rather than just present.
 *
 * ── THE RISK THIS IS BUILT AROUND ────────────────────────────────────────────────────
 * The obvious implementation emails everybody. That would tell a contractor who was
 * accepted three weeks ago that their application "has been received and is under
 * review", and tell a homeowner who has already built a project to "get started". Both
 * are worse than silence: they say plainly that we have lost track of the person.
 *
 * So there are two outcomes per person, decided from what the database already knows:
 *
 *   SEND      — never contacted. A real email goes out, and logging it is automatic.
 *   BACKFILL  — already contacted. The thread is written directly with a record of the
 *               email they were sent at the time. Nothing is delivered.
 *
 * Backfill is the whole reason this can run against a live list on launch day. The
 * Conversations tab fills for everybody; only the people who genuinely never heard from
 * us receive anything new.
 *
 * ── Dry run by default ───────────────────────────────────────────────────────────────
 * `send: true` is required to deliver anything. Without it this reports exactly who
 * would be emailed and who would be backfilled, which is a list worth reading before
 * mail goes to thirty-three people at once.
 */

const CHUNK_NOTE = 'Processed oldest first; re-run to continue if it stops early.';

/** Vercel's function timeout is the real limit here, not GHL's. */
const MAX_PER_RUN = 40;

export async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server is not configured' });
    return;
  }

  const token = String(req.headers?.authorization ?? '').replace(/^Bearer /i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? key;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    res.status(403).json({ error: 'Admins only' });
    return;
  }

  const cfg = await ghlConfig();
  if (!cfg) {
    res.status(200).json({ ok: false, detail: 'The GHL API is not configured' });
    return;
  }

  const svc = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const send = req.body?.send === true;
  const kind = req.body?.kind === 'users' ? 'users' : 'contractors';
  // Via the shared helper, not a literal: the apex 308-redirects to www and a
  // hardcoded origin has been wrong twice already. See src/lib/site-url.ts.
  const { siteUrl } = await import('../../src/lib/site-url.js');
  const site = siteUrl();

  const planned: Array<{ who: string; action: 'send' | 'backfill'; why: string }> = [];
  const done: Array<{ who: string; action: string; ok: boolean; detail?: string }> = [];

  // ══ Contractors ════════════════════════════════════════════════════════════════════
  if (kind === 'contractors') {
    const { data: rows, error } = await svc
      .from('contractor_applications')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) {
      res.status(200).json({ ok: false, step: 'read', detail: error.message });
      return;
    }

    const { applicationFromRow } = await import('../../src/lib/contractor/application-types.js');
    const { buildContractorApplicationHtml, contractorApplicationSubject } =
      await import('../../src/lib/email/contractor-application-html.js');
    const { buildApplicationDecisionHtml, applicationDecisionSubject } =
      await import('../../src/lib/email/application-decision-html.js');

    for (const row of rows ?? []) {
      const app = applicationFromRow(row as never);
      const lang = (row as { lang?: string }).lang === 'fr' ? 'fr' : 'en';
      const status = String((row as { status?: string }).status ?? 'pending');
      const decided = status === 'accepted' || status === 'rejected';
      const acknowledged = !!(row as { acknowledged_at?: string }).acknowledged_at;

      // A decision supersedes an acknowledgement: the last thing we said is what the
      // thread should show, and telling an accepted contractor they are "under review"
      // would be actively wrong.
      const subject = decided
        ? applicationDecisionSubject(lang, status as 'accepted' | 'rejected')
        : contractorApplicationSubject(lang);
      const html = decided
        ? buildApplicationDecisionHtml(lang, status as 'accepted' | 'rejected', app.fullName ?? '', site)
        : buildContractorApplicationHtml(lang, app);

      const action: 'send' | 'backfill' =
        (acknowledged || decided) ? 'backfill' : 'send';
      const why = decided ? `already ${status}`
                : acknowledged ? 'already acknowledged'
                : 'never contacted';

      if (!send) { planned.push({ who: app.email, action, why }); continue; }

      // The contact itself, with fields, tags, documents and a pipeline card.
      const sync = await syncContractorToApi(app, String(row.id), status, svc);

      // The correspondence. `logEmailToCrm` writes the thread; only the SEND branch
      // actually delivers, and it delivers through the same endpoint the app uses so
      // the email is identical to the one they would have had.
      let mailOk = true;
      let detail = sync.ok ? undefined : `sync: ${sync.reason ?? 'failed'}`;

      if (action === 'send') {
        const apiKey = process.env.RESEND_API_KEY;
        if (apiKey) {
          const sent = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Groundwork by Jalla <noreply@mail.tryjalla.com>',
              to: [app.email], subject, html,
            }),
          });
          mailOk = sent.ok;
          if (!sent.ok) detail = `resend ${sent.status}`;
          else await svc.from('contractor_applications')
            .update({ acknowledged_at: new Date().toISOString() }).eq('id', row.id);
        }
      }

      // Written either way — a backfill is the whole point for anyone already contacted.
      await logEmailToCrm({
        to: app.email, subject, html,
        kind: decided ? 'contractor_application_decision' : 'contractor_application_received',
        name: app.fullName ?? null,
      });

      done.push({ who: app.email, action, ok: sync.ok && mailOk, detail });
    }
  }

  // ══ Homeowners ═════════════════════════════════════════════════════════════════════
  else {
    const { data: rows, error } = await svc
      .from('profiles')
      .select('id, email, full_name, preferred_lang, country, phone, subscription_tier, subscription_status, crm_welcomed_at')
      .not('email', 'is', null)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) {
      res.status(200).json({ ok: false, step: 'read', detail: error.message });
      return;
    }

    const { buildUserWelcomeHtml, userWelcomeSubject } =
      await import('../../src/lib/email/user-welcome-html.js');

    // One query rather than one per person. Also carries what the project *is*, because
    // replaying `project_created` needs its name, tier and location — a card with a
    // blank name on the board is not much better than no card.
    const { data: projectRows } = await svc
      .from('projects')
      .select('id, user_id, name, tier, country, city, created_at')
      .order('created_at', { ascending: false });

    // Newest first, so the first one seen per owner is their most recent — which is the
    // one whose tier and location should describe them today.
    const newestProject = new Map<string, Record<string, unknown>>();
    for (const row of projectRows ?? []) {
      const owner = String(row.user_id);
      if (!newestProject.has(owner)) newestProject.set(owner, row);
    }
    const hasProject = (id: string) => newestProject.has(id);

    for (const p of rows ?? []) {
      const email = String(p.email ?? '').trim();
      if (!email) continue;
      const lang = p.preferred_lang === 'fr' ? 'fr' : 'en';
      const built = hasProject(String(p.id));

      // Same rule as the contractor path, off `crm_welcomed_at` instead of
      // `acknowledged_at`: a welcome already sent is backfilled onto the thread, never
      // sent again. Without this the second run duplicates the first — which is what
      // "26 send, 0 backfill" was about to do to 24 people.
      const welcomed = !!p.crm_welcomed_at;
      const action: 'send' | 'backfill' = welcomed ? 'backfill' : 'send';
      const why = welcomed ? 'already welcomed'
                : built    ? 'has a project, never welcomed'
                           : 'never welcomed';

      if (!send) { planned.push({ who: email, action, why }); continue; }

      const subject = userWelcomeSubject(lang, built);
      const html = buildUserWelcomeHtml(lang, {
        name: p.full_name as string | null, site, hasProject: built,
      });

      // ── Replay their history in order, so the board ends up telling the truth ──────
      // Each event moves the same card, so the last one to fire decides where they
      // stand. Sequence matters: somebody who signed up, built, and then subscribed
      // should be sitting in Subscribed, not Signed up — which is exactly what firing
      // only `user_signup` would have left behind.
      const contact = {
        email,
        fullName: p.full_name as string | null,
        phone:    p.phone as string | null,
        country:  p.country as string | null,
        lang,
      };

      await forwardToGhl('user_signup', contact, { user_id: String(p.id) },
        { dedupeKey: `backfill_signup_${p.id}` });

      const project = newestProject.get(String(p.id));
      if (project) {
        await forwardToGhl('project_created', contact, {
          user_id:       String(p.id),
          project_id:    String(project.id ?? ''),
          project_name:  String(project.name ?? ''),
          project_tier:  String(project.tier ?? ''),
          build_country: String(project.country ?? ''),
          build_city:    String(project.city ?? ''),
        }, {
          dedupeKey: `backfill_project_${project.id}`,
          tier: project.tier as string | null,
        });
      }

      // Only a live subscription moves them on. A cancelled one is history, and
      // replaying it would park a former customer in Cancelled as though they had just
      // churned — which is worse than leaving them where their project put them.
      const subStatus = String(p.subscription_status ?? '');
      if (subStatus === 'active' || subStatus === 'trialing') {
        await forwardToGhl('subscription_changed', contact, {
          user_id:             String(p.id),
          subscription_status: subStatus,
          subscription_tier:   String(p.subscription_tier ?? ''),
        }, {
          variant: 'active',
          dedupeKey: `backfill_subscription_${p.id}`,
          tier: p.subscription_tier as string | null,
        });
      }

      let mailOk = true;
      const apiKey = process.env.RESEND_API_KEY;
      if (action === 'send' && apiKey) {
        const sent = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Groundwork by Jalla <noreply@mail.tryjalla.com>',
            to: [email], subject, html,
          }),
        });
        mailOk = sent.ok;
        // Stamped only once Resend accepts it, so a failed send is retried rather than
        // recorded as done — the same ordering as the acknowledgement path.
        if (sent.ok) {
          await svc.from('profiles')
            .update({ crm_welcomed_at: new Date().toISOString() }).eq('id', p.id);
        }
      }

      await logEmailToCrm({
        to: email, subject, html, kind: 'other', name: p.full_name as string | null,
      });

      done.push({ who: email, action, ok: mailOk });
    }
  }

  res.status(200).json({
    ok: done.every(d => d.ok),
    kind,
    dryRun: !send,
    note: CHUNK_NOTE,
    ...(send
      ? { processed: done.length, done }
      : {
          wouldSend:     planned.filter(p => p.action === 'send').length,
          wouldBackfill: planned.filter(p => p.action === 'backfill').length,
          planned,
        }),
  });
}
