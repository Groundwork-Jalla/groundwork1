-- Weekly reporting: a financing client is not an observer, and a contractor
-- assignment must exist. Keep the existing qualification and ground-update rules.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS project_primary_client_join_once
 ON public.project_audit_log(project_id,actor_id) WHERE action='project.client_joined';

CREATE OR REPLACE FUNCTION public.record_primary_client_join(p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
 PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
 IF NOT FOUND OR NOT public.is_project_client(p_project) OR public.is_primary_project_contractor(p_project) THEN
   RAISE EXCEPTION 'not_project_client';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.project_audit_log WHERE project_id=p_project AND actor_id=auth.uid() AND action='project.client_joined') THEN
   PERFORM public.log_activity(p_project,'project.client_joined',NULL,NULL,auth.uid(),jsonb_build_object('source','project_open'));
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_primary_client_join(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_primary_client_join(uuid) TO authenticated;

-- Preserve existing column names/order. Managers continue to read through RLS.
CREATE OR REPLACE VIEW public.project_business_statuses WITH(security_invoker=true) AS
SELECT p.id AS project_id,p.user_id,p.created_at,p.target_start,
 d.has_boq,
 coalesce(p.target_start IS NOT NULL AND p.target_start>=p.created_at::date
   AND p.target_start<=p.created_at::date+60,false) AS starts_soon,
 v.client_joined,s.has_ground_updates,
 CASE WHEN d.has_boq AND p.target_start>=p.created_at::date AND p.target_start<=p.created_at::date+60
   AND c.contractor_user_id IS NOT NULL AND v.client_joined AND s.has_ground_updates THEN 'verified'
  WHEN d.has_boq AND p.target_start>=p.created_at::date AND p.target_start<=p.created_at::date+60 THEN 'qualified'
  ELSE 'general' END AS business_status,
 c.contractor_user_id IS NOT NULL AS has_contractor
FROM public.projects p
LEFT JOIN LATERAL(
 SELECT ci.contractor_user_id FROM public.contractor_invites ci WHERE ci.project_id=p.id
   AND ci.status='accepted' AND ci.is_primary AND ci.contractor_user_id IS NOT NULL LIMIT 1
) c ON true
CROSS JOIN LATERAL(
 SELECT EXISTS(SELECT 1 FROM public.project_documents doc WHERE doc.project_id=p.id AND doc.category='boq') AS has_boq
) d
CROSS JOIN LATERAL(
 SELECT EXISTS(SELECT 1 FROM public.project_viewers client WHERE client.project_id=p.id AND client.is_client
   AND client.accepted_at IS NOT NULL AND client.revoked_at IS NULL AND client.user_id IS NOT NULL
   AND client.user_id IS DISTINCT FROM c.contractor_user_id)
 OR (
   p.workflow_origin='client' AND p.user_id IS DISTINCT FROM c.contractor_user_id
   AND NOT EXISTS(SELECT 1 FROM public.contractor_invites own_work WHERE own_work.project_id=p.id
     AND own_work.contractor_user_id=p.user_id AND own_work.status='accepted')
   AND NOT EXISTS(SELECT 1 FROM public.project_viewers named WHERE named.project_id=p.id AND named.is_client AND named.revoked_at IS NULL)
   -- The server stamps created_by when somebody creates a project for its owner.
   -- A self-created client project is already joined. Provisioned owners count
   -- after opening their project; they need not approve work or submit a payment.
   AND (p.created_by IS NULL OR EXISTS(SELECT 1 FROM public.project_audit_log activity
     WHERE activity.project_id=p.id AND activity.actor_id=p.user_id))
 ) AS client_joined
) v
CROSS JOIN LATERAL(
 SELECT EXISTS(SELECT 1 FROM public.site_updates ground WHERE ground.project_id=p.id) AS has_ground_updates
) s;
REVOKE ALL ON public.project_business_statuses FROM PUBLIC,anon;
GRANT SELECT ON public.project_business_statuses TO authenticated;

-- A single definition now serves both individual reads and bulk dashboard counts.
CREATE OR REPLACE FUNCTION public.project_business_status(p_project uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT business_status FROM public.project_business_statuses WHERE project_id=p_project;
$$;
REVOKE ALL ON FUNCTION public.project_business_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_business_status(uuid) TO authenticated;
COMMENT ON VIEW public.project_business_statuses IS
 'general | qualified | verified. Verified retains BOQ, 60-day start and ground-update requirements and needs an accepted primary contractor plus a joined primary client. Observer/family acceptance is insufficient. Client approvals/payments/messages are not required.';

NOTIFY pgrst,'reload schema';
COMMIT;
