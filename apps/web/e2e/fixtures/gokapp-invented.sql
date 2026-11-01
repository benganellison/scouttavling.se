-- gokapp's MySQL schema as Hibernate (ddl-auto=update) creates it, with INVENTED data only.
-- Personal columns are filled with "HEMLIG-…" markers: the importer must never read them
-- (gokappImport.db.test.ts checks that no marker reaches scouttavling's database).
CREATE TABLE config (id INT PRIMARY KEY, name VARCHAR(255), allowpublicresult BIT(1), phone VARCHAR(255), use_qr BIT(1) NOT NULL);
CREATE TABLE track (id INT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE users (id INT PRIMARY KEY, username VARCHAR(255), password VARCHAR(255));
CREATE TABLE station (
	id INT PRIMARY KEY, stationnumber INT NOT NULL, stationname VARCHAR(100), alltracks BIT(1),
	minscore INT, maxscore INT, minstylescore INT, maxstylescore INT,
	stationcontact VARCHAR(50), stationphone VARCHAR(50), waypoint BIT(1), usedistinctscores BIT(1), distinctscores VARCHAR(500), user_id INT
);
CREATE TABLE station_track (station_id INT NOT NULL, tracks_id INT NOT NULL, PRIMARY KEY (station_id, tracks_id));
CREATE TABLE patrol (
	patrolid INT PRIMARY KEY, externalid VARCHAR(255), patrolname VARCHAR(120), troop VARCHAR(100), fk_track INT,
	starttime VARCHAR(20), endtime VARCHAR(20), members VARCHAR(500), note VARCHAR(500),
	leadercontact VARCHAR(100), contactmail VARCHAR(250), leadercontactphone VARCHAR(100),
	status VARCHAR(255), date_registered DATETIME(6), paid BIT(1), fk_station INT
);
CREATE TABLE score (
	id INT PRIMARY KEY AUTO_INCREMENT, station_id INT NOT NULL, patrol_id INT NOT NULL, score_point INT NOT NULL,
	style_point INT NOT NULL, visited_waypoint BIT(1) NOT NULL, last_saved DATETIME(6),
	CONSTRAINT uq_score_station_patrol UNIQUE (station_id, patrol_id)
);

INSERT INTO config VALUES (1, 'Påhittade Hajken', b'1', 'HEMLIG-TELEFON', b'1');
INSERT INTO users VALUES (1, 'HEMLIG-ANVÄNDARE', 'HEMLIG-LÖSENORD');
INSERT INTO track VALUES (1, 'Spårare'), (2, 'Upptäckare');
INSERT INTO station VALUES
	(10, 1, 'Eldstaden', b'1', 0, 20, 0, 5, 'HEMLIG-KONTAKT', 'HEMLIG-TELEFON', b'0', b'0', NULL, 1),
	(11, 2, 'Rastplats', b'1', 0, 0, 0, 0, NULL, NULL, b'1', b'0', NULL, NULL),
	(12, 3, 'Nödbrev', b'0', 0, 20, 0, 0, NULL, NULL, b'0', b'1', '0,20', NULL),
	(13, 4, 'Kartan', b'1', 0, 20, 0, 5, NULL, NULL, b'0', b'0', NULL, NULL);
INSERT INTO station_track VALUES (12, 2);
INSERT INTO patrol VALUES
	(101, 'HEMLIG-EXTERN', 'Ekorrarna', 'Påhittsby scoutkår', 1, '09:00', '12:00', 'HEMLIG-MEDLEM Alva, HEMLIG-MEDLEM Bo', 'HEMLIG-ANTECKNING', 'HEMLIG-LEDARE', 'hemlig@example.org', 'HEMLIG-070', 'FINISHED', '2023-04-01 10:00:00', b'1', 10),
	(102, NULL, 'Bävrarna', 'Påhittsby scoutkår', 1, NULL, NULL, 'HEMLIG-MEDLEM Cia', NULL, 'HEMLIG-LEDARE', NULL, NULL, 'FINISHED', '2023-04-02 10:00:00', b'0', 13),
	(201, NULL, 'Falkarna', 'Hittepå scoutkår', 2, NULL, NULL, 'HEMLIG-MEDLEM Dan', NULL, NULL, NULL, NULL, 'FINISHED', NULL, b'1', 10),
	(202, NULL, 'Ugglorna', 'Hittepå scoutkår', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ACTIVE', NULL, b'0', 13),
	(203, NULL, 'Rävarna', 'Hittepå scoutkår', 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'RESIGNED', NULL, b'0', NULL);
INSERT INTO score (station_id, patrol_id, score_point, style_point, visited_waypoint, last_saved) VALUES
	(10, 101, 15, 3, b'0', '2023-05-13 08:00:00'), (11, 101, 0, 0, b'1', '2023-05-13 08:25:00'), (13, 101, 12, 2, b'0', '2023-05-13 08:55:00'),
	(10, 102, 15, 3, b'0', '2023-05-13 08:10:00'), (13, 102, 12, 2, b'0', '2023-05-13 08:45:00'),
	(10, 201, 18, 4, b'0', '2023-05-13 09:00:00'), (12, 201, 20, 0, b'0', '2023-05-13 09:30:00'), (13, 201, 17, 4, b'0', '2023-05-13 10:05:00'),
	(10, 202, 19, 5, b'0', '2023-05-13 09:50:00'), (12, 202, 0, 0, b'0', '2023-05-13 10:20:00');
