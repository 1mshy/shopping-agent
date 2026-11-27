-- Coverage belongs to the immutable decision, even while delivery is pending.
CREATE TABLE restock_coverage (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE RESTRICT,
  event_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  through_observation_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('decision', 'legacy')),
  FOREIGN KEY (event_id, profile_id) REFERENCES notification_event(id, profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (through_observation_id, listing_id) REFERENCES price_observation(id, listing_id) ON DELETE RESTRICT,
  UNIQUE (event_id, listing_id)
) STRICT;
CREATE INDEX restock_coverage_observation_idx ON restock_coverage(through_observation_id);

-- Historical decisions did not identify the transitions they covered. Retain their time
-- watermark for observations already in the database, once, at upgrade. Never apply that time
-- to a read inserted later. Mark these inferred bounds separately from actual decision evidence.
WITH old_events AS (
  SELECT e.id, e.profile_id, e.watch_id, e.listing_id,
    max(e.created_at, o.observed_at) AS decided_at
  FROM notification_event e JOIN price_observation o ON o.id = e.observation_id
  WHERE e.kind = 'restock'
), bounds AS (
  SELECT watch_id, max(id) AS event_id, max(decided_at) AS cutoff
  FROM old_events GROUP BY watch_id
), members AS (
  SELECT watch_id, listing_id FROM watch_listing
  UNION SELECT watch_id, listing_id FROM old_events
)
INSERT INTO restock_coverage(profile_id, event_id, listing_id, through_observation_id, source)
SELECT e.profile_id, b.event_id, m.listing_id, max(o.id), 'legacy'
FROM bounds b JOIN old_events e ON e.id = b.event_id
JOIN members m ON m.watch_id = b.watch_id
JOIN price_observation o ON o.listing_id = m.listing_id AND o.observed_at <= b.cutoff
GROUP BY b.event_id, m.listing_id;

CREATE TRIGGER restock_coverage_append_only BEFORE UPDATE ON restock_coverage
BEGIN SELECT RAISE(ABORT, 'restock coverage is immutable'); END;
CREATE TRIGGER restock_coverage_kept BEFORE DELETE ON restock_coverage
BEGIN SELECT RAISE(ABORT, 'restock coverage is immutable'); END;
CREATE TRIGGER restock_coverage_no_replace BEFORE INSERT ON restock_coverage
WHEN EXISTS (SELECT 1 FROM restock_coverage
  WHERE id = NEW.id OR (event_id = NEW.event_id AND listing_id = NEW.listing_id))
BEGIN SELECT RAISE(ABORT, 'restock coverage is never replaced'); END;
