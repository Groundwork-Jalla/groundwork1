// =========================================================
// The geographic layer of the Overview's Map View.
//
// GEOMETRY COMES FROM NATURAL EARTH (via `world-atlas`, public domain), COUNTS COME FROM
// OUR OWN ROWS, AND THE TWO NEVER MIX (Favour, 14 Sep 2026). The map shades a country
// because `projects.country` says so; the shape it shades is a real national boundary.
// Nothing here invents a coordinate, and there is no project-level pin — `projects`
// records a country and a city and no coordinates, and that has not changed.
//
// No d3. A choropleth over one continent needs a projection, a path serialiser and a
// bounding box; all three are below in about forty lines, and they are pure, so the
// tests can pin them. Pulling in d3-geo to draw a rectangle's worth of maths would cost
// more than it explains.
// =========================================================

/**
 * ISO 3166-1 alpha-2 → numeric, for every country `lib/countries.ts` offers.
 *
 * Natural Earth keys its geometries by the numeric code; our projects store alpha-2. Both
 * are published ISO facts, and `world-map.test.ts` checks this table against Natural
 * Earth's own country names so a typo here cannot silently shade the wrong country.
 */
export const ISO_A2_TO_NUMERIC: Record<string, number> = {
  AO: 24,  BJ: 204, BW: 72,  CD: 180, CG: 178, CI: 384, CM: 120, EG: 818,
  ET: 231, GA: 266, GH: 288, KE: 404, MA: 504, MZ: 508, NG: 566, RW: 646,
  SN: 686, TG: 768, TN: 788, TZ: 834, UG: 800, ZA: 710, ZM: 894, ZW: 716,
};

export interface BBox { minLon: number; maxLon: number; minLat: number; maxLat: number }

/** The whole of Africa, the fallback frame when nothing plottable is on the map yet. */
export const AFRICA: BBox = { minLon: -19, maxLon: 52, minLat: -36, maxLat: 38 };

type Ring = [number, number][];
export type Poly = Ring[];

/** A country as the renderer wants it: numeric id, name, and its rings. */
export interface MapCountry { id: number; name: string; polygons: Poly[] }

/** Every ring of a GeoJSON Polygon / MultiPolygon, flattened to one list. */
export function ringsOf(geometry: { type: string; coordinates: unknown }): Poly[] {
  if (geometry.type === 'Polygon')      return [geometry.coordinates as Ring[]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Poly[];
  return [];
}

export function boundsOf(polygons: Poly[]): BBox | null {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const poly of polygons) for (const ring of poly) for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return Number.isFinite(minLon) ? { minLon, maxLon, minLat, maxLat } : null;
}

export function mergeBounds(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minLon: Math.min(a.minLon, b.minLon), maxLon: Math.max(a.maxLon, b.maxLon),
    minLat: Math.min(a.minLat, b.minLat), maxLat: Math.max(a.maxLat, b.maxLat),
  };
}

/**
 * Pad the frame so the shaded countries sit in context rather than filling the edges, and
 * widen it to the target aspect so the projection below never stretches the geometry.
 */
export function frameFor(bounds: BBox | null, aspect: number): BBox {
  const b = bounds ?? AFRICA;
  // Enough margin that the shaded countries sit among their neighbours, not so much that
  // they shrink into specks — at 35% the first render put Cameroon at about a centimetre.
  const padLon = Math.max(8, (b.maxLon - b.minLon) * 0.22);
  const padLat = Math.max(8, (b.maxLat - b.minLat) * 0.22);
  let minLon = b.minLon - padLon, maxLon = b.maxLon + padLon;
  let minLat = b.minLat - padLat, maxLat = b.maxLat + padLat;

  // Match the viewport's aspect by growing the short axis, never by cropping the long one.
  const wantW = (maxLat - minLat) * aspect;
  if (maxLon - minLon < wantW) {
    const grow = (wantW - (maxLon - minLon)) / 2;
    minLon -= grow; maxLon += grow;
  } else {
    const wantH = (maxLon - minLon) / aspect;
    const grow = (wantH - (maxLat - minLat)) / 2;
    minLat -= grow; maxLat += grow;
  }

  return {
    minLon: Math.max(-180, minLon), maxLon: Math.min(180, maxLon),
    minLat: Math.max(-85, minLat),  maxLat: Math.min(85, maxLat),
  };
}

export function intersects(a: BBox, b: BBox): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

/**
 * Equirectangular, into the SVG's own coordinates.
 *
 * Chosen over Mercator because the frame is one continent near the equator, where the two
 * are nearly identical — and because Mercator's area distortion is a poor thing to put
 * under a chart about how much work is happening in each country.
 */
export function project(lon: number, lat: number, frame: BBox, w: number, h: number): [number, number] {
  return [
    ((lon - frame.minLon) / (frame.maxLon - frame.minLon)) * w,
    ((frame.maxLat - lat) / (frame.maxLat - frame.minLat)) * h,
  ];
}

/** One SVG `d` for every ring of a country. Rounded to 1dp — the geometry is 1:110m. */
export function pathFor(polygons: Poly[], frame: BBox, w: number, h: number): string {
  const out: string[] = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      let d = '';
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = project(ring[i][0], ring[i][1], frame, w, h);
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      out.push(`${d}Z`);
    }
  }
  return out.join('');
}

/**
 * How strongly to shade a country: its share of the busiest country's count, floored so
 * that "one project" is still clearly distinguishable from "no projects".
 */
export function intensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return 0.35 + 0.65 * (count / max);
}
