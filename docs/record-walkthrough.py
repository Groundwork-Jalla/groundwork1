"""Drive Groundwork in headless Chrome and record it to MP4.

Single-threaded by design. An earlier version captured frames on a background thread so
capture and actions overlapped; sharing one CDP websocket across threads corrupted the
stream and Chrome dropped the connection, and a lock did not save it. Here every frame is
grabbed on the main thread between steps — slower to record, but it cannot race.

Chrome runs with its OWN --user-data-dir. Without that, `google-chrome` hands off to an
already-running browser and our flags are silently ignored — we would be driving the
user's real session, extensions and all.

PUBLIC PAGES ONLY. Nothing signs in; nothing is written to the database.
"""
import base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
import websocket
import imageio_ffmpeg

PORT, CDP = 5199, 9231
BASE = f'http://localhost:{PORT}'
OUT  = 'frames'
FPS  = 10
W, H = 1440, 810

PROFILE = tempfile.mkdtemp(prefix='gw-rec-')

class Chrome:
    def __init__(self):
        self.proc = subprocess.Popen([
            'google-chrome', '--headless=new', '--disable-gpu', '--no-sandbox',
            '--hide-scrollbars', '--force-device-scale-factor=1',
            f'--user-data-dir={PROFILE}', '--no-first-run', '--disable-extensions',
            '--disable-background-networking', '--disable-sync',
            f'--remote-debugging-port={CDP}', '--remote-allow-origins=*',
            f'--window-size={W},{H}', BASE + '/',
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(80):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://localhost:{CDP}/json/list'))
                pages = [t for t in tabs if t.get('type') == 'page'
                         and t.get('url', '').startswith(BASE)]
                if pages:
                    self.ws = websocket.create_connection(
                        pages[0]['webSocketDebuggerUrl'], timeout=30)
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            raise RuntimeError('chrome/page never appeared')
        self.id = 0

    def cmd(self, method, **params):
        self.id += 1
        self.ws.send(json.dumps({'id': self.id, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == self.id:
                if 'error' in msg: raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result', {})

    def js(self, expr):
        try:
            r = self.cmd('Runtime.evaluate', expression=expr, returnByValue=True)
            return r.get('result', {}).get('value')
        except Exception:
            return None

    def close(self):
        try: self.ws.close()
        except Exception: pass
        self.proc.terminate()
        shutil.rmtree(PROFILE, ignore_errors=True)

def main():
    shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
    c = Chrome()
    c.cmd('Page.enable'); c.cmd('Runtime.enable')
    c.cmd('Emulation.setDeviceMetricsOverride', width=W, height=H,
          deviceScaleFactor=1, mobile=False)
    n = [0]

    def frame():
        data = c.cmd('Page.captureScreenshot', format='png')['data']
        with open(f'{OUT}/f{n[0]:05d}.png', 'wb') as fh:
            fh.write(base64.b64decode(data))
        n[0] += 1

    def hold(sec):
        """Sit still, but keep shooting, so a pause reads as a pause and not a jump cut."""
        for _ in range(max(1, int(sec * FPS))): frame()

    def goto(path, settle=2.2):
        c.cmd('Page.navigate', url=BASE + path)
        time.sleep(settle)
        hold(0.3)

    def scroll(px, steps=20):
        for _ in range(steps):
            c.js(f'window.scrollBy(0,{px/steps})'); frame()

    def click_text(text, tag='button, a'):
        return c.js(f"""(()=>{{
          const t = {json.dumps(text)}.toLowerCase();
          const el = [...document.querySelectorAll({json.dumps(tag)})]
            .find(e => (e.innerText||'').trim().toLowerCase().includes(t));
          if (!el) return false; el.click(); return true;
        }})()""")

    REACT_SET = """(function(sel,val){
      const el=document.querySelector(sel); if(!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')
        .set.call(el,String(val));
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true})); return true;})(%s,%s)"""

    # ── 1. Landing ──
    hold(1.6); scroll(1500); hold(0.6); scroll(1500); hold(0.8)

    # ── 2. Pricing ──
    goto('/pricing'); hold(1.6); scroll(1000); hold(1.4)

    # ── 3. The estimator, driven live ──
    goto('/tools/budget'); hold(1.4)
    for v in (90, 140, 200, 260, 330, 400):
        c.js(REACT_SET % (json.dumps('input[type=range]'), json.dumps(v)))
        hold(0.5)
    hold(0.8)
    click_text('Premium'); hold(1.2)
    click_text('Luxury');  hold(1.2)
    click_text('Standard'); hold(1.0)

    # ── 4. The other free tools ──
    goto('/tools/stages');     hold(1.2); scroll(1100); hold(0.9)
    goto('/tools/milestones'); hold(1.2); scroll(1000); hold(0.9)
    goto('/tools/tracker');    hold(1.4); scroll(700);  hold(0.9)

    # ── 5. Where you would sign up (form only, never submitted) ──
    goto('/auth/signup'); hold(2.2)

    c.close()
    print('frames:', n[0])
    if n[0] < 30:
        print('too few frames'); sys.exit(1)

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out = '/home/favour-nwachukwu/Desktop/Jalla/groundwork1/docs/Groundwork-Public-Walkthrough.mp4'
    r = subprocess.run([ff, '-y', '-framerate', str(FPS), '-i', f'{OUT}/f%05d.png',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                        '-vf', 'scale=1920:1080:flags=lanczos',
                        '-crf', '20', '-preset', 'medium', out],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:]); sys.exit(1)
    print('wrote', out, os.path.getsize(out), 'bytes')

if __name__ == '__main__':
    main()
