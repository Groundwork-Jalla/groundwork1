import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No form control a contractor meets on a phone may be under 16px.
 *
 * iOS Safari zooms the page whenever a focused input is smaller than that. On the
 * onboarding form — a sequence of seven panels, often filled in on site — every field
 * triggered it, so the layout jumped on each tap. The fix is `text-base sm:text-sm`:
 * 16px where it matters, and the original 14px from sm up, where no browser zooms.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const CONTRACTOR_FACING = [
  'src/components/ui/input.tsx',
  'src/components/ui/PhoneField.tsx',
  'src/app/routes/work/onboarding.tsx',
  'src/app/routes/work/partner.tsx',
  'src/components/contractor/PayoutDialog.tsx',
  // The search box in the contractor sidebar is a text input like any other.
  'src/components/shell/PortalShell.tsx',
];

/**
 * Each focusable control, with the class list that applies to it.
 *
 * A className usually sits a line or two below its tag, so this reads a small window
 * after each one rather than the same line. An earlier version just grepped for lines
 * containing `text-sm` and flagged a `<p role="alert">`, which no browser zooms.
 */
function controlClassLines(src: string): string[] {
  const lines = src.split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    // A shared field class is a single line; only that line styles the control. Scanning
    // past it picked up the `const label =` beside it, which styles a caption.
    if (/const\s+field\s*=/.test(line)) { out.push(line); return; }
    if (!/<(input|textarea|select)\b/.test(line)) return;
    for (const l of lines.slice(i, i + 7)) {
      // Comments explaining the rule mention both class names; they style nothing.
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
      if (/text-sm|text-xs|text-base/.test(l)) out.push(l);
      if (/\/>|<\/(textarea|select)>/.test(l)) break;
    }
  });
  return out;
}

describe('phone keyboards do not zoom the page', () => {
  it.each(CONTRACTOR_FACING)('%s sizes its form controls from text-base', file => {
    for (const line of controlClassLines(read(file))) {
      expect(line, `a form control under 16px on mobile:\n${line.trim().slice(0, 150)}`)
        .toMatch(/text-base sm:text-(sm|xs)/);
    }
  });

  it('actually looks at something, so a passing run is not an empty one', () => {
    // Guard against the selector drifting and quietly checking nothing at all.
    expect(controlClassLines(read('src/components/ui/PhoneField.tsx')).length)
      .toBeGreaterThan(0);
  });

  it('the shared Input is the one that fixes it for everything else', () => {
    expect(read('src/components/ui/input.tsx')).toMatch(/text-base sm:text-sm/);
  });
});
