"""Orientation walkthrough: the two ways a project starts. English and French.

    .venv/bin/python docs/recording/record_two_pathways.py en
    .venv/bin/python docs/recording/record_two_pathways.py fr

── WHAT THIS FILM IS FOR ───────────────────────────────────────────────────────────────
Philip's memo, 9 Nov 2026, priority three: contractors and clients need orienting. The
recorded sessions are more specific — people sign up, land on a dashboard, and do not
know which of the things on it is the thing to do first.

The product forks almost immediately, on one question: does your project have an
architecture plan? Everything after it differs. Somebody arriving with drawings and a
priced bill of quantities uploads them and their budget is READ from their own
documents; somebody without them is taken through nine steps that work the building out.
Neither path is the fallback for the other, and a film that shows only one leaves half
the audience thinking the product is not for them.

So both are filmed, end to end, in one take each, in the viewer's own language.

── WHY IT IS NOT FOUR FILMS ────────────────────────────────────────────────────────────
Contractor and client walk the same wizard. What differs is who they name as the client
and what they do afterwards, and that is a section of this film rather than a film of
its own — see PART 4.

── WHY REAL DOCUMENTS ──────────────────────────────────────────────────────────────────
Pathway A uploads an actual floor plan and an actual bill of quantities, so the figure on
screen is a figure genuinely read off a real document. A film in which the number was
typed in by the operator is an advertisement, not a walkthrough, and anybody who then
uploads their own and sees something different has been misled by us.

Fetched from the `documents` bucket at run time — see `fetch_samples` — rather than
committed, because they are a real client's drawings.

── THE TIPS ────────────────────────────────────────────────────────────────────────────
The in-app tour (`src/components/tour/`) is left ON for the plan question, because that
tip is the film's subject said in the product's own voice, and dismissed everywhere else
so it does not sit over the thing being demonstrated.
"""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import imageio_ffmpeg
from gw import Chrome, Recorder, login

LANG = (sys.argv[1] if len(sys.argv) > 1 else 'en').lower()
if LANG not in ('en', 'fr'):
    sys.exit('usage: record_two_pathways.py [en|fr]')

EMAIL = os.environ.get('GW_FILM_EMAIL', 'favour@tryjalla.com')
PASS  = os.environ.get('GW_FILM_PASSWORD', '1234567890')
OUT   = os.path.abspath(f'docs/Groundwork-Two-Pathways-{LANG.upper()}.mp4')
FPS   = 12
SAMPLES = os.path.abspath('.film-samples')

# The two sample documents, by the id they have in `project_documents`. Both were read
# and confirmed to be what they claim on 9 Nov 2026 — see migration 181.
PLAN_DOC = 'ded29170-9857-404f-9781-60a684ea3ec1'   # Mr.Nas Ground Plan.pdf  (GROUND PLAN)
BQ_DOC   = '478bc96b-6459-4c7f-a688-53e818efdd13'   # Mr.NAS G + 1 Cost Estimate Limbe.pdf

# Every label this script presses, in both languages. Collected here because a missing
# French label is the failure that does not announce itself: the click returns False, the
# script carries on, and the film ends up 40 seconds of a page that never changed.
L = {
    'en': dict(
        country='Cameroon', cont='Continue', yes='Yes, I have one', no='No, not yet',
        back='Back', tip_done='Got it', newproj='New project',
    ),
    'fr': dict(
        country='Cameroun', cont='Continuer', yes="Oui, j'en ai un", no='Non, pas encore',
        back='Retour', tip_done="C'est compris", newproj='Nouveau projet',
    ),
}[LANG]


def fetch_samples():
    """Pull the two real documents out of the bucket into a scratch directory."""
    os.makedirs(SAMPLES, exist_ok=True)
    node = f'''
const {{ createClient }} = await import('{os.path.abspath("node_modules/@supabase/supabase-js/dist/index.mjs")}');
const fs = await import('node:fs');
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\\n')
  .filter(l=>l.includes('=')).map(l=>{{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()]}}));
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {{auth:{{persistSession:false}}}});
const out = {{}};
for (const [key, id] of [['plan','{PLAN_DOC}'],['bq','{BQ_DOC}']]) {{
  const {{ data: d }} = await db.from('project_documents').select('file_path,file_name').eq('id', id).single();
  const {{ data: f }} = await db.storage.from('documents').download(d.file_path);
  const target = '{SAMPLES}/' + d.file_name.replace(/[^\\w.\\-]+/g,'_');
  fs.writeFileSync(target, Buffer.from(await f.arrayBuffer()));
  out[key] = target;
}}
console.log(JSON.stringify(out));
'''
    res = subprocess.run(['node', '--input-type=module', '-e', node],
                         capture_output=True, text=True, check=True)
    out = json.loads(res.stdout.strip().splitlines()[-1])
    print('  samples:', out, flush=True)
    return out


c   = Chrome(cdp=9330 + (1 if LANG == 'fr' else 0), start='/', profile_prefix=f'gw-2p-{LANG}-')
rec = Recorder(c, outdir=f'frames_2p_{LANG}', fps=FPS)

def hold(s): time.sleep(s)
def beat(label): print(f'  [{rec.n:5d}] {label}', flush=True)

def settle(expect=None, timeout=20):
    """Wait until the page has actually painted something, never hold on white.

    A blank frame is the one failure a recording script cannot notice by itself, and
    the first cut of this film had several seconds of them.
    """
    ok = c.wait_for('document.body.innerText.trim().length > 40 ? 1 : 0', timeout)
    if expect and not c.wait_for(
            f'document.body.innerText.includes({json.dumps(expect)}) ? 1 : 0', 6):
        print(f'    .. settled but "{expect}" not on screen', flush=True)
    return bool(ok)

def set_lang():
    """Set the language BEFORE anything renders, so no frame shows the wrong one."""
    c.js(f"try{{localStorage.setItem('lang','{LANG}')}}catch(e){{}}")

def clear_tips():
    """Mark every tip seen, for the sections where one would sit over the subject."""
    c.js("(()=>{const ids=['client-setup','contractor-setup'];"
         "const anchors=['add-client','new-project','plan-question','invite-contractor',"
         "'stage-list','upload-evidence','confirm-payment'];"
         "const uid=(JSON.parse(localStorage.getItem(Object.keys(localStorage)"
         ".find(k=>k.startsWith('sb-')&&k.endsWith('auth-token'))||'null')||'null')||{}).user?.id;"
         "if(!uid) return 'no uid';"
         "for(const id of ids) localStorage.setItem(`gw.tour.${uid}.${id}`, JSON.stringify(anchors));"
         "return 'cleared'})()")

def upload_nth(index, path, expect, tries=3):
    """Put a real file into the nth file input, and CONFIRM the page took it.

    Verification is the point. The first cut of this script set the file and moved on;
    the floor plan landed, the bill of quantities silently did not, and the film reached
    the end with the one shot it exists for — a budget read off a real document — simply
    missing. An exit code of zero said nothing about it.

    Node ids are re-fetched on every attempt: uploading the first file re-renders the
    drop zones, and an id read before that render refers to a node that is gone.
    """
    want = os.path.basename(path)
    for attempt in range(tries):
        doc = c.cmd('DOM.getDocument')['root']['nodeId']
        nodes = c.cmd('DOM.querySelectorAll', nodeId=doc,
                      selector='input[type=file]').get('nodeIds', [])
        if len(nodes) <= index:
            print(f'    !! only {len(nodes)} file inputs, wanted #{index}', flush=True)
            time.sleep(1.5); continue
        c.cmd('DOM.setFileInputFiles', files=[path], nodeId=nodes[index])
        # The file name on screen is the only proof the app accepted it.
        if c.wait_for(f"document.body.innerText.includes({json.dumps(want)}) ? 1 : 0", 12):
            print(f'    uploaded {want} -> input #{index}', flush=True)
            return True
        print(f'    retry {attempt + 1}: {want} did not appear', flush=True)
    print(f'    !! FAILED to upload {want}; expected "{expect}"', flush=True)
    return False


try:
    samples = fetch_samples()
    rec.start()

    # ── PART 1 ── What this is ──────────────────────────────────────────────────────
    set_lang()
    c.goto('/', 3.0); set_lang(); c.goto('/', 3.0)
    beat('landing'); hold(4.0)
    c.scroll(1400, steps=40, pause=0.06); hold(2.0)

    # ── PART 2 ── Signing in ────────────────────────────────────────────────────────
    beat('sign in')
    login(c, EMAIL, PASS); hold(2.5)
    clear_tips()

    # ── PART 3 ── The question everything forks on ──────────────────────────────────
    c.goto('/projects/new', 3.0); settle()
    beat('wizard: country')
    c.click_text(L['country']); hold(1.2)
    c.click_text(L['cont']); hold(4.0)

    # The tour tip for THIS question is left visible: it is the film's subject, said in
    # the product's own words, on the screen the viewer will meet it on.
    c.js("(()=>{for(const k of Object.keys(localStorage)) if(k.startsWith('gw.tour.')) localStorage.removeItem(k); return 1})()")
    c.goto('/projects/new', 4.0)
    c.click_text(L['country']); hold(1.0); c.click_text(L['cont']); hold(4.0)
    beat('THE FORK: does your project have an architecture plan?')
    hold(7.0)                                   # long enough to read the tip

    # ── PART 4 ── Pathway A: they have the drawings ─────────────────────────────────
    beat('pathway A — yes, I have one')
    c.click_text(L['tip_done']); hold(0.8)
    c.click_text(L['yes']); hold(1.5)
    c.click_text(L['cont']); hold(3.5)
    beat('upload the floor plan')
    upload_nth(0, samples['plan'], 'Floor plan'); hold(3.0)
    beat('upload the bill of quantities')
    upload_nth(1, samples['bq'], 'Bill of quantities')
    # Extraction is instant; the vision read is a network call that takes seconds and is
    # the thing worth waiting for on screen. Wait for the figure rather than guessing.
    beat('reading the documents')
    got = c.wait_for("/[0-9][0-9,. ]{5,}/.test(document.body.innerText) "
                     "&& !document.body.innerText.includes('Reading your document') ? 1 : 0", 40)
    print('    figure on screen:', bool(got), flush=True)
    hold(8.0)
    c.scroll(500, steps=20, pause=0.06); hold(6.0)
    beat('what was read off their own documents'); hold(5.0)

    # ── PART 5 ── Pathway B: they do not ────────────────────────────────────────────
    beat('pathway B — no, not yet')
    c.goto('/projects/new', 5.0)
    c.click_text(L['country']); hold(1.0); c.click_text(L['cont']); hold(3.5)
    c.click_text(L['no']); hold(1.5)
    c.click_text(L['cont']); hold(3.5)
    for n in range(6):
        beat(f'guided step {n + 1}')
        hold(3.0)
        if c.click_text(L['cont']) is not True:
            break
        hold(2.5)
    beat('the estimate the wizard worked out'); hold(6.0)
    c.scroll(700, steps=24, pause=0.06); hold(5.0)

    # ── PART 6 ── Where the contractor fits ─────────────────────────────────────────
    # Navigated by CLICKING, not by Page.navigate.
    #
    # Every `goto` is a full page load, so the app unmounts and reboots: roughly a second
    # and a half of pure white, recorded. The first cut had three of them back to back in
    # this section and it reads as the film breaking. Clicking the sidebar is ordinary
    # client-side routing — the chrome never leaves the screen.
    beat('the contractor side')
    c.goto('/work', 2.0)
    settle('Dashboard'); hold(5.0)
    for label in ('Projects', 'Payouts'):
        if c.click_text(label) is True:
            settle(label); hold(4.5)
        else:
            print('    !! no sidebar link:', label, flush=True)

    beat('end'); hold(2.5)
    rec.stop()

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, '-y', '-framerate', str(FPS), '-i', f'frames_2p_{LANG}/f%05d.png',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-vf', 'scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,'
                           'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
                    '-crf', '21', '-preset', 'medium', OUT], check=True, capture_output=True)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes', flush=True)
    print('duration ~', round(rec.n / FPS, 1), 's', flush=True)
finally:
    try: rec.stop()
    except Exception: pass
    c.close()
