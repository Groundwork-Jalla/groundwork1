-- =========================================================
-- Home 2: the project the rule was demonstrated on, missed by the first backfill.
--
-- Runs after 20261111000000_a_bill_is_the_whole_project.sql, which carries the reasoning
-- and the rule. This file adds one project to it and changes nothing else.
--
-- ── WHY IT WAS MISSED ──────────────────────────────────────────────────────────────
--
-- The first backfill listed only the bills that had been re-read and found to be an
-- unambiguous grand total. Home 2 (created 10 Nov 2026, 17:36, joined at stage 5) was
-- set up on the call to show the fault, after that reading was done, so it was never on
-- the list. It is the project in the screenshots: value 54,042,849 against a bill of
-- 59,675,280, and Site Preparation and Foundation reading 0 XAF.
--
-- Re-read on 11 Nov: "BOQ Sample.xlsx", SUMMARY block, "TOTAL 59675280", grand
-- confidence — the same bill as Brian Home. As it stands in production: budget_usd
-- 101,937.32 (the bill at the live rate of the day), fees 9,842.29 charged, two built
-- stages zeroed, stages summing to 92,315.76 against the budget.
--
-- The same four corrections as the first migration, with the same guard and the same
-- exception for money the client actually paid through Groundwork.
-- =========================================================

BEGIN;

CREATE TEMP TABLE confirmed_bill (
  project_id  uuid PRIMARY KEY,
  bill_local  numeric NOT NULL,
  fx_rate     numeric NOT NULL,
  evidence    text    NOT NULL
) ON COMMIT DROP;

INSERT INTO confirmed_bill (project_id, bill_local, fx_rate, evidence) VALUES
  ('d8be43a7-ffd4-4f57-851b-c709a9f11499', 59675280, 600, 'TOTAL 59675280');

DELETE FROM confirmed_bill c
 WHERE NOT EXISTS (SELECT 1 FROM public.project_documents d
                    WHERE d.project_id = c.project_id AND d.category = 'boq');

UPDATE public.projects p
   SET budget_usd = round(c.bill_local / c.fx_rate, 2)
  FROM confirmed_bill c
 WHERE p.id = c.project_id;

UPDATE public.project_fees f
   SET amount_usd = 0
  FROM confirmed_bill c
 WHERE f.project_id = c.project_id
   AND f.amount_usd <> 0;

UPDATE public.project_stages s
   SET payment_milestone_usd = round(p.budget_usd * s.budget_pct / 100.0, 2),
       fixed_amount_usd      = CASE WHEN COALESCE(s.fixed_amount_usd, 0) <> 0
                                    THEN 0 ELSE s.fixed_amount_usd END
  FROM public.projects p
  JOIN confirmed_bill c ON c.project_id = p.id
 WHERE s.project_id = p.id
   AND NOT (COALESCE(s.payment_status, 'unpaid') = 'paid'
            AND COALESCE(s.pre_existing, false) = false);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id, p.name, p.budget_usd,
           (SELECT COALESCE(sum(payment_milestone_usd), 0) FROM public.project_stages s
             WHERE s.project_id = p.id) AS all_stages,
           (SELECT COALESCE(sum(payment_milestone_usd), 0) FROM public.project_stages s
             WHERE s.project_id = p.id AND s.status = 'complete') AS completed,
           (SELECT COALESCE(sum(payment_milestone_usd), 0) FROM public.project_stages s
             WHERE s.project_id = p.id AND s.status <> 'complete') AS still_to_come
      FROM public.projects p JOIN confirmed_bill c ON c.project_id = p.id
  LOOP
    RAISE NOTICE '% : total % | stages sum % | completed % | still to come %',
      r.name, r.budget_usd, r.all_stages, r.completed, r.still_to_come;
    PERFORM public.log_activity(r.id, 'project.repriced_from_bill', 'project', r.id, NULL,
      jsonb_build_object('budget_usd', r.budget_usd, 'completed_usd', r.completed,
                         'still_to_come_usd', r.still_to_come));
  END LOOP;
END $$;

COMMIT;
