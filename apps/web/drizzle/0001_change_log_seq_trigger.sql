-- change_log.seq: per-competition, commit-ordered sequence.
-- The upsert takes a row lock on change_seq that is held until the writing
-- transaction commits, so writers in the same competition are serialised and
-- seq values become visible in increasing order (SSE cursors never skip a row).
CREATE OR REPLACE FUNCTION change_log_assign_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO change_seq AS c (competition_id, last) VALUES (NEW.competition_id, 1)
	ON CONFLICT (competition_id) DO UPDATE SET last = c.last + 1
	RETURNING c.last INTO NEW.seq;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS change_log_assign_seq ON change_log;
--> statement-breakpoint
CREATE TRIGGER change_log_assign_seq BEFORE INSERT ON change_log
	FOR EACH ROW EXECUTE FUNCTION change_log_assign_seq();
