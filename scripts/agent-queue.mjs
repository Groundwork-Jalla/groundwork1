#!/usr/bin/env node
/**
 * The queue runner — drain /admin/requests from the terminal.
 *
 *   npm run agent:queue                    list what is waiting
 *   npm run agent:queue -- brief <id>      print the paste-ready brief
 *   npm run agent:queue -- start <id>      mark in progress
 *   npm run agent:queue -- deliver <id> --file docs/X.mp4 [--note "..."]
 *   npm run agent:queue -- decline <id> --note "why"
 *
 * WHY THIS EXISTS. Groundwork's agents run against the repository, so only a developer
 * can invoke them — but the people who need the work are not developers. /admin/requests
 * is where they ask; this is where the asking gets picked up. Without it the loop is:
 * open the admin panel, read a brief, retype it into an agent, record, find somewhere to
 * put the file, paste a URL back into a form. That is enough friction that the queue
 * stops being drained, and a request desk nobody drains is worse than no desk.
 *
 * NOT FULLY AUTOMATIC, on purpose. `deliver` is a separate command from `start` because
 * a person should look at the frames before a video reaches an investor — a blank frame,
 * a stuck wizard step or an unexpectedly French UI do not show up in an exit code. The
 * video-producer agent's own instructions say the same thing.
 *
 * AUTH: signs in as an admin with the SAME anon key the browser uses, so RLS applies and
 * there is no service-role key to keep anywhere. Credentials come from the environment,
 * never from a file in the repo.
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// supabase-js constructs a realtime client eagerly, and realtime-js throws on Node 20 —
// "Node.js 20 detected without native WebSocket support" — before any query runs. This
// CLI never subscribes to anything, but the check happens at construction, so the
// cheapest fix is to satisfy it. `ws` is already in the tree as a transitive dependency.
// Delete this once the project is on Node 22, where WebSocket is global.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = (await import('ws')).default;
}

// ── Config ───────────────────────────────────────────────

const url  = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.GW_ADMIN_EMAIL;
const pass  = process.env.GW_ADMIN_PASSWORD;

if (!url || !anon) die('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (they are in .env).');
if (!email || !pass) die(
  'GW_ADMIN_EMAIL and GW_ADMIN_PASSWORD must be set.\n' +
  '  These are deliberately NOT read from .env — an admin password does not belong in a\n' +
  '  file that gets copied around. Pass them for the command:\n\n' +
  '    GW_ADMIN_EMAIL=you@example.com GW_ADMIN_PASSWORD=… npm run agent:queue',
);

const MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// ── Helpers ──────────────────────────────────────────────

function die(msg) { console.error(`\n${msg}\n`); process.exit(1); }

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Accept a short id prefix, the way git accepts a short SHA. */
async function findRequest(db, idish) {
  if (!idish) die('Give a request id (the first few characters are enough).');
  const { data, error } = await db.from('agent_requests').select('*');
  if (error) throw error;
  const hits = data.filter(r => r.id.startsWith(idish));
  if (hits.length === 0) die(`No request starting with "${idish}".`);
  if (hits.length > 1) die(`"${idish}" matches ${hits.length} requests — use more characters.`);
  return hits[0];
}

/** The block to paste into an agent. Mirrors briefFor() in lib/supabase/agent-requests.ts. */
function brief(r) {
  const line = (label, v) => (v ? `${label}: ${v}\n` : '');
  return (
    `Agent: ${r.agent}\n` +
    `Request: ${r.title}\n` +
    line('Audience', r.audience) +
    line('They should be able to', r.goal) +
    line('Shown on', r.channel) +
    `Language: ${r.language}\n` +
    line('Needed by', r.needed_by) +
    line('Notes', r.notes)
  );
}

const STATUS_MARK = {
  new: '●', in_progress: '◐', delivered: '✓', declined: '✕',
};

// ── Commands ─────────────────────────────────────────────

async function list(db) {
  const { data, error } = await db
    .from('agent_requests').select('*').order('created_at', { ascending: true });
  if (error) throw error;

  const openRows = data.filter(r => r.status === 'new' || r.status === 'in_progress');
  if (openRows.length === 0) {
    console.log(`\nNothing waiting. ${data.length} request(s) in total.\n`);
    return;
  }

  console.log(`\n${openRows.length} waiting:\n`);
  for (const r of openRows) {
    const age = Math.round((Date.now() - new Date(r.created_at)) / 86_400_000);
    const due = r.needed_by ? `  needed by ${r.needed_by}` : '';
    console.log(`  ${STATUS_MARK[r.status]} ${r.id.slice(0, 8)}  ${r.title}`);
    console.log(`      ${r.agent} · ${r.language} · ${age}d old${due}`);
    if (r.audience) console.log(`      for: ${r.audience}`);
    if (r.goal)     console.log(`      so they can: ${r.goal}`);
    console.log();
  }
  console.log(`  npm run agent:queue -- brief ${openRows[0].id.slice(0, 8)}\n`);
}

async function showBrief(db, idish) {
  const r = await findRequest(db, idish);
  // Bare, so it can be piped or copied whole without trimming decoration off it.
  process.stdout.write(brief(r));
}

async function setStatus(db, idish, status, extra = {}) {
  const r = await findRequest(db, idish);
  const { error } = await db.from('agent_requests')
    .update({ status, ...extra }).eq('id', r.id);
  if (error) throw error;
  console.log(`\n${STATUS_MARK[status]} ${r.title} → ${status}\n`);
  return r;
}

async function deliver(db, idish) {
  const file = flag('file');
  if (!file) die('deliver needs --file <path to the finished output>');

  const r = await findRequest(db, idish);
  const bytes = await readFile(file).catch(() => die(`Cannot read ${file}`));
  const ext = extname(file).toLowerCase();
  const type = MIME[ext];
  if (!type) die(`${ext} is not an allowed type. Allowed: ${Object.keys(MIME).join(' ')}`);

  // Keyed on the request id: not enumerable, and it ties the file to the brief that
  // asked for it without leaking the title into a URL that gets forwarded.
  const path = `${r.id}/${Date.now()}-${basename(file)}`;

  console.log(`\nUploading ${(bytes.length / 1e6).toFixed(1)} MB…`);
  const { error: upErr } = await db.storage
    .from('agent-outputs').upload(path, bytes, { contentType: type, upsert: false });
  if (upErr) die(`Upload failed: ${upErr.message}`);

  const { data: pub } = db.storage.from('agent-outputs').getPublicUrl(path);

  const { error } = await db.from('agent_requests').update({
    status: 'delivered',
    output_url: pub.publicUrl,
    output_note: flag('note') ?? null,
  }).eq('id', r.id);
  if (error) throw error;

  console.log(`✓ delivered — ${r.title}`);
  console.log(`  ${pub.publicUrl}\n`);
}

// ── Main ─────────────────────────────────────────────────

const db = createClient(url, anon, { auth: { persistSession: false } });

const { error: authErr } = await db.auth.signInWithPassword({ email, password: pass });
if (authErr) die(`Could not sign in as ${email}: ${authErr.message}`);

const { data: isAdmin } = await db.rpc('is_admin');
if (isAdmin !== true) die(
  `${email} is not an admin, so RLS will hide every request.\n` +
  `  Grant it: INSERT INTO public.user_roles (user_id, role) VALUES ('<uid>', 'admin');`,
);

const [cmd, idish] = process.argv.slice(2);

try {
  switch (cmd) {
    case undefined:
    case 'list':    await list(db); break;
    case 'brief':   await showBrief(db, idish); break;
    case 'start':   await setStatus(db, idish, 'in_progress'); break;
    case 'deliver': await deliver(db, idish); break;
    case 'decline': await setStatus(db, idish, 'declined', { output_note: flag('note') ?? null }); break;
    default: die(`Unknown command "${cmd}". Try: list · brief · start · deliver · decline`);
  }
} catch (e) {
  // PostgREST rejects with a plain object, not an Error — reading .message off it
  // directly is what keeps the real cause instead of "[object Object]".
  die(e?.message ?? String(e));
}

await db.auth.signOut();
