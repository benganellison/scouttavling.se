-- Backfill (expand step, re-runnable): every existing competition becomes an edition of a series.
-- "GökOpen 2027" -> series "GökOpen" (slug gokopen), edition_year 2027. Competitions with the same
-- year-stripped name and owner share one series. Branding is COPIED to the series (the edition keeps
-- its own values, so the previous app version, which only reads competition-level branding, is unchanged).
-- A later contract migration may clear edition values that equal the series' (docs/architecture/05).
DO $$
DECLARE
	c record;
	base text;
	s text;
	cand text;
	yr int;
	sid uuid;
	n int;
BEGIN
	-- Newest first, so the latest edition's branding wins on the series.
	FOR c IN SELECT * FROM competition WHERE series_id IS NULL ORDER BY start_date DESC, created_at DESC LOOP
		yr := substring(c.name from '\m((?:19|20)[0-9]{2})\M')::int;
		base := nullif(btrim(regexp_replace(regexp_replace(c.name, '\m(19|20)[0-9]{2}\M', '', 'g'), '\s+', ' ', 'g')), '');
		base := coalesce(base, c.name);
		SELECT id INTO sid FROM series
			WHERE lower(name) = lower(base) AND owner_group_no IS NOT DISTINCT FROM c.owner_group_no
			LIMIT 1;
		IF sid IS NULL THEN
			s := btrim(regexp_replace(translate(lower(base), 'åäöéèëüæøáà', 'aaoeeeuaoaa'), '[^a-z0-9]+', '-', 'g'), '-');
			IF s = '' THEN s := 'serie'; END IF;
			cand := s;
			n := 1;
			WHILE EXISTS (SELECT 1 FROM series WHERE slug = cand) OR EXISTS (SELECT 1 FROM competition WHERE slug = cand) LOOP
				n := n + 1;
				cand := s || '-serie' || CASE WHEN n > 2 THEN '-' || n ELSE '' END;
			END LOOP;
			INSERT INTO series (slug, name, owner_group_no, owner_group_name, created_by, created_at)
				VALUES (cand, base, c.owner_group_no, c.owner_group_name, c.created_by, c.created_at)
				RETURNING id INTO sid;
		END IF;
		UPDATE competition SET series_id = sid, edition_year = coalesce(edition_year, yr, extract(year FROM c.start_date)::int)
			WHERE id = c.id;
		-- Branding: the first (newest) edition with a value wins.
		UPDATE series SET
			accent_color = coalesce(accent_color, c.accent_color),
			cover_fit = coalesce(cover_fit, c.cover_fit),
			class_colors = coalesce((
				SELECT jsonb_object_agg(t.name, t.color) FROM track t WHERE t.competition_id = c.id AND t.color IS NOT NULL
			), '{}'::jsonb) || class_colors
			WHERE id = sid;
		INSERT INTO asset (series_id, kind, mime, size, width, height, sha256, data, uploaded_by, created_at)
			SELECT sid, a.kind, a.mime, a.size, a.width, a.height, a.sha256, a.data, a.uploaded_by, a.created_at
			FROM asset a WHERE a.competition_id = c.id
			ON CONFLICT (series_id, kind) DO NOTHING;
	END LOOP;
END $$;
