import { describe, expect, it } from 'vitest';
import { boqEditorPaths } from './boq-editor-paths';

describe('BQ authoring workspace navigation', () => {
  it.each([['work', 'money'], ['admin', 'financials']])('keeps %s list, editor and back links in the same workspace', (role, tab) => {
    for (const suffix of ['', '/draft']) {
      expect(boqEditorPaths('project', `/${role}/projects/project/takeoff${suffix}`, role === 'admin')).toEqual({
        list: `/${role}/projects/project/takeoff`, project: `/${role}/projects/project?tab=${tab}`, legacy: false,
      });
    }
  });
  it.each([['work', false], ['admin', true]] as const)('resolves legacy URLs for an authorised %s', (role, admin) => {
    const paths = boqEditorPaths('project', '/projects/project/takeoff/draft', admin);
    expect(paths.legacy).toBe(true);
    expect(paths.list).toBe(`/${role}/projects/project/takeoff`);
  });
  it('encodes route IDs as one path segment', () => {
    expect(boqEditorPaths('id/with spaces', '/work/projects/id/takeoff', false).list).toBe('/work/projects/id%2Fwith%20spaces/takeoff');
  });
});
