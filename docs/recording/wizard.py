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
def _continue(c, hold, pause=0.9):
    """Advance. Tries both languages, because the button is the only control that
    appears on every step and the label changes with the UI language."""
    for word in ('continue', 'continuer'):
        if c.click_text(word) is True:
            hold(pause); return True
    hold(pause); return False


def _pick(c, hold, label, pause=1.4):
    c.click_text(label); hold(pause)
    _continue(c, hold)

# Card labels differ by language. Cameroon/Cameroun and Residential/Résidentiel are the
# two that matter; 'Single Family' has no accent difference worth splitting on, so the
# helper falls through to picking the first card if no label matches.
def _pick_any(c, hold, labels, pause=1.4):
    for label in labels:
        if c.click_text(label) is True:
            hold(pause); _continue(c, hold); return
    # Nothing matched — take the first real option card rather than stalling the run.
    c.js("""(()=>{const b=[...document.querySelectorAll('button')]
        .filter(x=>x.offsetHeight>70 && !x.disabled); if(b[0]){b[0].click();return 1}return 0})()""")
    hold(pause); _continue(c, hold)

def step_country(c, hold):       _pick_any(c, hold, ['Cameroon', 'Cameroun'])
def step_project_type(c, hold):  _pick_any(c, hold, ['Residential', 'Résidentiel'])
def step_building_type(c, hold): _pick_any(c, hold, ['Single Family', 'Famille unique', 'Maison individuelle'])

def step_floors(c, hold):
    c.click_text('+', exact=True); hold(1.3)          # G+1
    _continue(c, hold, 1.0)

def step_rooms(c, hold):
    # Indexed off `aria-label^="Increase"`, NOT the visible room name.
    #
    # The old version matched on 'Bedrooms', 'Kitchens' and so on, which are English. A
    # French run added no rooms at all, and since Step 5 now refuses to continue with
    # zero rooms (correctly), the driver looped on "Pieces par niveau" until it gave up
    # and filmed three minutes of a wizard that never advanced.
    #
    # The aria-label is an English verb concatenated onto a TRANSLATED noun — "Increase
    # Chambres" — so the prefix is stable across languages while the full string is not.
    # Order follows ROOM_TYPES in Step5Rooms.tsx: bed, bath, living, kitchen, office.
    for index, count in enumerate([4, 3, 2, 1, 1]):
        for _ in range(count):
            c.js(f"""(()=>{{const b=[...document.querySelectorAll(
                'button[aria-label^=\"Increase\"]')];
                if(b[{index}] && !b[{index}].disabled){{b[{index}].click();return 1}}
                return 0}})()""")
            hold(0.35)          # one click per call — React batches synchronous clicks
        hold(0.3)
    hold(0.8)
    _continue(c, hold, 1.0)

def step_bq(c, hold):
    # 'No' and 'Non' — and 'Non' is a prefix of nothing else on this step.
    for label in ('No', 'Non'):
        if c.click_text(label, exact=True) is True: break
    hold(1.3)
    _continue(c, hold, 1.0)

def step_roof(c, hold):
    for label in ('Pitched', 'En pente'):
        if c.click_text(label) is True: break
    hold(1.6)
    for label in ('Long Span', 'Aluminium grande portée'):
        if c.click_text(label) is True: break
    hold(1.5)
    _continue(c, hold, 1.0)

def step_details(c, hold, log=print):
    # The floor area lives here and drives the ENTIRE budget — leaving it unset produced
    # a $0.00 estimate at the final step, which is the one number that must never be
    # wrong on camera.
    log('     inputs: ' + str(c.js("""[...document.querySelectorAll('input')]
        .filter(e=>e.offsetParent)
        .map(i=>[i.tagName,i.type,i.id||i.name||i.placeholder||''].join(':'))
        .join(' | ')""")))

    c.click_text('Douala'); hold(1.0)   # city chip reads the same in both languages

    for sel in ('#project-name', '#projectName', '#name'):
        if c.type_into(sel, 'Yaounde Family Home'):
            log(f'     name via {sel}'); break
    hold(0.6)

    # Accept the app's own suggestion if it offers one; otherwise type a figure.
    # The footprint now fills itself from the room schedule (Aug 2026), so there is
    # usually nothing to do here. Typing only if it somehow came through empty.
    if not c.js("(()=>{const e=document.querySelector('#sqm');return e&&e.value?1:0})()"):
        for sel in ('#sqm', "input[inputmode='numeric']", "input[placeholder*='sqm' i]"):
            if c.type_into(sel, '120'):
                log(f'     sqm via {sel}'); break
    hold(1.0)
    _continue(c, hold, 1.2)

def step_summary(c, hold):
    c.scroll(700); hold(1.6)
    c.scroll(700); hold(1.4)
    _continue(c, hold, 1.0)

def step_plan(c, hold):
    # 'Select this plan' no longer exists — the step is a column of tier cards and the
    # choice is made by clicking one, then Continue. Clicking the first card picks Self
    # Verify, which is the free tier and the one a beta tester will actually be on.
    c.js("""(()=>{const b=[...document.querySelectorAll('button')]
        .filter(x=>x.offsetHeight>90 && !x.disabled); if(b[0]){b[0].click();return 1}return 0})()""")
    hold(1.8)
    _continue(c, hold, 1.0)

def step_confirm(c, hold):
    hold(2.0)
    for label in ('Confirm budget', 'Confirmer le budget'):
        if c.click_text(label) is True: break
    hold(2.0)


# Matched against the lower-cased h1. BOTH LANGUAGES, because the app is bilingual and a
# French recording otherwise stalls on step 1 with no handler and no explanation.
# Accented characters are avoided in the keys where a shorter unaccented fragment is
# unambiguous — 'coup d' for "Votre projet en un coup d'oeil" — so the match does not
# depend on how the apostrophe or the diacritic happens to be encoded.
HANDLERS = [
    ('where will you be building', step_country),
    ('ou allez-vous construire',   step_country),
    ('allez-vous construire',      step_country),
    ('what are you building',      step_project_type),
    ('que construisez-vous',       step_project_type),
    ('what type of',               step_building_type),
    ('quel type de b',             step_building_type),
    ('how many floors',            step_floors),
    ('combien de niveaux',         step_floors),
    ('rooms per floor',            step_rooms),
    ('ces par niveau',             step_rooms),          # "Pieces par niveau"
    ('boys',                       step_bq),
    ('pendance',                   step_bq),   # matches dependance and dépendance
    ('y aura-t-il',                step_bq),
    ('roof',                       step_roof),
    ('toiture',                    step_roof),
    ('project details',            step_details),
    ('tell us about your project', step_details),
    ('almost there',               step_details),
    ('parlez-nous',                step_details),
    ('your build',                 step_summary),
    ('at a glance',                step_summary),
    ('summary',                    step_summary),
    ('coup d',                     step_summary),
    ('choose your plan',           step_plan),
    ('choisissez votre forfait',   step_plan),
    ('confirm your budget',        step_confirm),
    ('confirmez votre budget',     step_confirm),
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
            if not _continue(c, hold):
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
