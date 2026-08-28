"""Shared driver for Groundwork: headless Chrome over CDP, with optional frame capture.

Kept separate from the scripts that use it so the walk-through probe and the recorder
drive the app in exactly the same way — anything that works in one works in the other.
"""
import base64, json, os, shutil, subprocess, tempfile, threading, time, urllib.request
import websocket

PORT = 5199
BASE = f'http://localhost:{PORT}'
W, H = 1440, 810


class Chrome:
    def __init__(self, cdp=9250, start='/', profile_prefix='gw-'):
        self.profile = tempfile.mkdtemp(prefix=profile_prefix)
        self.cdp = cdp
        self.proc = subprocess.Popen([
            'google-chrome', '--headless=new', '--disable-gpu', '--no-sandbox',
            # Its own profile, or `google-chrome` hands off to the user's running browser.
            f'--user-data-dir={self.profile}', '--no-first-run', '--disable-extensions',
            '--disable-background-networking', '--hide-scrollbars',
            '--force-device-scale-factor=1',
            f'--remote-debugging-port={cdp}', '--remote-allow-origins=*',
            f'--window-size={W},{H}', BASE + start,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        url = None
        for _ in range(90):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://localhost:{cdp}/json/list'))
                pg = [t for t in tabs if t.get('type') == 'page'
                      and t.get('webSocketDebuggerUrl')
                      and t.get('url', '').startswith(BASE)]
                if pg:
                    url = pg[0]['webSocketDebuggerUrl']; break
            except Exception:
                pass
            time.sleep(0.5)
        if not url:
            raise RuntimeError('chrome/page did not come up')

        self.ws = websocket.create_connection(url, timeout=45)
        self.id = 0
        self.lock = threading.Lock()      # frame capture runs on another thread
        self.cmd('Runtime.enable'); self.cmd('Page.enable'); self.cmd('DOM.enable')

        # Force the VIEWPORT, do not trust --window-size.
        #
        # `--window-size=1440,810` sizes the window; the viewport that
        # Page.captureScreenshot returns came out 1440x667 — 143px short. Every frame was
        # therefore 2.16:1, and the encoders' `scale=1920:1080` squashed it back to 16:9,
        # stretching the whole picture horizontally. It looks like a bad font before it
        # looks like a bad aspect ratio, which is why it survived several rounds of
        # frame-checking: text is where the eye notices distortion first.
        #
        # setDeviceMetricsOverride sets the layout viewport exactly, so what is captured
        # is what was asked for.
        self.cmd('Emulation.setDeviceMetricsOverride',
                 width=W, height=H, deviceScaleFactor=1, mobile=False)

    def cmd(self, method, **params):
        with self.lock:
            self.id += 1; mid = self.id
            self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
            while True:
                msg = json.loads(self.ws.recv())
                if msg.get('id') == mid:
                    if 'error' in msg:
                        raise RuntimeError(f'{method}: {msg["error"]}')
                    return msg.get('result', {})

    def js(self, expr):
        try:
            return self.cmd('Runtime.evaluate', expression=expr, awaitPromise=True,
                            returnByValue=True).get('result', {}).get('value')
        except Exception as e:
            return f'ERR {e}'

    def shot(self):
        return base64.b64decode(self.cmd('Page.captureScreenshot', format='png')['data'])

    # ── interactions ─────────────────────────────────────
    def goto(self, path, settle=2.5):
        self.cmd('Page.navigate', url=BASE + path); time.sleep(settle)

    def wait_for(self, expr, timeout=25):
        """Poll a JS expression until truthy."""
        end = time.time() + timeout
        while time.time() < end:
            v = self.js(expr)
            if v and not (isinstance(v, str) and v.startswith('ERR')):
                return v
            time.sleep(0.4)
        return None

    def type_into(self, sel, text):
        ok = self.js(f"(()=>{{const e=document.querySelector({json.dumps(sel)});"
                     f"if(!e)return false;e.focus();e.select&&e.select();return true;}})()")
        if ok is not True:
            return False
        self.cmd('Input.insertText', text=text); time.sleep(0.2)
        return True

    def click_text(self, text, exact=False):
        """Click the first button/link whose visible text matches."""
        return self.js(f"""(()=>{{
          const want = {json.dumps(text)}.toLowerCase().trim();
          const els = [...document.querySelectorAll('button, a, [role=button]')]
            .filter(e => e.offsetParent !== null && !e.disabled);
          const hit = els.find(e => {{
            const t = (e.innerText||'').toLowerCase().trim();
            return {'t === want' if exact else 't.includes(want)'};
          }});
          if (!hit) return false;
          hit.scrollIntoView({{block:'center'}}); hit.click(); return true;
        }})()""")

    def click_button(self, text):
        """Click a BUTTON by text, never a link.

        The project tabs are <button>; the sidebar nav is <a> with the same words
        ('Payments', 'Documents'). Searching both matched the sidebar first and navigated
        away from the project mid-recording.
        """
        return self.js(f"""(()=>{{
          const want = {json.dumps(text)}.toLowerCase().trim();
          const els = [...document.querySelectorAll('button')]
            .filter(e => e.offsetParent !== null && !e.disabled);
          const hit = els.find(e => (e.innerText||'').toLowerCase().trim() === want)
                   || els.find(e => (e.innerText||'').toLowerCase().trim().startsWith(want));
          if (!hit) return false;
          hit.scrollIntoView({{block:'center'}}); hit.click(); return true;
        }})()""")

    def click_tab(self, text):
        """Click a PROJECT TAB, scoped to the tab bar.

        Both the sidebar nav and the tab bar are buttons carrying the same words
        ('Payments', 'Documents'), so matching on text alone kept navigating away from the
        project. The tab bar is located by the one label the sidebar does not have —
        'Overview' — and its parent is then the only place we look.
        """
        return self.js(f"""(()=>{{
          // Accent-insensitive: 'Aperçu' must match 'apercu', and the French tab labels
          // ('Étapes', 'Coûts') must match whether or not the caller typed the accent.
          const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                             .toLowerCase().trim();
          const all = [...document.querySelectorAll('button')].filter(e => e.offsetParent);
          // The anchor is the one tab the sidebar does not also carry. Both languages,
          // because looking only for 'overview' meant every French run returned
          // 'no tabbar' and silently clicked nothing — the last 24 seconds of the first
          // French walkthrough was a frozen Overview page nobody noticed.
          const ANCHORS = ['overview', 'apercu'];
          const anchor = all.find(e => ANCHORS.includes(norm(e.innerText)));
          if (!anchor) return 'no tabbar';
          const bar = anchor.parentElement;
          const want = norm({json.dumps(text)});
          const hit = [...bar.querySelectorAll('button, a')]
            .find(e => norm(e.innerText) === want);
          if (!hit) return 'no tab ' + want;
          hit.click(); return true;
        }})()""")

    def click_nth(self, selector, n=0):
        return self.js(f"""(()=>{{
          const els=[...document.querySelectorAll({json.dumps(selector)})]
            .filter(e=>e.offsetParent!==null);
          const e=els[{n}]; if(!e) return false;
          e.scrollIntoView({{block:'center'}}); e.click(); return true;}})()""")

    def scroll(self, px, steps=16, pause=0.05):
        for _ in range(steps):
            self.js(f'window.scrollBy(0,{px/steps})'); time.sleep(pause)

    def text(self, limit=400, after=None):
        expr = ("(()=>{const t=(document.body.innerText||'').replace(/\\s+/g,' ');"
                + (f"const i=t.indexOf({json.dumps(after)}); const s=(i>=0?t.slice(i):t);"
                   if after else "const s=t;")
                + f"return s.slice(0,{limit});}})()")
        return self.js(expr)

    def path(self):
        return self.js('location.pathname')

    def close(self):
        try: self.ws.close()
        except Exception: pass
        self.proc.terminate()
        shutil.rmtree(self.profile, ignore_errors=True)


class Recorder:
    def __init__(self, chrome, outdir='frames', fps=12):
        self.c = chrome; self.dir = outdir; self.fps = fps
        self.n = 0; self.on = False
        shutil.rmtree(outdir, ignore_errors=True); os.makedirs(outdir)

    def _loop(self):
        period = 1.0 / self.fps
        while self.on:
            t0 = time.time()
            try:
                with open(f'{self.dir}/f{self.n:05d}.png', 'wb') as fh:
                    fh.write(self.c.shot())
                self.n += 1
            except Exception:
                pass
            time.sleep(max(0, period - (time.time() - t0)))

    def start(self):
        self.on = True
        self.t = threading.Thread(target=self._loop, daemon=True); self.t.start()

    def stop(self):
        self.on = False
        try: self.t.join(timeout=6)
        except Exception: pass


def login(c, email, password):
    c.goto('/auth/login', 3.0)
    c.wait_for("document.querySelector('#email') ? 1 : 0")
    c.type_into('#email', email)
    c.type_into('#password', password)
    time.sleep(0.3)
    # Both languages. 'log in' alone left every French run sitting on the sign-in page,
    # and because the callers only check the path much later, the failure surfaced as an
    # empty project page rather than as a failed login.
    for label in ('log in', 'Se connecter', 'connexion'):
        if c.click_text(label) is True:
            break
    for _ in range(24):
        time.sleep(1.0)
        if c.path() not in ('/auth/login', None):
            return c.path()
    return None
