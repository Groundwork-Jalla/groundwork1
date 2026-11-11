import { describe, expect, it } from 'vitest';
import { projectMedia, mediaFileName } from './project-media';
import type { ProjectDocumentRow, ProjectSubstageRow } from '@/types/project';
import type { SiteUpdate } from '@/lib/supabase/site-updates';

describe('the actual project media catalogue', () => {
  it('never derives updates from completed or historical substages', () => {
    const rows = [{ id: 's1', status: 'complete', evidence_urls: [] }, { id: 's2', status: 'complete', pre_existing: true }] as unknown as ProjectSubstageRow[];
    expect(projectMedia([], [], rows)).toEqual([]);
  });

  it('combines actual uploads and evidence once, retaining the update description and stage', () => {
    const update = { id: 'u1', stageId: 'foundation', description: 'Concrete poured', submittedAt: '2026-11-12', evidencePaths: ['project/pour%20photo.jpg'] } as SiteUpdate;
    const docs = [{ id: 'doc', category: 'site_photo', file_name: 'Plan.jpg', file_path: 'project/plan.jpg', stage_id: null },
      { id: 'bill', category: 'boq', file_name: 'Bill.xlsx', file_path: 'project/bill.xlsx' }] as ProjectDocumentRow[];
    const subs = [{ id: 's1', stage_id: 'foundation', evidence_urls: ['project/pour%20photo.jpg', 'project/check.pdf', ''] }] as ProjectSubstageRow[];
    const media = projectMedia(docs, [update], subs);
    expect(media).toHaveLength(3);
    expect(media[0]).toMatchObject({ name: 'pour photo.jpg', description: 'Concrete poured', stageId: 'foundation', bucket: 'evidence' });
    expect(media.some(row => row.name === 'Bill.xlsx')).toBe(false);
    expect(media.find(row => row.id === 'doc')?.bucket).toBe('documents');
  });

  it('keeps a real text update without inventing a downloadable file', () => {
    const updates = [{ id: 'text', description: 'Wall curing', evidencePaths: [], stageId: 's1' },
      { id: 'blank', description: ' ', evidencePaths: [] }] as unknown as SiteUpdate[];
    expect(projectMedia([], updates, [])).toEqual([expect.objectContaining({ id: 'text', path: null, description: 'Wall curing' })]);
  });

  it('handles malformed and signed filenames without throwing', () => {
    expect(mediaFileName('project/photo%20one.jpg?token=secret')).toBe('photo one.jpg');
    expect(mediaFileName('project/bad%name.jpg')).toBe('bad%name.jpg');
  });
});
