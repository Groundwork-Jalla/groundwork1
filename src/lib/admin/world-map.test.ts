import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AFRICA, ISO_A2_TO_NUMERIC, boundsOf, frameFor, intensity, intersects, mergeBounds,
  pathFor, project, ringsOf, type Poly,
} from './world-map';
import { COUNTRIES } from '@/lib/countries';

/**
 * The map shades a country because our rows say so. This is what stops it shading the
 * WRONG one: the alpha-2 → numeric table is checked against Natural Earth's own country
 * names, so a transposed digit fails here rather than quietly colouring in Chad.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
type Geo = { id?: string | number; properties?: { name?: string } };
const topo = JSON.parse(
  readFileSync(resolve(ROOT, 'node_modules/world-atlas/countries-110m.json'), 'utf8'),
) as { objects: { countries: { geometries: Geo[] } } };

const NE_NAME = new Map<number, string>(
  topo.objects.countries.geometries.map(g => [Number(g.id), g.properties?.name ?? '']),
);

/** Natural Earth's own spelling, where it differs from ours. Both name the same state. */
const ALIAS: Record<string, string> = {
  'DR Congo': 'Dem. Rep. Congo',
};

describe('the ISO table names the country it claims to', () => {
  for (const country of COUNTRIES) {
    it(`${country.code} is ${country.name}`, () => {
      const numeric = ISO_A2_TO_NUMERIC[country.code];
      expect(numeric, `${country.code} has no numeric code`).toBeDefined();
      const ne = NE_NAME.get(numeric);
      expect(ne, `no Natural Earth geometry for ${numeric}`).toBeDefined();
      expect(ne).toBe(ALIAS[country.name] ?? country.name);
    });
  }

  it('carries no code the app cannot offer, so the table cannot drift', () => {
    const offered = new Set(COUNTRIES.map(c => c.code));
    expect(Object.keys(ISO_A2_TO_NUMERIC).filter(c => !offered.has(c))).toEqual([]);
  });

  it('reads the real Natural Earth file, not an empty one', () => {
    expect(topo.objects.countries.geometries.length).toBeGreaterThan(150);
    expect(NE_NAME.get(120)).toBe('Cameroon');
  });
});

describe('the projection puts a coordinate where it belongs', () => {
  const frame = { minLon: -20, maxLon: 20, minLat: -20, maxLat: 20 };

  it('maps the frame corners to the viewport corners', () => {
    expect(project(-20, 20, frame, 100, 100)).toEqual([0, 0]);
    expect(project(20, -20, frame, 100, 100)).toEqual([100, 100]);
  });

  it('puts north at the top — latitude increases as y decreases', () => {
    const [, yNorth] = project(0, 10, frame, 100, 100);
    const [, ySouth] = project(0, -10, frame, 100, 100);
    expect(yNorth).toBeLessThan(ySouth);
  });

  it('places the centre of the frame at the centre of the viewport', () => {
    expect(project(0, 0, frame, 100, 100)).toEqual([50, 50]);
  });
});

describe('the frame', () => {
  it('falls back to Africa when nothing is plottable', () => {
    const f = frameFor(null, 1.6);
    expect(f.minLon).toBeLessThan(AFRICA.minLon + 1);
    expect(f.maxLat).toBeGreaterThan(30);
  });

  it('pads around the data rather than cropping it', () => {
    const data = { minLon: 8, maxLon: 16, minLat: 2, maxLat: 13 };
    const f = frameFor(data, 1.6);
    expect(f.minLon).toBeLessThan(data.minLon);
    expect(f.maxLon).toBeGreaterThan(data.maxLon);
    expect(f.minLat).toBeLessThan(data.minLat);
    expect(f.maxLat).toBeGreaterThan(data.maxLat);
  });

  it('never leaves the world', () => {
    const f = frameFor({ minLon: -179, maxLon: 179, minLat: -84, maxLat: 84 }, 1.6);
    expect(f.minLon).toBeGreaterThanOrEqual(-180);
    expect(f.maxLon).toBeLessThanOrEqual(180);
    expect(f.minLat).toBeGreaterThanOrEqual(-85);
    expect(f.maxLat).toBeLessThanOrEqual(85);
  });
});

describe('geometry helpers', () => {
  const square: Poly = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];

  it('reads both Polygon and MultiPolygon', () => {
    expect(ringsOf({ type: 'Polygon', coordinates: square })).toHaveLength(1);
    expect(ringsOf({ type: 'MultiPolygon', coordinates: [square, square] })).toHaveLength(2);
    expect(ringsOf({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });

  it('bounds a shape and merges two', () => {
    expect(boundsOf([square])).toEqual({ minLon: 0, maxLon: 10, minLat: 0, maxLat: 10 });
    expect(mergeBounds(boundsOf([square]), { minLon: -5, maxLon: 2, minLat: 4, maxLat: 20 }))
      .toEqual({ minLon: -5, maxLon: 10, minLat: 0, maxLat: 20 });
    expect(mergeBounds(null, boundsOf([square]))).toEqual(boundsOf([square]));
  });

  it('closes every ring it draws, and drops a degenerate one', () => {
    const d = pathFor([square], { minLon: 0, maxLon: 10, minLat: 0, maxLat: 10 }, 100, 100);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(pathFor([[[[0, 0], [1, 1]]]], AFRICA, 10, 10)).toBe('');
  });

  it('knows what is on screen', () => {
    expect(intersects({ minLon: 0, maxLon: 5, minLat: 0, maxLat: 5 }, AFRICA)).toBe(true);
    expect(intersects({ minLon: 170, maxLon: 179, minLat: -20, maxLat: -15 }, AFRICA)).toBe(false);
  });
});

describe('shading', () => {
  it('is nothing at all when there are no projects', () => {
    expect(intensity(0, 18)).toBe(0);
    expect(intensity(3, 0)).toBe(0);
  });

  it('keeps one project visible and gives the busiest country full weight', () => {
    expect(intensity(1, 18)).toBeGreaterThan(0.3);
    expect(intensity(18, 18)).toBe(1);
    expect(intensity(2, 18)).toBeGreaterThan(intensity(1, 18));
  });
});
