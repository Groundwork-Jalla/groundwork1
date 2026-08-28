"""Execute a shot list. Deterministic — the model plans, this runs.

A plan is JSON with a fixed vocabulary of scenes. Claude chooses WHICH scenes, in what
order, and how long to dwell; it never emits code and never names a selector. That
boundary is the whole safety model: a bad plan produces a boring video, not an
unattended browser doing something nobody sanctioned on a production account.

Unknown actions are skipped with a warning rather than raising, so one bad scene costs
one segment instead of the whole run.
"""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import imageio_ffmpeg
from gw import Chrome, Recorder, login
from wizard import run_wizard

FPS = 12


def _ts(frame, fps=FPS):
    """Frame index -> SRT timestamp."""
    total_ms = int(frame * 1000 / fps)
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    sec, ms = divmod(rem, 1000)
    return f'{h:02d}:{m:02d}:{sec:02d},{ms:03d}'


def write_srt(marks, total_frames, path):
    """Write captions, each running until the next one starts.

    Returns the path, or None when there is nothing to write — a plan with no captions
    should encode without a subtitles filter rather than with an empty one, which libass
    treats as an error.
    """
    if not marks:
        return None
    lines = []
    for i, (start, text) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else total_frames
        # A caption that flashes for under a second is unreadable; borrow from the gap
        # rather than showing it at all.
        if end - start < FPS:
            continue
        lines.append(f'{len(lines) + 1}\n{_ts(start)} --> {_ts(end)}\n{text}\n')
    if not lines:
        return None
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines))
    return os.path.abspath(path)


def play(plan, email, password, out_path, frames_dir='frames_auto', cdp=9330,
         stills_dir=None):
    lang = plan.get('language', 'en')
    c    = Chrome(cdp=cdp, start='/', profile_prefix='gw-auto-')
    rec  = Recorder(c, outdir=frames_dir, fps=FPS)
    log  = lambda m: print(f'    {m}', flush=True)

    def hold(s): time.sleep(min(float(s), 12.0))      # cap a runaway dwell
    def pin():   c.js(f"try{{localStorage.setItem('lang','{lang}')}}catch(e){{}}")

    signed_in = False
    project_path = None
    marks = []          # (start_frame, caption) per scene that has one
    stills = []         # (path, caption) — one clean frame per scene, for the deck

    if stills_dir:
        os.makedirs(stills_dir, exist_ok=True)

    try:
        time.sleep(2.5)
        pin(); c.goto('/', 2.5)
        rec.start()

        for i, scene in enumerate(plan.get('scenes', [])):
            action = scene.get('action', 'visit')
            beat   = scene.get('beat', action)
            print(f'  [{rec.n:5d}] {i+1}. {beat}', flush=True)

            # `caption` is viewer-facing and written in the brief's language; `beat` is
            # internal shorthand ("tabs", "open_project") and must never be shown. A
            # scene without a caption simply has no subtitle over it.
            if scene.get('caption'):
                marks.append((rec.n, str(scene['caption'])))

            try:
                if action == 'visit':
                    path = scene.get('path', '/')
                    if not path.startswith('/'):        # never leave the app
                        log(f'refusing off-site path {path!r}'); continue
                    c.goto(path, 3.0); pin(); hold(scene.get('hold', 2.4))
                    for px in scene.get('scrolls', []):
                        c.scroll(int(px)); hold(1.5)

                elif action == 'login':
                    if signed_in: continue
                    c.goto('/auth/login', 2.6)
                    c.wait_for("document.querySelector('#email') ? 1 : 0")
                    hold(1.2)
                    c.type_into('#email', email);    hold(0.7)
                    c.type_into('#password', password); hold(0.7)
                    for lbl in ('log in', 'Se connecter'):
                        if c.click_text(lbl) is True: break
                    for _ in range(20):
                        hold(1.0)
                        if c.path() not in ('/auth/login', None): break
                    pin(); hold(2.0); signed_in = True

                elif action == 'wizard':
                    # Creates a real project and permanently consumes a plan slot on a
                    # free-tier account (053). The planner is told not to ask for this
                    # unless the brief needs project creation on screen.
                    c.goto('/projects/new', 3.5); pin(); hold(1.2)
                    project_path = run_wizard(c, hold, log=log)
                    log(f'-> {project_path}')
                    hold(2.5)

                elif action == 'wizard_preview':
                    # The shape of the wizard without completing it. No slot consumed.
                    c.goto('/projects/new', 3.2); pin(); hold(2.4)
                    for _ in range(int(scene.get('steps', 3))):
                        for w in ('continue', 'continuer'):
                            if c.click_text(w) is True: break
                        hold(1.6)

                elif action == 'open_project':
                    c.goto('/projects', 3.0); pin(); hold(1.8)
                    ok = c.js("""(()=>{const a=[...document.querySelectorAll('a')]
                        .find(x=>/^\\/projects\\/[0-9a-f-]{8,}/.test(new URL(x.href).pathname));
                        if(a){a.click();return 1}return 0})()""")
                    if not ok: log('no project to open'); continue
                    hold(3.5); pin(); hold(1.2)

                elif action == 'tabs':
                    for tab in scene.get('tabs', []):
                        print(f'  [{rec.n:5d}]    tab {tab}', flush=True)
                        for _ in range(10):
                            if c.click_tab(tab) is True: break
                            hold(0.5)
                        hold(scene.get('hold', 2.6)); c.scroll(450); hold(1.4)

                elif action == 'open_application':
                    c.goto('/contractor-apply', 3.0); pin(); hold(1.6)
                    for lbl in ('Apply to Become a Founding Partner',
                                'Apply as a Founding Partner'):
                        if c.click_text(lbl) is True: break
                    c.wait_for("document.querySelector('#ca-name') ? 1 : 0", timeout=15)
                    c.js("(()=>{const e=document.querySelector('#ca-name');"
                         "if(e){e.scrollIntoView({block:'center'});return 1}return 0})()")
                    hold(2.6)
                    for _ in range(3):
                        c.scroll(420); hold(2.0)

                elif action == 'estimator':
                    c.goto('/tools/budget', 2.6); pin(); hold(1.6)
                    for v in scene.get('values', [90, 150, 240]):
                        c.js(f"""(()=>{{const el=document.querySelector('input[type=range]');
                           if(!el)return;
                           Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')
                             .set.call(el,'{int(v)}');
                           el.dispatchEvent(new Event('input',{{bubbles:true}}));}})()""")
                        hold(1.1)
                    hold(1.2)

                else:
                    log(f'unknown action {action!r} — skipped')

                # A still taken at the END of the scene, once the page has settled —
                # the same picture a deck wants. Free: the browser is already there.
                if stills_dir:
                    try:
                        p = os.path.join(stills_dir, f'{len(stills):02d}.png')
                        with open(p, 'wb') as fh:
                            fh.write(c.shot())
                        stills.append((p, scene.get('caption') or beat))
                    except Exception as e:
                        log(f'still failed: {e}')

            except Exception as e:                       # one bad scene, not one bad run
                log(f'scene failed: {e}')

        rec.stop()
        print('frames:', rec.n, flush=True)
        if rec.n < 60:
            raise RuntimeError(f'only {rec.n} frames — the drive failed')

        ff = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [ff, '-y', '-framerate', str(FPS), '-i', f'{frames_dir}/f%05d.png']
        audio = plan.get('audio')
        if audio and os.path.exists(audio):
            cmd += ['-i', audio, '-c:a', 'aac', '-shortest']

        # Captions are burnt in, not attached as a track.
        #
        # These videos are watched on WhatsApp and LinkedIn, muted, often in a feed that
        # strips subtitle tracks entirely. A soft track would be silently dropped exactly
        # where it is needed most. Burnt-in text also survives being re-encoded by
        # whatever the recipient forwards it through.
        # force_original_aspect_ratio + pad, never a bare scale.
        #
        # A bare `scale=1920:1080` DISTORTS whenever the source is not exactly 16:9, and
        # it does so silently. That is what happened: the driver captured 1440x667 while
        # declaring 1440x810, and every video went out horizontally stretched. The
        # viewport is pinned now (gw.py), but this makes the encoder safe regardless —
        # a wrong capture size becomes black bars, which is obvious, instead of stretched
        # text, which reads as a font problem.
        vf = ('scale=1920:1080:flags=lanczos:force_original_aspect_ratio=decrease,'
              'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black')
        srt = write_srt(marks, rec.n, os.path.join(frames_dir, 'captions.srt'))
        if srt:
            # BorderStyle=3 draws an opaque box, and libass sizes that box from
            # `Outline` — so Outline=0 means no box at all. White text then vanishes
            # completely over the white landing page while looking fine over the dark
            # project screens, which is the worst kind of bug: invisible in review,
            # obvious to the one person you sent it to.
            #
            # BOTH axes pinned. PlayResY alone leaves libass to assume a PlayResX that
            # is not 16:9, which widens the glyphs slightly — a small effect that was
            # masked by the much larger capture-aspect bug above.
            style = ('FontName=DejaVu Sans,FontSize=42,PrimaryColour=&H00FFFFFF,'
                     'BorderStyle=3,Outline=8,Shadow=0,BackColour=&HD0000000,'
                     'Alignment=2,MarginV=60,PlayResX=1920,PlayResY=1080')
            vf += f",subtitles='{srt}':force_style='{style}'"
        cmd += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-vf', vf, '-crf', '21', '-preset', 'medium', out_path]
        subprocess.run(cmd, check=True, capture_output=True)
        return {'frames': rec.n, 'seconds': round(rec.n / FPS, 1),
                'project_path': project_path,
                'stills': len(stills),
                'bytes': os.path.getsize(out_path)}
    finally:
        try: rec.stop()
        except Exception: pass
        c.close()


if __name__ == '__main__':
    plan = json.load(open(sys.argv[1]))
    stills = sys.argv[sys.argv.index('--stills') + 1] if '--stills' in sys.argv else None
    res = play(plan, os.environ['GW_REC_EMAIL'], os.environ['GW_REC_PASSWORD'], sys.argv[2],
               stills_dir=stills)
    print(json.dumps(res))
