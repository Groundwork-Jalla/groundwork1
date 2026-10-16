import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser must not rewrite the page under React.
 *
 * Reported as "Something went wrong. Please refresh the page." on a contractor's project
 * page. The console showed:
 *
 *   NotFoundError: Failed to execute 'insertBefore' on 'Node': the node before which the
 *   new node is to be inserted is not a child of this node
 *
 * with every frame inside React and none in Groundwork — the signature of a DOM mutated
 * from outside. Chrome's page translation replaces text nodes in place; React then
 * reconciles against siblings that have moved and the whole tree unmounts.
 *
 * Groundwork translates itself through the EN/FR switch, so browser translation is
 * redundant here as well as harmful.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const root = readFileSync(join(ROOT, 'src/app/root.tsx'), 'utf8');

describe('translation is refused at the document level', () => {
  it('the html element says no', () => {
    expect(root).toMatch(/<html lang="en" translate="no"/);
  });

  it('and the older meta signal is there too', () => {
    // Some Chrome versions honour the meta where the attribute alone is ignored. Both,
    // because one of them silently not applying is how this reached production.
    expect(root).toMatch(/<meta name="google" content="notranslate" \/>/);
  });

  it('including the body, which is the subtree React actually owns', () => {
    expect(root).toMatch(/<body translate="no"/);
  });

  it('but `lang` is still set, because that is what OUR switch and screen readers use', () => {
    // Refusing browser translation must not cost the accessibility signal.
    expect(root).toMatch(/document\.documentElement\.lang=l/);
    expect(root).toMatch(/<html lang="en"/);
  });
});

describe('and the page does not claim a language it is not written in', () => {
  const i18n = readFileSync(join(ROOT, 'src/lib/i18n/index.tsx'), 'utf8');

  it('<html lang> follows the rendered language on every load, not only on a toggle', () => {
    /**
     * The pre-paint script guesses from `navigator.languages`. In Cameroon that guess is
     * often `fr` while the provider resolves to English, and `gen204?sl=fr&tl=en` in the
     * network log is Chrome acting on exactly that: a page marked French, full of
     * English, auto-translated back to English — rewriting the DOM under React.
     */
    expect(i18n).toMatch(/useEffect\(\(\) => \{[\s\S]{0,200}document\.documentElement\.lang = LANG_META\[lang\]\.htmlLang;[\s\S]{0,40}\}, \[lang\]\);/);
  });

  it('and the toggle still records the choice as it did', () => {
    expect(i18n).toMatch(/localStorage\.setItem\(STORAGE_KEY, next\)/);
    expect(i18n).toMatch(/persistPreferredLang\(next\)/);
  });
});
