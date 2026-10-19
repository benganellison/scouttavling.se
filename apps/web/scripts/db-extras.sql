-- Database objects drizzle-kit does not manage. Applied by scripts/db-extras.ts
-- after every `npm run db:push`. Must be idempotent.

-- change_log.seq: per-competition, gap-tolerant, commit-ordered sequence.
-- The upsert takes a row lock on change_seq that is held until the writing
-- transaction commits, so two writers in the same competition are serialised
-- and seq values become visible in increasing order (no skipped cursor rows).
create or replace function change_log_assign_seq() returns trigger
language plpgsql as $$
begin
	insert into change_seq as c (competition_id, last) values (new.competition_id, 1)
	on conflict (competition_id) do update set last = c.last + 1
	returning c.last into new.seq;
	return new;
end;
$$;

drop trigger if exists change_log_assign_seq on change_log;
create trigger change_log_assign_seq before insert on change_log
	for each row execute function change_log_assign_seq();
