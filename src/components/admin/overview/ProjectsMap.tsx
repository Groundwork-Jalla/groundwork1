import { useEffect, useMemo, useState } from 'react';
import type { LocationCount } from '@/lib/supabase/admin-overview';
import { findCountry } from '@/lib/countries';
import {
  ISO_A2_TO_NUMERIC, boundsOf, frameFor, intensity, intersects, mergeBounds, pathFor, ringsOf,
  type BBox, type MapCountry,
} from '@/lib/admin/world-map';
import { useT } from '@/lib/i18n';

// =========================================================
// Map View.
//
// Real national boundaries from Natural Earth (`world-atlas`, public domain, 1:110m),
// shaded by the project counts our own rows produce. Geometry supplies geography and
// nothing else; the data supplies counts and nothing else.
//
// THERE ARE NO PINS. `projects` records a country and a city, never coordinates, so there
// is no honest point to put a marker on. A country is shaded or it is not.
//
// The geometry is `import()`ed rather than imported: ~108 KB of JSON that only the admin
// Overview needs has no business in the entry bundle. Until it resolves the card shows
// its own skeleton, and if it never resolves the legend below still carries every number.
// =========================================================

const W = 640, H = 400;

type Topo = {
  objects: { countries: { geometries: { id?: string | number; properties?: { name?: string } }[] } };
};

let cache: Promise<MapCountry[]> | null = null;

/** Natural Earth's TopoJSON, decoded once per page load. */
function loadCountries(): Promise<MapCountry[]> {
  cache ??= (async () => {
    const [{ feature }, topo] = await Promise.all([
      import('topojson-client'),
      import('world-atlas/countries-110m.json'),
    ]);
    const t = (topo.default ?? topo) as unknown as Topo;
    const fc = feature(t as never, (t as never as { objects: { countries: never } }).objects.countries) as unknown as {
      features: { id?: string | number; properties?: { name?: string }; geometry: { type: string; coordinates: unknown } }[];
    };
    return fc.features.map(f => ({
      id: Number(f.id),
      name: f.properties?.name ?? '',
      polygons: ringsOf(f.geometry),
    }));
  })();
  return cache;
}

export function ProjectsMap({ locations }: { locations: LocationCount[] }) {
  const t = useT();
  const [countries, setCountries] = useState<MapCountry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCountries()
      .then(c => { if (alive) setCountries(c); })
      // The numbers below do not depend on the geometry, so a failure to fetch it costs
      // the picture and nothing else.
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  /** Project counts per alpha-2 code, from the rows the Overview already loaded. */
  const counts = useMemo(() => {
    const by = new Map<string, number>();
    for (const l of locations) by.set(l.country, (by.get(l.country) ?? 0) + l.count);
    return by;
  }, [locations]);

  const max = Math.max(0, ...counts.values());

  const { frame, shaded, context } = useMemo(() => {
    if (!countries) return { frame: frameFor(null, W / H), shaded: [], context: [] };

    // Numeric ids for the countries we actually have projects in. A country code we have
    // no ISO mapping for is simply not drawn — it is still counted in the legend, because
    // "we cannot draw Malta" is not a reason to hide a project in Malta.
    const wanted = new Map<number, { code: string; count: number }>();
    for (const [code, count] of counts) {
      const num = ISO_A2_TO_NUMERIC[code];
      if (num !== undefined) wanted.set(num, { code, count });
    }

    const withData = countries.filter(c => wanted.has(c.id));
    let bounds: BBox | null = null;
    for (const c of withData) bounds = mergeBounds(bounds, boundsOf(c.polygons));
    const f = frameFor(bounds, W / H);

    // Neighbours are drawn for context; anything outside the frame is dropped rather than
    // clipped, which also keeps Fiji and Russia from smearing across an equirectangular.
    const ctx: { key: string; d: string }[] = [];
    const hot: { key: string; d: string; code: string; name: string; count: number }[] = [];
    for (const c of countries) {
      const b = boundsOf(c.polygons);
      if (!b || !intersects(b, f)) continue;
      const d = pathFor(c.polygons, f, W, H);
      if (!d) continue;
      const hit = wanted.get(c.id);
      if (hit) hot.push({ key: String(c.id), d, code: hit.code, name: c.name, count: hit.count });
      else ctx.push({ key: String(c.id), d });
    }
    return { frame: f, shaded: hot, context: ctx };
  }, [countries, counts]);

  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((a, [, n]) => a + n, 0);

  return (
    <div className="px-5 py-4">
      <div className="relative overflow-hidden rounded-xl border border-brand-border-grey bg-brand-off-white dark:border-[#2c2c2c] dark:bg-[#161616]">
        {!countries ? (
          <div className="flex h-[200px] items-center justify-center text-[11px] text-brand-muted-grey">
            {failed ? t('admin.map.geometryUnavailable') : t('common.loading')}
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-[200px] w-full" role="img"
            aria-label={ranked.map(([c, n]) => `${findCountry(c)?.name ?? c}: ${n}`).join(', ')}>
            {/* Neighbours: present so the shaded countries are somewhere, not floating. */}
            <g className="fill-[#e3e2dd] stroke-[#f7f7f5] dark:fill-[#2a2a2a] dark:stroke-[#161616]" strokeWidth="0.7">
              {context.map(c => <path key={c.key} d={c.d} />)}
            </g>
            {/* Countries we build in, shaded by their real share of the fleet. */}
            <g className="fill-[#0a0a0a] stroke-[#f7f7f5] dark:fill-white dark:stroke-[#161616]" strokeWidth="0.7">
              {shaded.map(c => (
                <path
                  key={c.key}
                  d={c.d}
                  fillOpacity={intensity(c.count, max)}
                  onMouseEnter={() => setHover(c.code)}
                  onMouseLeave={() => setHover(null)}
                  className="cursor-default transition-[fill-opacity]"
                >
                  <title>{`${findCountry(c.code)?.name ?? c.name} — ${c.count}`}</title>
                </path>
              ))}
            </g>
          </svg>
        )}
      </div>

      {/* The legend carries every country, including any the geometry has no shape for. */}
      <ul className="mt-3 space-y-2">
        {ranked.slice(0, 5).map(([code, count]) => {
          const share = total > 0 ? Math.round((count / total) * 100) : 0;
          const cities = locations.filter(l => l.country === code).slice(0, 4);
          return (
            <li key={code} className={hover === code ? 'opacity-100' : 'opacity-90'}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 rounded border border-brand-border-grey px-1.5 py-px text-[10px] font-semibold tracking-wide text-brand-mid-grey dark:border-[#2c2c2c]">
                    {code}
                  </span>
                  <span className="truncate text-xs font-medium text-brand-near-black dark:text-white">
                    {findCountry(code)?.name ?? code}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-brand-mid-grey">
                  {count}<span className="ml-1.5 text-brand-muted-grey">{share}%</span>
                </span>
              </div>
              {cities.length > 0 && (
                <p className="mt-0.5 truncate text-[11px] text-brand-mid-grey">
                  {cities.map(c => `${c.city ?? t('admin.map.noCity')} ${c.count}`).join(' · ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {ranked.length > 5 && (
        <p className="mt-2.5 text-[11px] text-brand-muted-grey">
          {t('admin.map.moreCountries', { shown: 5, total: ranked.length })}
        </p>
      )}
    </div>
  );
}
