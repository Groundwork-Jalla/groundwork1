"""Request 7a7b5b35 — the user flow, in French, for beta testers.

Brief: audience "beta testers", goal "understand the user flow", shown on a call, fr.
Titled "Investor demo" but built to the GOAL, which is a walkthrough: the point is that
a tester can follow what to do, not that an investor is impressed.

So it is paced slower than a pitch and it dwells on the things a tester has to act on —
the wizard steps, the derived footprint, the stage list — rather than sweeping past them.
"""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import imageio_ffmpeg
from gw import Chrome, Recorder, login
from wizard import run_wizard

EMAIL, PASS = 'favour@tryjalla.com', '1234567890'
OUT = os.path.abspath('docs/Groundwork-Parcours-FR.mp4')
FPS = 12

c   = Chrome(cdp=9320, start='/', profile_prefix='gw-fr-')
rec = Recorder(c, outdir='frames_fr', fps=FPS)

def hold(s): time.sleep(s)
def beat(l): print(f'  [{rec.n:5d}] {l}', flush=True)

def french():
    """Pin to French BEFORE anything renders. The toggle shows the CURRENT language, so
    once the app is in French there is no 'FR' button left to click — writing the stored
    preference is the only thing that holds across navigation."""
    c.js("try{localStorage.setItem('lang','fr')}catch(e){}")

try:
    hold(2.5)
    french(); c.goto('/', 2.5)
    rec.start()

    beat('accueil')
    hold(2.2); c.scroll(1400); hold(1.0); c.scroll(1400); hold(1.4)

    beat('estimateur public')
    c.goto('/tools/budget', 2.6); french(); hold(1.6)
    for v in (90, 150, 240):
        c.js(f"""(()=>{{const el=document.querySelector('input[type=range]'); if(!el)return;
           Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'{v}');
           el.dispatchEvent(new Event('input',{{bubbles:true}}));}})()""")
        hold(1.1)
    hold(1.2)

    beat('connexion')
    c.goto('/auth/login', 2.6)
    c.wait_for("document.querySelector('#email') ? 1 : 0")
    hold(1.2)
    c.type_into('#email', EMAIL);   hold(0.8)
    c.type_into('#password', PASS); hold(0.8)
    for lbl in ('Se connecter', 'log in'):
        if c.click_text(lbl) is True: break
    for _ in range(20):
        hold(1.0)
        if c.path() not in ('/auth/login', None): break
    french(); hold(2.2)

    beat('tableau de bord')
    c.goto('/dashboard', 3.0); french(); hold(2.6); c.scroll(600); hold(1.6)

    beat('assistant de projet')
    c.goto('/projects/new', 3.5); french(); hold(1.2)
    path = run_wizard(c, hold, log=lambda m: print('   ', m, flush=True))
    print('    -> ', path, flush=True)
    hold(2.5)

    if path and path.startswith('/projects/'):
        c.wait_for("document.querySelectorAll('button').length > 6 ? 1 : 0", timeout=20)
        beat('projet — vue d ensemble'); french(); hold(3.0); c.scroll(700); hold(1.8)
        for tab in ('Étapes', 'Coûts', 'Paiements'):
            beat(f'onglet {tab}')
            for _ in range(10):
                if c.click_tab(tab) is True: break
                hold(0.5)
            hold(2.8); c.scroll(500); hold(1.6)
    else:
        beat('projet non créé — on montre la liste')
        c.goto('/projects', 3.0); french(); hold(2.5)

    rec.stop()
    print('frames:', rec.n, flush=True)
    if rec.n < 60:
        print('too few frames — not encoding'); sys.exit(1)

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, '-y', '-framerate', str(FPS), '-i', 'frames_fr/f%05d.png',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-vf', 'scale=1920:1080:flags=lanczos', '-crf', '21',
                    '-preset', 'medium', OUT], check=True, capture_output=True)
    print('wrote', OUT, os.path.getsize(OUT), 'bytes', flush=True)
    print('duration ~', round(rec.n / FPS, 1), 's', flush=True)
finally:
    try: rec.stop()
    except Exception: pass
    c.close()
