"""Record the complete Groundwork journey to MP4.

Public pages → sign in → dashboard → the 11-step wizard → project created →
overview → how the budget is calculated → stages → payments.

Frames are captured on a background thread at a steady cadence while the script drives
the app, so the result is real motion rather than a slideshow.
"""
import os, subprocess, sys, time
import imageio_ffmpeg
from gw import Chrome, Recorder, login
from wizard import run_wizard

EMAIL, PASS = 'favour@tryjalla.com', '1234567890'
OUT = '/home/favour-nwachukwu/Desktop/Jalla/groundwork1/docs/Groundwork-Walkthrough.mp4'
FPS = 12

c = Chrome(cdp=9260, start='/', profile_prefix='gw-rec-')
rec = Recorder(c, outdir='frames_full', fps=FPS)

def hold(s): time.sleep(s)

def english():
    """Pin the UI to English.

    A Cameroonian project makes the app offer French, and this account had already been
    switched during testing — so the wizard came up as 'Ou allez-vous construire ?' and
    every heading-based handler missed. Writing the stored preference is what actually
    holds; clicking the EN toggle alone did not survive navigation.
    """
    c.js("try{localStorage.setItem('lang','en')}catch(e){}")
    # The toggle renders the CURRENT language, so once the app flipped to French there
    # was no button reading 'EN' to click and half the first cut came out in French.
    c.js("""(()=>{
      const french = /Tableau de bord|Mes projets|Se d\u00e9connecter|Param\u00e8tres/
                      .test(document.body.innerText || '');
      if (!french) return 'already en';
      const b = [...document.querySelectorAll('button')]
        .find(e => ['EN','FR'].includes((e.innerText||'').trim()));
      if (!b) return 'no toggle'; b.click(); return 'switched';
    })()""")

def beat(label):
    print(f'  [{rec.n:5d}] {label}', flush=True)

try:
    hold(3.0)
    english(); c.goto('/', 2.0)      # set the preference before anything renders
    rec.start()

    # ── 1. Landing ───────────────────────────────────────
    beat('landing')
    hold(1.8); c.scroll(1500); hold(0.8); c.scroll(1500); hold(1.2)

    # ── 2. The free estimator, driven live ───────────────
    beat('tools/budget')
    c.goto('/tools/budget', 2.4)
    for v in (90, 150, 220, 300):
        c.js(f"""(()=>{{const el=document.querySelector('input[type=range]'); if(!el)return;
           Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'{v}');
           el.dispatchEvent(new Event('input',{{bubbles:true}}));}})()""")
        hold(0.8)
    c.click_text('Premium'); hold(1.5)
    c.click_text('Luxury');  hold(1.5)
    c.click_text('Standard'); hold(1.3)

    # ── 3. Sign in ───────────────────────────────────────
    beat('sign in')
    c.goto('/auth/login', 2.6)
    c.wait_for("document.querySelector('#email') ? 1 : 0")
    hold(1.0)
    c.type_into('#email', EMAIL);   hold(0.7)
    c.type_into('#password', PASS); hold(0.7)
    c.click_text('log in')
    for _ in range(20):
        hold(1.0)
        if c.path() not in ('/auth/login', None): break
    english(); hold(2.0)

    # ── 4. Dashboard ─────────────────────────────────────
    beat('dashboard')
    c.goto('/dashboard', 3.0); english(); hold(2.2); c.scroll(600); hold(1.4)

    # ── 5. The wizard ────────────────────────────────────
    beat('wizard')
    c.goto('/projects/new', 3.5)
    project_path = run_wizard(c, hold, log=lambda m: print('   ', m, flush=True))
    print('    -> created:', project_path, flush=True)
    hold(2.5); english(); hold(1.5)

    def tab(name, settle=2.4):
        """Open a project tab and dwell on it.

        Previously the dwell was inside `if click_text(...)`, so when the tab had not
        rendered yet the click returned false and the whole segment was skipped — the
        first cut spent one frame each on Costing, Stages and Payments.
        """
        for _ in range(12):
            if c.click_tab(name) is True: break
            hold(0.5)
        hold(settle)

    if project_path and project_path.startswith('/projects/'):
        # Wait for the project page to actually paint before touching anything.
        c.wait_for("document.querySelectorAll('button').length > 6 ? 1 : 0", timeout=20)
        # ── 6. Project overview ──────────────────────────
        beat('project overview')
        english(); hold(2.5); c.scroll(700); hold(1.6)

        # ── 7. How the budget is calculated ──────────────
        beat('budget explainer')
        if c.click_text('How is this calculated'):
            hold(2.6); c.scroll(900); hold(1.6); c.scroll(900); hold(1.6)
            c.js("""(()=>{const b=[...document.querySelectorAll('button')]
               .find(e=>e.querySelector('svg') && e.closest('[role],div'));
               // close on Escape instead — more reliable than guessing the X
               }) ()""")
            c.cmd('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape',
                  windowsVirtualKeyCode=27, nativeVirtualKeyCode=27)
            c.cmd('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape',
                  windowsVirtualKeyCode=27, nativeVirtualKeyCode=27)
            hold(1.2)

        # ── 8. Costing ───────────────────────────────────
        beat('costing tab')
        tab('Costing'); c.scroll(800); hold(2.0); c.scroll(700); hold(1.8)

        # ── 9. Stages ────────────────────────────────────
        beat('stages tab')
        tab('Stages')
        # Expand the active stage — scoped to the main column, since click_nth over the
        # whole document counted sidebar buttons first.
        c.js("""(()=>{const main=document.querySelector('main')||document.body;
          const b=[...main.querySelectorAll('button')].filter(e=>e.offsetParent);
          const s=b.find(e=>/land secured|stage 1/i.test(e.innerText||''));
          (s||b[6])&&(s||b[6]).click();})()"""); hold(2.2)
        c.scroll(700); hold(2.0)

        # ── 10. Payments ─────────────────────────────────
        beat('payments tab')
        tab('Payments'); c.scroll(700); hold(2.4)

        # ── 11. Back to the project list ─────────────────
        beat('projects list')
        c.goto('/projects', 3.0); english(); hold(2.4)

    rec.stop()
    print('frames:', rec.n, flush=True)

    if rec.n < 60:
        print('too few frames — not encoding'); sys.exit(1)

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, '-y', '-framerate', str(FPS), '-i', 'frames_full/f%05d.png',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-vf', 'scale=1920:1080:flags=lanczos', '-crf', '21',
                    '-preset', 'medium', OUT], check=True, capture_output=True)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes', flush=True)
    print('duration ~', round(rec.n / FPS, 1), 'seconds', flush=True)

finally:
    try: rec.stop()
    except Exception: pass
    c.close()
