-- A reservation row carries no amount yet. The original amount_text check read
-- "amount_text ~ ... AND amount IS NOT NULL AND ...": with both columns NULL the
-- middle term is FALSE, so the whole expression is FALSE rather than NULL and
-- PostgreSQL rejects every reserve_receipt_read insert (23514). Production
-- receipt uploads returned "receipt_verification_unavailable" from the
-- reservation phase. The constraint is anonymous, so it is located by its
-- definition rather than by an assumed generated name.
BEGIN;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.receipt_readings'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%amount_text%' AND pg_get_constraintdef(oid) NOT LIKE '%status%' LOOP
   EXECUTE format('ALTER TABLE public.receipt_readings DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE public.receipt_readings ADD CONSTRAINT receipt_reading_amount_text
 CHECK(amount_text IS NULL OR (amount_text ~ '^[0-9]{1,13}(\.[0-9]{1,6})?$' AND amount IS NOT NULL AND amount_text::numeric=amount));
-- Rows the failed reservations left behind were never created; nothing to repair.
COMMIT;
