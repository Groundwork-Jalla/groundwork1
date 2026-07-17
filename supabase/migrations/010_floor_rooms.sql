-- =========================================================
-- 010_floor_rooms.sql
-- Add per-floor room breakdown column to projects table.
-- Stores a JSONB array of FloorRoom objects:
--   [{ floor: 0, bedrooms, bathrooms, livingRooms, kitchens }, ...]
-- The existing flat columns (bedrooms, bathrooms, etc.) are kept
-- as aggregate totals for fast querying.
-- =========================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS floor_rooms JSONB DEFAULT NULL;
