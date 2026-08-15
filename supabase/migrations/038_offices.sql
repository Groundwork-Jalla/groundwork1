-- =========================================================
-- 038_offices.sql
--
-- Add "home office" as a room type (Phase B1).
--
-- Vanessa's review noted that the wizard's room composition does not match how these
-- houses are actually briefed — a study or work-from-home room is standard in the builds
-- diaspora clients commission, and there was nowhere to say so.
--
-- It is not cosmetic: `countRooms()` drives the internal partition run and the per-room
-- electrical allowance in the take-off (geometry.ts, engine.ts). A five-bedroom house
-- with two offices has more partition wall and more circuits than one without, and until
-- now both priced identically.
--
-- `floor_rooms` is schema-less JSONB so the per-floor breakdown needs no migration; only
-- the flat aggregate column does. It mirrors the four room columns added in 003.
--
-- Existing rows default to 0, which is the truthful answer — nobody was ever asked.
-- No budget is recalculated: `payment_milestone_usd` derives from `budget_usd`, so
-- re-pricing would silently move money already agreed (the rule migration 020 sets out).
--
-- Run in: Supabase Dashboard > SQL Editor (after 037)
-- =========================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS offices INTEGER NOT NULL DEFAULT 0 CHECK (offices >= 0);

COMMENT ON COLUMN public.projects.offices IS
  'Home offices / studies, summed across floors. Mirrors the per-floor `offices` key in '
  'floor_rooms. Added Aug 2026 (migration 038); 0 on every row created before then.';
