-- Wave 3: Switch default follow-up / support email address from
-- `contact@tryjalla.com` to `support@tryjalla.com` (per Philip's instruction).
-- Safe & idempotent: updates the table default and migrates any row still using
-- `contact@tryjalla.com` without overwriting custom addresses.
BEGIN;

ALTER TABLE public.communication_settings
  ALTER COLUMN followup_sender_email SET DEFAULT 'support@tryjalla.com';

UPDATE public.communication_settings
SET followup_sender_email = 'support@tryjalla.com',
    updated_at = now()
WHERE lower(btrim(followup_sender_email)) = 'contact@tryjalla.com';

NOTIFY pgrst, 'reload schema';

COMMIT;
