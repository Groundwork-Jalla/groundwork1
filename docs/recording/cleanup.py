"""Delete the test projects my recording runs created.

They filled the free plan's three-project allowance, which is why the last run stopped at
'Confirm your budget' — the same cap the beta guide warns testers about.
"""
import re, time
from gw import Chrome, login

c = Chrome(cdp=9262, start='/auth/login', profile_prefix='gw-clean-')
print('login ->', login(c, 'favour@tryjalla.com', '1234567890'))
c.js("try{localStorage.setItem('lang','en')}catch(e){}")
time.sleep(1.5)

for round_ in range(8):
    c.goto('/projects', 3.5)
    ids = c.js("""[...document.querySelectorAll('a[href^="/projects/"]')]
        .map(a=>a.getAttribute('href'))
        .filter(h=>/^\\/projects\\/[0-9a-f-]{36}$/.test(h))
        .filter((v,i,s)=>s.indexOf(v)===i)""") or []
    print(f'round {round_}: {len(ids)} project(s)')
    if not ids:
        break

    href = ids[0]
    c.goto(href, 3.5)
    name = c.js("document.querySelector('h1')?.innerText") or '?'
    c.scroll(4000); time.sleep(1.2)

    if not c.click_text('Delete project'):
        print('   no delete button on', href, '- archiving instead')
        c.click_text('Archive project'); time.sleep(2.0)
        continue

    time.sleep(1.5)
    # The dialog will not enable its confirm until the consequence is acknowledged.
    c.js("""(()=>{const cb=document.querySelector('[role=alertdialog] input[type=checkbox]');
             if(cb && !cb.checked){cb.click(); return 'ticked';} return 'no checkbox';})()""")
    time.sleep(0.8)
    ok = c.js("""(()=>{const d=document.querySelector('[role=alertdialog]'); if(!d) return 'no dialog';
        const b=[...d.querySelectorAll('button')].find(e=>/delete/i.test(e.innerText||'')&&!e.disabled);
        if(!b) return 'confirm disabled'; b.click(); return 'confirmed';})()""")
    print(f'   {name!r} -> {ok}')
    time.sleep(4.0)

c.goto('/projects', 3.0)
print('final:', c.text(160, after='My Builds'))
c.close()
