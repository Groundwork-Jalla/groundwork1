-- Allow project owners to set the planned completion date during project creation.
ALTER TABLE public.projects
  ADD COLUMN target_end DATE;
