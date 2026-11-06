import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A notice dies with its project (177).
 *
 * Reported 7 Nov 2026 on `asia@mailinator.com`: the bell says "Your project is now
 * being tracked" twice while My Projects says "0 builds in total". Both were correct.
 * The projects were test rows since deleted; `notifications.data->>'project_id'` is
 * JSON, not a reference, so nothing took the notices with them.
 *
 * Production at the time: 362 notifications, 353 naming a project, 247 naming one that
 * no longer existed — 70%, of which 26 were going to real users rather than staff.
 *
 * The bell is the one surface that means "something happened that concerns you". A
 * notice about a thing that is not there teaches people to stop reading it.
 */

const sql = readFileSync('supabase/migrations/177_a_notice_dies_with_its_project.sql', 'utf8');

describe('the link is a real reference', () => {
  it('project_id cascades on delete', () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public\.projects\(id\) ON DELETE CASCADE/);
  });

  it('and is filled by a trigger, not by every caller', () => {
    /**
     * Notifications are written from at least seven places — 013's two helpers, 074,
     * 076, 097/123, 130. A column each must remember to set is a column most will
     * eventually forget; the trigger reads the id already present in `data` at every
     * one of those call sites.
     */
    expect(sql).toMatch(/CREATE TRIGGER stamp_notification_project\s*\n\s*BEFORE INSERT ON public\.notifications/);
    expect(sql).toMatch(/v_raw\s+text := NEW\.data ->> 'project_id'/);
  });
});

describe('a notice can never cost the thing that raised it', () => {
  it('an id that does not resolve is skipped, not rejected', () => {
    /**
     * The important one. A foreign key refuses an unresolvable id, and several callers
     * are triggers running inside the transaction that does the real work — so without
     * this check a notification about a just-deleted project would abort a stage
     * approval. The notice is still delivered, carrying its JSON as before.
     */
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM public\.projects p WHERE p\.id = v_uuid\) THEN\s*\n\s*NEW\.project_id := v_uuid;/);
  });

  it('and a malformed id does not raise either', () => {
    expect(sql).toMatch(/EXCEPTION WHEN invalid_text_representation THEN\s*\n\s*RETURN NEW;/);
  });
});

describe('the backfill and the cleanup are both narrow', () => {
  it('only well-formed ids are cast, so one bad row cannot take the statement down', () => {
    // This column has only ever held free JSON.
    const guard = /~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'/;
    expect(sql.match(new RegExp(guard, 'g')) ?? []).toHaveLength(2); // backfill + delete
  });

  it('live notices are linked rather than removed', () => {
    const backfill = sql.slice(sql.indexOf('UPDATE public.notifications n'));
    expect(backfill.slice(0, 900)).toMatch(/AND EXISTS \(SELECT 1 FROM public\.projects p/);
  });

  it('and only a notice naming an ABSENT project is deleted', () => {
    // Anything with no project_id in its data is left alone, whatever it is.
    const del = sql.slice(sql.indexOf('DELETE FROM public.notifications n'));
    expect(del).toMatch(/AND NOT EXISTS \(SELECT 1 FROM public\.projects p/);
    expect(del).toMatch(/n\.data ->> 'project_id' IS NOT NULL/);
  });
});
