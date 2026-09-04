"""
Drive the REAL signup form and check the password policy as a user meets it.

    pnpm dev --port 5199        # or: npx vite --port 5199 --strictPort
    .venv/bin/python docs/recording/check_password_ui.py

WHY THIS EXISTS. `password-policy.test.ts` proves the rules; it cannot prove they reach
the screen. Between the policy and the user sit PasswordStrength.tsx, two dictionaries and
a form — and a missing i18n key, a wrong prop or a component that never renders would pass
every unit test while the meter showed nothing. This walks the actual DOM in Chrome.

CLIENT-SIDE ONLY, on purpose. Every assertion is about what happens BEFORE
supabase.auth.signUp() is reached, and the submit button is never pressed with a password
the form would accept — so this can be run against a dev server pointed at the production
Supabase project without creating anything.

Exits non-zero on the first failing assertion set, so it can be wired into CI later.
"""
import sys, time
sys.path.insert(0, 'docs/recording')
from gw import Chrome

FAILS = []
def check(name, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        print(f"        expected {want!r}, got {got!r}")
        FAILS.append(name)

c = Chrome(cdp=9271, start='/auth/signup')
# Poll for hydration. A fixed sleep raced the SPA: the first probe ran before React had
# mounted, which read as "the page did not render" when it simply had not yet.
for _ in range(60):
    if c.js("!!document.querySelector('#password')") is True:
        break
    time.sleep(0.5)
else:
    print("FATAL: signup form never mounted"); sys.exit(1)

# React controlled inputs ignore .value = x; the native setter + an input event is what
# makes onChange fire.
SET = """
(function(sel, val){
  const el = document.querySelector(sel);
  if (!el) return 'no-element';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(el, val);
  el.dispatchEvent(new Event('input', {bubbles:true}));
  return 'ok';
})
"""
def type_into(sel, val):
    return c.js(f"{SET}({sel!r}, {val!r})")

def meter():
    """(filled segments, label) from the strength bar."""
    return c.js("""(function(){
      const bar = document.querySelector('[role=progressbar]');
      if (!bar) return null;
      const label = bar.parentElement.querySelector('span');
      return { now: Number(bar.getAttribute('aria-valuenow')),
               label: label ? label.textContent.trim() : null };
    })()""")

def rules():
    """Each rule row -> passed?  Keyed by its visible text."""
    return c.js("""(function(){
      const bar = document.querySelector('[role=progressbar]');
      if (!bar) return null;
      const ul = bar.parentElement.parentElement.querySelector('ul');
      if (!ul) return null;
      const out = {};
      ul.querySelectorAll('li').forEach(li => {
        // A passed rule renders a Check, a failed one an X. lucide marks them by class.
        out[li.textContent.trim()] = !li.className.includes('text-brand-mid-grey');
      });
      return out;
    })()""")

print("\n--- the form is really there ---")
check("signup page rendered", c.js("!!document.querySelector('#password')"), True)
check("no meter before typing", c.js("!!document.querySelector('[role=progressbar]')"), False)

print("\n--- meter appears and moves ---")
type_into('#password', 'a')
time.sleep(0.4)
m1 = meter()
check("meter appears on first keystroke", m1 is not None and 'now' in (m1 or {}), True)
print(f"        'a' -> {m1}")

type_into('#password', 'Chantier7Buea')
time.sleep(0.4)
m2 = meter()
print(f"        'Chantier7Buea' -> {m2}")
check("a real password scores above 1", (m2 or {}).get('now', 0) > 1, True)

type_into('#password', 'Chantier7Buea!ExtraLong')
time.sleep(0.4)
m3 = meter()
print(f"        longer+symbol -> {m3}")
check("longer and more varied scores higher", (m3 or {}).get('now',0) >= (m2 or {}).get('now',0), True)

print("\n--- the blocklist reaches the screen ---")
type_into('#password', 'Password123!')
time.sleep(0.4)
mb = meter(); rb = rules()
print(f"        'Password123!' -> {mb}")
print(f"        rules: {rb}")
check("a breached-style password is floored at 0", (mb or {}).get('now'), 0)
common = [v for k, v in (rb or {}).items() if 'common' in k.lower() or 'courant' in k.lower()]
check("the 'not a common password' rule fails", common and common[0] is False, True)

print("\n--- it knows who is typing ---")
type_into('#fullName', 'Favour Nwachukwu')
type_into('#email', 'favour@tryjalla.com')
type_into('#password', 'Favour123456789')
time.sleep(0.5)
mp = meter(); rp = rules()
print(f"        own-name password -> {mp}")
personal = [v for k, v in (rp or {}).items() if 'name or email' in k.lower() or 'nom' in k.lower()]
check("the 'not your name/email' rule fails", personal and personal[0] is False, True)
check("own-name password floored at 0", (mp or {}).get('now'), 0)

print("\n--- submit is actually gated ---")
type_into('#password', 'Abc1')
type_into('#confirmPassword', 'Abc1')
time.sleep(0.3)
before = c.js("window.location.pathname")
c.js("document.querySelector('form').requestSubmit()")
time.sleep(1.2)
after = c.js("window.location.pathname")
err = c.js("""(function(){
  const p = [...document.querySelectorAll('p')].find(p => /requirement|conditions/i.test(p.textContent));
  return p ? p.textContent.trim() : null;
})()""")
check("stayed on the signup page", after, before)
check("showed the requirements error", err is not None, True)
print(f"        error shown: {err!r}")

print("\n--- mismatch is caught separately ---")
type_into('#password', 'Chantier7Buea')
type_into('#confirmPassword', 'Chantier7Bueb')
time.sleep(0.3)
c.js("document.querySelector('form').requestSubmit()")
time.sleep(1.2)
err2 = c.js("""(function(){
  const p = [...document.querySelectorAll('p')].find(p => /match|correspondent/i.test(p.textContent));
  return p ? p.textContent.trim() : null;
})()""")
check("mismatch error shown, not the requirements one", err2 is not None, True)
check("still on signup", c.js("window.location.pathname"), before)
print(f"        error shown: {err2!r}")

print("\n--- console clean? ---")
errs = c.js("JSON.stringify(window.__errs || [])")
print(f"        {errs}")

c.cmd('Browser.close')
print(f"\n{'ALL PASSED' if not FAILS else 'FAILURES: ' + ', '.join(FAILS)}")
sys.exit(1 if FAILS else 0)
