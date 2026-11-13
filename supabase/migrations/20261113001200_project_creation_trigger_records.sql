-- Emergency project-creation repair. Independent of communication migrations.
-- Shared trigger expressions may bind OLD.project_id on a projects row even when
-- that CASE/AND branch is not taken. projects has id, while its child rows have
-- project_id. Read the identifier safely without removing any validation.
-- Existing function definitions, trigger attachments, grants and data are retained.
BEGIN;
DO $repair$
DECLARE f record; v_definition text; v_repaired text;
BEGIN
 FOR f IN
  SELECT DISTINCT p.oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace r ON r.oid=c.relnamespace
  WHERE n.nspname='public' AND r.nspname='public' AND NOT t.tgisinternal
   AND c.relname IN('projects','project_stages','project_fees')
   AND p.prorettype='pg_catalog.trigger'::regtype
   AND p.prosrc ~* '\mOLD[[:space:]]*\.[[:space:]]*project_id\M'
 LOOP
  v_definition:=pg_catalog.pg_get_functiondef(f.oid);
  v_repaired:=regexp_replace(v_definition,
   '\mOLD[[:space:]]*\.[[:space:]]*project_id\M',
   'COALESCE((to_jsonb(OLD)->>''project_id'')::uuid,(to_jsonb(OLD)->>''id'')::uuid)','gi');
  -- Never rewrite an assignment's left-hand side. The shared budget/progression
  -- validators only read this field; other trigger writers keep their assignments.
  IF v_definition !~* '\mNEW[[:space:]]*\.[[:space:]]*project_id[[:space:]]*:=' THEN
   v_repaired:=regexp_replace(v_repaired,
    '\mNEW[[:space:]]*\.[[:space:]]*project_id\M',
    'COALESCE((to_jsonb(NEW)->>''project_id'')::uuid,(to_jsonb(NEW)->>''id'')::uuid)','gi');
  END IF;
  IF v_repaired IS DISTINCT FROM v_definition THEN
   EXECUTE v_repaired;
   RAISE NOTICE 'Repaired project identifier access in %',f.oid::regprocedure;
  END IF;
 END LOOP;
END;
$repair$;
NOTIFY pgrst,'reload schema';
COMMIT;
