-- audit_log is append-only: no UPDATE, DELETE or TRUNCATE, whoever asks (docs/architecture/04 §10).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
-- Series owners/organisers start as the owners/organisers of the series' editions (the previous
-- rule, docs/architecture/05 §1). Owner wins when a user is both. Re-runnable.
INSERT INTO series_member (series_id, user_id, role)
SELECT c.series_id, m.user_id, CASE WHEN bool_or(m.role = 'owner') THEN 'owner'::competition_role ELSE 'organiser'::competition_role END
FROM competition_member m JOIN competition c ON c.id = m.competition_id
WHERE c.series_id IS NOT NULL AND m.role IN ('owner', 'organiser')
GROUP BY c.series_id, m.user_id
ON CONFLICT DO NOTHING;
