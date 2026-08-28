"""Request b87fab1e — "What is Groundwork by Jalla", for contractors, English, website.

Brief goal: understand the value of Groundwork and why to join the on-ground professional
network. Notes ask for the sign-up / create-project / contractor flow, then how to apply.

So it is a VALUE film, not a manual: it opens on what the platform is, shows enough of the
client side for a builder to see where their work comes from and how they get paid, then
lands on the application.

It deliberately does NOT create a project. The recording account is at 2 of 3 on the free
plan, projects can no longer be deleted (053), and burning the last slot to re-shoot a
screen that already exists would end this account's usefulness for filming. It opens the
wizard to show the shape of it and uses the project already there.
"""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import imageio_ffmpeg
from gw import Chrome, Recorder, login

EMAIL, PASS = 'favour@tryjalla.com', '1234567890'
OUT = os.path.abspath('docs/Groundwork-For-Contractors.mp4')
FPS = 12

c   = Chrome(cdp=9321, start='/', profile_prefix='gw-con-')
rec = Recorder(c, outdir='frames_con', fps=FPS)

def hold(s): time.sleep(s)
def beat(l): print(f'  [{rec.n:5d}] {l}', flush=True)
def english(): c.js("try{localStorage.setItem('lang','en')}catch(e){}")

try:
    hold(2.5)
    english(); c.goto('/', 2.5)
    rec.start()

    # 1. What Groundwork is — the landing page makes the argument better than a caption.
    beat('landing — what it is')
    hold(2.4); c.scroll(1100); hold(1.6); c.scroll(1100); hold(1.6); c.scroll(1100); hold(1.6)

    # 2. The contractor pitch page, which is the actual subject of this film.
    beat('contractor landing')
    c.goto('/contractor-apply', 3.0); english(); hold(2.6)
    c.scroll(1000); hold(1.8); c.scroll(1000); hold(1.8); c.scroll(1000); hold(1.6)

    # 3. Where the work comes from: a client signs up and scopes a build.
    beat('client signs in')
    c.goto('/auth/login', 2.6)
    c.wait_for("document.querySelector('#email') ? 1 : 0"); hold(1.2)
    c.type_into('#email', EMAIL);   hold(0.7)
    c.type_into('#password', PASS); hold(0.7)
    c.click_text('log in')
    for _ in range(20):
        hold(1.0)
        if c.path() not in ('/auth/login', None): break
    english(); hold(2.0)

    beat('dashboard')
    c.goto('/dashboard', 3.0); english(); hold(2.4); c.scroll(500); hold(1.4)

    beat('the wizard — how a job gets scoped')
    c.goto('/projects/new', 3.2); english(); hold(2.6)
    for _ in range(3):
        c.click_text('continue'); hold(1.6)

    # 4. An existing project: stages, costing, payments — a builder's side of the deal.
    beat('a live project')
    c.goto('/projects', 3.0); english(); hold(2.0)
    c.js("""(()=>{const a=[...document.querySelectorAll('a')]
        .find(x=>/^\\/projects\\/[0-9a-f-]{8,}/.test(new URL(x.href).pathname));
        if(a){a.click();return 1}return 0})()""")
    hold(3.5); english(); hold(1.5)
    for tab in ('Stages', 'Costing', 'Payments'):
        beat(f'tab {tab}')
        for _ in range(10):
            if c.click_tab(tab) is True: break
            hold(0.5)
        hold(2.6); c.scroll(450); hold(1.4)

    # 5. How to apply — the call to action the brief asks for.
    beat('the application form')
    c.goto('/contractor-apply', 3.0); english(); hold(1.6)
    # NO bare 'Apply' fallback. It matches the nav button "Apply to be a Contractor",
    # which re-navigates to the top of this same page — the first cut ended on the
    # pitch header instead of the form, which is the one thing the brief asked for.
    for lbl in ('Apply to Become a Founding Partner', 'Apply as a Founding Partner'):
        if c.click_text(lbl) is True: break
    # Confirm the form is really open before spending eight seconds filming it.
    if not c.wait_for("document.querySelector('#ca-name') ? 1 : 0", timeout=15):
        print('    !! application form did not open', flush=True)
    # scrollIntoView, not a blind scroll distance. Clicking Apply reveals the form
    # further down a long pitch page, and fixed pixel scrolls landed between sections —
    # the previous cut ended on "First in gets the best position" instead of the form.
    c.js("(()=>{const e=document.querySelector('#ca-name');"
         "if(e){e.scrollIntoView({block:'center'});return 1}return 0})()")
    hold(2.6)
    for _ in range(3):
        c.scroll(420); hold(2.2)

    rec.stop()
    print('frames:', rec.n, flush=True)
    if rec.n < 60:
        print('too few frames — not encoding'); sys.exit(1)

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, '-y', '-framerate', str(FPS), '-i', 'frames_con/f%05d.png',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-vf', 'scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black', '-crf', '21',
                    '-preset', 'medium', OUT], check=True, capture_output=True)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes', flush=True)
    print('duration ~', round(rec.n / FPS, 1), 's', flush=True)
finally:
    try: rec.stop()
    except Exception: pass
    c.close()
