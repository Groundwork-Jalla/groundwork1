-- Private contact table: email only, never exposed to anon SELECT.
CREATE TABLE public.waitlist_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.waitlist_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join the waitlist"
  ON public.waitlist_emails FOR INSERT
  WITH CHECK (true);

-- Public-safe table: name + location only, used for the live social-proof feed.
CREATE TABLE public.waitlist_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.waitlist_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join the waitlist (public record)"
  ON public.waitlist_members FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can view waitlist members"
  ON public.waitlist_members FOR SELECT
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.waitlist_members;
