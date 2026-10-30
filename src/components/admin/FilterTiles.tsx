import { cn } from '@/lib/utils';

// =========================================================
// The tiles that sit above an admin list.
//
// Favour, 31 Oct 2026: "every content on the sidebar, when clicked on … should include
// the tiles — clickable, tells at a glance what to expect, what is going on, and a
// summary." Philip asked for the same thing in the working session, in his words
// "actionable filter cards".
//
// ── Why one component and not a copy per page ───────────────────────────────────────
// The contractor records page grew its own set first. A second hand-rolled copy on
// Projects would drift from it within a week — different padding, a different pressed
// state, a count that means something subtly different. One component means a reader
// who has learned the pattern on one page has learned it everywhere, and a fix to the
// keyboard behaviour reaches all of them at once.
//
// ── Two rules every tile set must keep ──────────────────────────────────────────────
// 1. Every number is POSITIVE and counts a set of rows. Never a difference between two
//    other numbers: Philip had those removed from the contractor funnel ("−50, −14,
//    −10") because a gap names nothing you can act on, while a set is a list of people
//    or projects you can open.
// 2. The count and the filter come from the SAME predicate, so pressing a tile that
//    says 12 can never produce 9 rows. `tileCounts` below is the only way to count, so
//    the two cannot drift apart.
// =========================================================

export interface TileSpec<Row> {
  /** Stable id, also what goes in the URL when a page syncs its filter there. */
  key: string;
  label: string;
  /** Rows this tile holds. `all` is simply a predicate that returns true. */
  match: (row: Row) => boolean;
  /**
   * A tile that counts but cannot filter — a figure that comes from somewhere other
   * than the rows on screen. Rendered flat rather than as a button, because a control
   * that does nothing when pressed is worse than a plain number.
   */
  readOnly?: boolean;
  /** Overrides the counted value, for a `readOnly` tile with its own source. */
  value?: number;
  /** Meaning, not decoration: 'good' and 'warn' mark state worth seeing at a glance. */
  tone?: 'neutral' | 'good' | 'warn';
}

/** Count every tile with the predicate that also filters it. */
export function tileCounts<Row>(tiles: TileSpec<Row>[], rows: Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tile of tiles) {
    out[tile.key] = tile.value ?? rows.filter(tile.match).length;
  }
  return out;
}

/** Apply the pressed tile. `null`, or a tile that is not found, means everything. */
export function applyTile<Row>(tiles: TileSpec<Row>[], rows: Row[], active: string | null): Row[] {
  if (!active) return rows;
  const tile = tiles.find(x => x.key === active);
  return tile ? rows.filter(tile.match) : rows;
}

export function FilterTiles<Row>({ tiles, counts, active, onPick, label }: {
  tiles: TileSpec<Row>[];
  counts: Record<string, number>;
  /** The pressed tile, or null for "everything". */
  active: string | null;
  onPick: (key: string | null) => void;
  /** Names the group for a screen reader; the heading above it is usually enough. */
  label?: string;
}) {
  return (
    <div
      role="group" aria-label={label}
      className="mb-5 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
    >
      {tiles.map(tile => {
        const pressed = active === tile.key || (active === null && tile.key === 'all');
        const value = counts[tile.key] ?? 0;

        if (tile.readOnly) {
          return (
            <div key={tile.key}
              className="rounded-xl border border-brand-border-grey bg-white px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
              <p className="text-xs text-brand-mid-grey">{tile.label}</p>
              <Value n={value} tone={tile.tone} />
            </div>
          );
        }

        return (
          <button
            key={tile.key}
            type="button"
            // Pressing the active tile clears it, so a filter is never a trap that
            // needs a page reload to escape.
            onClick={() => onPick(tile.key === 'all' ? null : pressed ? null : tile.key)}
            aria-pressed={pressed}
            className={cn(
              'rounded-xl border px-4 py-3 text-left transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black/30 dark:focus-visible:ring-white/40',
              pressed
                ? 'border-brand-near-black bg-brand-off-white dark:border-white dark:bg-[#2c2c2c]'
                : 'border-brand-border-grey bg-white hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:hover:border-[#555]',
            )}
          >
            <p className="text-xs text-brand-mid-grey">{tile.label}</p>
            <Value n={value} tone={tile.tone} />
          </button>
        );
      })}
    </div>
  );
}

/** `tabular-nums` so a column of tiles keeps its digits in line. */
function Value({ n, tone }: { n: number; tone?: TileSpec<unknown>['tone'] }) {
  return (
    <p className={cn(
      'mt-0.5 text-xl font-bold tabular-nums',
      tone === 'good' ? 'text-state-complete'
        : tone === 'warn' ? 'text-state-held'
        : 'text-brand-near-black dark:text-white',
    )}>
      {n}
    </p>
  );
}
