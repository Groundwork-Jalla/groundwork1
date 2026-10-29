import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every hook in the partner page runs on every render.
 *
 * 30 Oct 2026: `useEffect(... , [page])` had been written beside the state it
 * watches, which put it BELOW two early returns — `if (state === null)` while the
 * application status loads, and `if (state !== 'none')` for somebody already in the
 * queue. The first render took the early return and ran eleven hooks; the second ran
 * twelve. React threw "Rendered more hooks than during the previous render" and the
 * error boundary replaced the whole page with "Something went wrong".
 *
 * That took out the partner funnel's only door for every contractor who had not yet
 * applied — which is everyone it is for. A type checker cannot see it and a unit
 * test of the component would need the whole auth stack, so the rule is enforced
 * here, on the source: no hook call may appear after the first early return.
 */

const SOURCE = readFileSync('src/app/routes/work/partner.tsx', 'utf8');

/** Where the component body starts — the hooks above this belong to nothing else. */
const BODY = SOURCE.slice(SOURCE.indexOf('export default function PartnerApplication'));
/** Everything past this point is a separate component, with its own hook scope. */
const COMPONENT = BODY.slice(0, BODY.indexOf('\nfunction '));

describe('the partner page calls its hooks unconditionally', () => {
  const lines = COMPONENT.split('\n');
  const firstReturn = lines.findIndex(l => /^  if \(.*\) \{$/.test(l));

  it('has an early return to guard against in the first place', () => {
    // If this ever stops being true the rule below is vacuous, and silence would be
    // mistaken for safety.
    expect(firstReturn).toBeGreaterThan(0);
  });

  it('calls no hook after the first early return', () => {
    const after = lines
      .map((line, n) => ({ line, n: n + 1 }))
      .filter(({ n }) => n > firstReturn)
      .filter(({ line }) => /^\s*(?:const [^=]+= )?use(?:State|Effect|Callback|Memo|Ref|Context|Reducer)\b/.test(line));

    expect(after.map(x => `line ${x.n}: ${x.line.trim()}`)).toEqual([]);
  });
});
