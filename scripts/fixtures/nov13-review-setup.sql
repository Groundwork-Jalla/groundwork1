RESET ROLE;
CREATE TABLE IF NOT EXISTS public.profiles(id uuid PRIMARY KEY,preferred_lang text DEFAULT 'en');
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS preferred_lang text DEFAULT 'en';
INSERT INTO public.profiles(id,preferred_lang) VALUES('00000000-0000-0000-0000-000000000001','en'),('00000000-0000-0000-0000-000000000002','fr') ON CONFLICT(id) DO UPDATE SET preferred_lang=EXCLUDED.preferred_lang;
CREATE TABLE IF NOT EXISTS public.notifications(id uuid DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,data jsonb,created_at timestamptz DEFAULT now());
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_recipient ON public.notifications FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.notifications TO authenticated;
