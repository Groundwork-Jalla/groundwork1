-- =========================================================
-- Migration 005: user_profiles table + Starter project cap
-- =========================================================

-- ── user_profiles ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name     TEXT,
  phone            TEXT,
  country          TEXT,
  id_document_path TEXT,
  id_verified      BOOLEAN NOT NULL DEFAULT false,
  onboarding_done  BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own profile"
  ON public.user_profiles
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-create profile row on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Starter 3-project cap (database-level enforcement) ────
CREATE OR REPLACE FUNCTION public.check_starter_project_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tier = 'starter' THEN
    IF (
      SELECT COUNT(*)
      FROM public.projects
      WHERE user_id = NEW.user_id
        AND tier = 'starter'
    ) >= 3 THEN
      RAISE EXCEPTION 'Starter plan is limited to 3 projects. Upgrade to Pro for unlimited projects.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_starter_project_limit ON public.projects;
CREATE TRIGGER enforce_starter_project_limit
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.check_starter_project_limit();

-- ── Storage bucket: id-documents (private) ────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('id-documents', 'id-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: users can only access their own folder
CREATE POLICY "Users manage own id documents"
  ON storage.objects
  FOR ALL
  USING  (bucket_id = 'id-documents' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'id-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
