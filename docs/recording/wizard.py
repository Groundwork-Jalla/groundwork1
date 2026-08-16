"""Drive the 11-step wizard.

Dispatch is keyed on the heading, not on a fixed sequence: some steps auto-advance when
you pick a card and others wait for Continue, so a scripted order desynchronises the
moment one behaves differently from what you assumed. Reading the heading each time makes
the driver self-correcting.
"""
import time

# ONE click per call. React batches synchronous clicks, so firing + four times in a
# single evaluation had every handler read value=0 from the same render and set 1 — the
# first cut showed "1 bed · 1 bath" on a 120 m² two-storey.
BUMP_ONCE = """(function(names){
  const row = [...document.querySelectorAll('div')].find(d => {
    const t = d.innerText || '';
    return names.some(x => t.startsWith(x)) && d.querySelectorAll('button').length === 2;
  });
  if (!row) return 'no row';
  row.querySelectorAll('button')[1].click();
  return (row.innerText||'').split('\\n')[0].trim().slice(0,18);
})(%s)"""

SET_INPUT = """(function(sel, val){
  const el = document.querySelector(sel); if (!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(val));
  el.dispatchEvent(new Event('input',  {bubbles:true}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
  return true;
})(%s, %s)"""


def heading(c):
    return (c.js("document.querySelector('h1')?.innerText") or '').strip()


# Selecting a card does not always advance — on several steps a Continue button only
# appears once something is chosen. Always try it after picking.
def _pick(c, hold, label, pause=1.4):
    c.click_text(label); hold(pause)
    c.click_text('continue'); hold(0.9)

def step_country(c, hold):       _pick(c, hold, 'Cameroon')
def step_project_type(c, hold):  _pick(c, hold, 'Residential')
def step_building_type(c, hold): _pick(c, hold, 'Single Family')

def step_floors(c, hold):
    c.click_text('+', exact=True); hold(1.3)          # G+1
    c.click_text('continue'); hold(1.0)

def step_rooms(c, hold):
    import json as _j
    plan = [(['Bedrooms'], 4), (['Bathrooms'], 3), (['Living'], 2),
            (['Kitchens'], 1), (['Home Offices', 'Offices'], 1)]
    for names, count in plan:
        for _ in range(count):
            c.js(BUMP_ONCE % _j.dumps(names))
            hold(0.35)          # let React commit before the next click
        hold(0.35)
    hold(0.8)
    c.click_text('continue'); hold(1.0)

def step_bq(c, hold):
    c.click_text('No', exact=True); hold(1.3)
    c.click_text('continue'); hold(1.0)

def step_roof(c, hold):
    c.click_text('Pitched'); hold(1.6)
    c.click_text('Long Span'); hold(1.5)
    c.click_text('continue'); hold(1.0)

def step_details(c, hold, log=print):
    # The floor area lives here and drives the ENTIRE budget — leaving it unset produced
    # a $0.00 estimate at the final step, which is the one number that must never be
    # wrong on camera.
    log('     inputs: ' + str(c.js("""[...document.querySelectorAll('input')]
        .filter(e=>e.offsetParent)
        .map(i=>[i.tagName,i.type,i.id||i.name||i.placeholder||''].join(':'))
        .join(' | ')""")))

    c.click_text('Douala'); hold(1.0)

    for sel in ('#project-name', '#projectName', '#name'):
        if c.type_into(sel, 'Yaounde Family Home'):
            log(f'     name via {sel}'); break
    hold(0.6)

    # Accept the app's own suggestion if it offers one; otherwise type a figure.
    if not c.click_text('Use suggested'):
        for sel in ('#sqm', "input[inputmode='numeric']", "input[placeholder*='sqm' i]"):
            if c.type_into(sel, '120'):
                log(f'     sqm via {sel}'); break
    hold(1.0)
    c.click_text('continue'); hold(1.2)

def step_summary(c, hold):
    c.scroll(700); hold(1.6)
    c.scroll(700); hold(1.4)
    c.click_text('continue'); hold(1.0)

def step_plan(c, hold):
    c.click_text('Select this plan'); hold(1.8)
    c.click_text('continue'); hold(1.0)

def step_confirm(c, hold):
    hold(2.0)
    c.click_text('Confirm budget'); hold(2.0)


HANDLERS = [
    ('where will you be building', step_country),
    ('what are you building',      step_project_type),
    ('what type of',               step_building_type),
    ('how many floors',            step_floors),
    ('rooms per floor',            step_rooms),
    ('boys',                       step_bq),
    ('roof',                       step_roof),
    ('project details',            step_details),
    ('tell us about your project',  step_details),
    ('almost there',               step_details),
    ('your build',                 step_summary),
    ('at a glance',                step_summary),
    ('summary',                    step_summary),
    ('choose your plan',           step_plan),
    ('confirm your budget',        step_confirm),
]


def run_wizard(c, hold, log=print):
    """Walk the whole wizard. Returns the final path."""
    seen = []
    for _ in range(20):
        h = heading(c)
        if not h:
            hold(1.0); continue
        log(f'   · {h}')
        handler = None
        hl = h.lower()
        for key, fn in HANDLERS:
            if key in hl:
                handler = fn; break
        if handler is None:
            log(f'   ! no handler for {h!r}')
            if not c.click_text('continue'):
                break
            hold(1.2); continue

        if handler is step_details:
            handler(c, hold, log)
        else:
            handler(c, hold)

        # Wait for the heading to change, or for the wizard to hand off to the project.
        for _ in range(20):
            if c.path() != '/projects/new':
                return c.path()
            if heading(c) != h:
                break
            hold(0.5)
        seen.append(h)
        if len(seen) > 14:
            break
    return c.path()
