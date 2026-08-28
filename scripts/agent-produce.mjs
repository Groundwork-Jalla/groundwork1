#!/usr/bin/env node
/**
 * Produce every pending video request, unattended.
 *
 *   node scripts/agent-produce.mjs              all pending
 *   node scripts/agent-produce.mjs <request-id> just this one
 *
 * THE SHAPE OF THIS, AND WHY. Claude turns a brief into a SHOT LIST — a JSON object of
 * scenes drawn from a fixed vocabulary. It does not write code, name a selector, or
 * touch the browser. A deterministic Python player (docs/recording/play_plan.py) runs
 * the list. So the worst a bad plan can do is make a dull video; it cannot make an
 * unattended browser do something nobody sanctioned on a production account.
 *
 * NOTHING SHIPS UNCHECKED. docs/recording/qc.py replaces the human who used to look at
 * the frames: blank frames, a stuck driver, a run that is too short. A failing video is
 * still uploaded and the request is marked `declined` with the reason, because whoever
 * asked needs to see what went wrong more than they need a tidy queue.
 *
 * A REQUEST NEVER STICKS. Every path out of here writes a terminal status. An
 * `in_progress` row that nobody is working on is the exact failure this whole feature
 * was built to stop.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

if (typeof globalThis.WebSocket === 'undefined') {           // Node 20; see agent-queue.mjs
  globalThis.WebSocket = (await import('ws')).default;
}

const {
  VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: ANON,
  GW_ADMIN_EMAIL: EMAIL, GW_ADMIN_PASSWORD: PASS,
  GW_REC_EMAIL, GW_REC_PASSWORD,
  // Opus 5 by default. I had picked Sonnet unprompted, which is a cost decision that
  // belongs to whoever pays the bill — and the difference here is about a penny a video,
  // because the planner writes one page of JSON. Override with AGENT_MODEL if you want it.
  ANTHROPIC_API_KEY, AGENT_MODEL = 'claude-opus-5',
  PY = '.venv/bin/python',
} = process.env;

// Missing credentials and "not switched on yet" are different situations and get
// different exits.
for (const [k, v] of Object.entries({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: ANON,
  GW_ADMIN_EMAIL: EMAIL, GW_ADMIN_PASSWORD: PASS })) {
  if (!v) { console.error(`missing ${k}`); process.exit(1); }   // broken config — fail loudly
}

// No planner key means automatic production is not enabled. That is a normal state, not
// a fault: exit 0 so the 15-minute schedule does not paint the Actions tab red while the
// key is still being sorted out. Requests stay `new` and `npm run agent:queue` still
// drains them by hand, which is exactly how they were produced before this existed.
if (!ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY is not set — automatic production is off.');
  console.log('Requests are untouched; drain them with `npm run agent:queue`.');
  process.exit(0);
}
const recEmail = GW_REC_EMAIL || EMAIL;
const recPass  = GW_REC_PASSWORD || PASS;

// ── The vocabulary the planner may use ───────────────────
//
// Deliberately small. Every entry is something play_plan.py already knows how to do
// safely; anything outside it is skipped with a warning rather than improvised.
const SYSTEM = `You plan screen-capture videos of Groundwork by Jalla, a construction
project-management platform for diaspora builders (client wizard, staged payments held
in escrow, a verified contractor network). Cameroon-first, English and French.

You return ONLY a JSON object. No prose, no markdown fence.

{
  "language": "en" | "fr",
  "scenes": [ ... ]
}

Allowed scenes — use nothing else:
  {"beat":"...", "action":"visit", "path":"/", "hold":2.5, "scrolls":[1200,1200]}
  {"beat":"...", "action":"estimator", "values":[90,150,240]}
  {"beat":"...", "action":"login"}
  {"beat":"...", "action":"wizard_preview", "steps":3}
  {"beat":"...", "action":"wizard"}
  {"beat":"...", "action":"open_project"}
  {"beat":"...", "action":"tabs", "tabs":["Stages","Costing","Payments"], "hold":2.6}
  {"beat":"...", "action":"open_application"}

Real paths: / · /tools/budget · /pricing · /contractor-apply · /dashboard · /projects

Rules:
- Build to the GOAL and AUDIENCE, not the title. A brief titled "Investor demo" whose
  audience is beta testers and whose goal is "understand the user flow" is a walkthrough.
- "wizard" CREATES A REAL PROJECT and permanently consumes a plan slot on the recording
  account. Use it only when the brief needs project creation on screen. Otherwise use
  "wizard_preview" then "open_project".
- "login" must come before dashboard, wizard, project or tabs scenes.
- French briefs: tabs are ["Étapes","Coûts","Paiements"]. English: ["Stages","Costing","Payments"].
- 8-12 scenes. Total dwell 60-120s. Hold 2-3s on anything a viewer must read.
- Open with what the audience cares about, close with what you want them to do.`;

const db = createClient(URL_, ANON, { auth: { persistSession: false } });
const { error: authErr } = await db.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (authErr) { console.error('sign-in failed:', authErr.message); process.exit(1); }

const only = process.argv[2];
let q = db.from('agent_requests').select('*')
  .eq('agent', 'video-producer').in('status', ['new', 'in_progress'])
  .order('created_at', { ascending: true });
if (only) q = db.from('agent_requests').select('*').eq('id', only);
const { data: rows, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!rows?.length) { console.log('nothing pending'); process.exit(0); }

mkdirSync('out', { recursive: true });
let failures = 0;

for (const r of rows) {
  console.log(`\n=== ${r.id.slice(0, 8)} — ${r.title}`);
  const slug = (r.title || 'groundwork').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'groundwork';
  const video = `out/${slug}.mp4`;

  try {
    await db.from('agent_requests').update({ status: 'in_progress' }).eq('id', r.id);

    // 1. Plan
    const brief = [
      `Request: ${r.title}`,
      r.audience && `Audience: ${r.audience}`,
      r.goal     && `They should be able to: ${r.goal}`,
      r.channel  && `Shown on: ${r.channel}`,
      `Language: ${r.language}`,
      r.notes    && `Notes: ${r.notes}`,
    ].filter(Boolean).join('\n');

    const plan = await planFor(brief);
    plan.language = r.language === 'fr' ? 'fr' : 'en';   // the brief decides, not the model
    writeFileSync('out/plan.json', JSON.stringify(plan, null, 2));
    console.log(`  planned ${plan.scenes.length} scenes:`,
                plan.scenes.map(s => s.action).join(' → '));

    // 2. Record
    execFileSync(PY, ['docs/recording/play_plan.py', 'out/plan.json', video], {
      stdio: 'inherit',
      env: { ...process.env, GW_REC_EMAIL: recEmail, GW_REC_PASSWORD: recPass },
      timeout: 20 * 60_000,
    });

    // 3. Check — this is what replaces a person looking at the frames
    const qc = JSON.parse(execFileSync(PY,
      ['docs/recording/qc.py', video, plan.language], { encoding: 'utf8' }).trim());
    console.log('  qc:', qc.ok ? 'pass' : `FAIL — ${qc.problems.join('; ')}`);

    // 4. Deliver either way. A failed video that nobody can see teaches nobody anything.
    const url = await upload(r.id, video);
    await db.from('agent_requests').update({
      status: qc.ok ? 'delivered' : 'declined',
      output_url: url,
      output_note: qc.ok
        ? `Produced automatically. ${qc.stats.samples * 2}s. Checked for blank frames, a stalled driver and length — all clear.`
        : `Produced automatically but it did NOT pass checks: ${qc.problems.join('; ')}. The file is attached so you can see what went wrong; ask again once it is fixed.`,
    }).eq('id', r.id);
    if (!qc.ok) failures++;
    console.log('  ->', url);

  } catch (e) {
    failures++;
    const why = String(e?.stderr || e?.message || e).slice(-600);
    console.error('  failed:', why);
    // Terminal status, always. Never leave a row in_progress with nobody on it.
    await db.from('agent_requests').update({
      status: 'declined',
      output_note: `Automatic production failed. ${why}`,
    }).eq('id', r.id);
  }
}

await db.auth.signOut();
process.exit(failures ? 1 : 0);

// ── helpers ──────────────────────────────────────────────

async function planFor(brief) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: AGENT_MODEL, max_tokens: 2000, system: SYSTEM,
      messages: [{ role: 'user', content: brief }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text = (json.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('');
  // Tolerate a fence even though the prompt forbids one — cheaper than a retry.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`planner returned no JSON: ${text.slice(0, 200)}`);
  const plan = JSON.parse(m[0]);
  if (!Array.isArray(plan.scenes) || !plan.scenes.length) throw new Error('plan has no scenes');
  return plan;
}

async function upload(requestId, file) {
  const bytes = readFileSync(file);
  const path = `${requestId}/${Date.now()}-${file.split('/').pop()}`;
  const { error: e } = await db.storage.from('agent-outputs')
    .upload(path, bytes, { contentType: 'video/mp4', upsert: false });
  if (e) throw new Error(`upload failed: ${e.message}`);
  return db.storage.from('agent-outputs').getPublicUrl(path).data.publicUrl;
}
