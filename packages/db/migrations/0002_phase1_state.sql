-- 0002_phase1_state: the state the Phase 1 units persist (plan, Phase 1): per-host pacing, the
-- scheduler, watches and sweeps, the store directory and trust, owner auth, channels.
-- Hand-written in the conventions of 0001_initial.sql (its header); once released, this file never
-- changes.
--
-- How the tables of 0001 change, without a table rebuild:
-- * Only ALTER TABLE … ADD COLUMN, so every column added to them is nullable: a NOT NULL column
--   needs a default, and no column has one. NULL in such a column is a value the column states
--   (paused_at: not paused) or, on a row written before 0002, "not recorded". Writers always set
--   them; for a watch the database refuses an insert that does not (trigger watch_intake_complete,
--   S§2.9).
-- * ALTER TABLE adds column definitions only, but SQLite treats a column CHECK as a table CHECK: it
--   may name other columns of the row, and it is tested against every existing row when the column
--   is added. A rule over several new columns is attached to the last of them; the one rule over
--   existing columns (job_run_ended_when_finished) rides on the first new column of its table.
-- * State that is not a field of an existing record gets its own table. So does state whose columns
--   would stop a row parsing as its strict contract: a listing row is a `Listing`, a delivery row a
--   `Delivery` (packages/shared), so per-listing scheduling is `listing_check` and the outbox needs
--   no column.
-- * ON DELETE CASCADE only for a part of its parent (listing_check of its listing); RESTRICT
--   everywhere else, every profile_id included.

-- S§5.1 Pacing: the earliest instant the next request to a host may start (the last start plus the
-- jittered 2.5 s, or later after a Retry-After), shared by every rung and kept across restarts.
-- "One request in flight per host" is in-process state and is not stored.
CREATE TABLE host_pacing (
  host TEXT NOT NULL PRIMARY KEY,
  next_start_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', next_start_at) IS next_start_at),
  CONSTRAINT host_pacing_host_lower CHECK (host <> '' AND host = lower(host))
) STRICT;

-- S§4.1 store health fields: how reads at the storefront went. consecutive_errors is null only on
-- a store written before 0002 (a new store starts at 0); last_error is a READ_FAILURE_CAUSES value
-- (packages/shared vocab.ts), set with its time.
ALTER TABLE store ADD COLUMN consecutive_errors INTEGER CHECK (
  consecutive_errors IS NULL OR consecutive_errors >= 0
);
ALTER TABLE store ADD COLUMN last_ok_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', last_ok_at) IS last_ok_at
);
ALTER TABLE store ADD COLUMN last_error_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', last_error_at) IS last_error_at
);
ALTER TABLE store ADD COLUMN last_error TEXT CONSTRAINT store_health CHECK (
  (last_error IS NULL) = (last_error_at IS NULL)
  AND (last_error IS NULL OR last_error <> '')
  AND (consecutive_errors IS NULL OR consecutive_errors = 0 OR last_error_at IS NOT NULL)
);

-- S§5.5 store trust: RDAP registration dates (rdap.org), cached forever, by registrable domain
-- (tldts). A row whose registered_at is null records that RDAP gave no registration date (no record
-- for the domain, or no registration event in it), so it is not asked again; a transient failure
-- (rate limit, network) writes no row.
CREATE TABLE domain_registration (
  domain TEXT NOT NULL PRIMARY KEY,
  registered_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', registered_at) IS registered_at),
  fetched_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', fetched_at) IS fetched_at),
  CONSTRAINT domain_registration_domain_lower CHECK (domain <> '' AND domain = lower(domain)),
  CONSTRAINT domain_registration_order CHECK (registered_at IS NULL OR registered_at <= fetched_at)
) STRICT;

-- S§5.8 per-listing scheduling, and the read state a failed read leaves behind (it writes no
-- observation, S§2.10). Catalogue data: one listing is read once for every watch that follows it.
-- next_check_at is null while no active watch tracks the listing. first_error_at and last_error
-- (READ_FAILURE_CAUSES) describe the current run of failed reads and move with
-- listing.consecutive_errors: set by the first failed read, cleared by an observed one. "3+
-- consecutive errors over a day" is consecutive_errors >= 3 and first_error_at a day old.
CREATE TABLE listing_check (
  listing_id INTEGER NOT NULL PRIMARY KEY REFERENCES listing (id) ON DELETE CASCADE,
  next_check_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', next_check_at) IS next_check_at),
  last_read_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', last_read_at) IS last_read_at),
  first_error_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', first_error_at) IS first_error_at),
  last_error TEXT,
  CONSTRAINT listing_check_errors CHECK (
    (first_error_at IS NULL) = (last_error IS NULL)
    AND (last_error IS NULL OR last_error <> '')
    AND (first_error_at IS NULL OR (last_read_at IS NOT NULL AND first_error_at <= last_read_at))
  )
) STRICT;

-- Listings due now (the sweep).
CREATE INDEX listing_check_due_idx ON listing_check (next_check_at) WHERE next_check_at IS NOT NULL;

-- S§4.2 watch lifecycle. Its status is derived, as a listing's is: archived when archived_at is
-- set, else paused when paused_at is set, else active. A watch that alerted cannot be deleted
-- (RESTRICT keeps its audit trail), so deleting it in the UI archives it.
ALTER TABLE watch ADD COLUMN paused_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', paused_at) IS paused_at
);
ALTER TABLE watch ADD COLUMN archived_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', archived_at) IS archived_at
);
-- The intake dedupe key: `url:` and the normalised link, or `query:` and the case-folded name.
ALTER TABLE watch ADD COLUMN dedupe_key TEXT CHECK (dedupe_key IS NULL OR dedupe_key <> '');
-- When the restock rule was last switched on; null while it is off. The restock watermark is the
-- later of this and the watch's last accepted restock alert, read from the outbox (S§2.11).
ALTER TABLE watch ADD COLUMN restock_enabled_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', restock_enabled_at) IS restock_enabled_at
);
-- Save first (S§2.9): the lookup that turns what the user typed into listings (the first read of a
-- link, a directory search for a name), and the watch's re-discovery (at most daily, S§5.3, S§5.8),
-- as durable work. lookup_state is a WATCH_LOOKUP_STATES value; a queued lookup is due at
-- lookup_due_at; lookup_queued_at is when the current or last lookup was queued (intake or a
-- re-discovery), which "at most daily" reads; lookup_error says why the last attempt failed.
ALTER TABLE watch ADD COLUMN lookup_state TEXT;
ALTER TABLE watch ADD COLUMN lookup_queued_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', lookup_queued_at) IS lookup_queued_at
);
ALTER TABLE watch ADD COLUMN lookup_due_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', lookup_due_at) IS lookup_due_at
);
ALTER TABLE watch ADD COLUMN lookup_attempts INTEGER CHECK (
  lookup_attempts IS NULL OR lookup_attempts >= 0
);
ALTER TABLE watch ADD COLUMN lookup_error TEXT CONSTRAINT watch_lookup CHECK (
  (lookup_state IS NULL) = (lookup_queued_at IS NULL)
  AND (lookup_state IS NULL) = (lookup_attempts IS NULL)
  AND (lookup_state IS 'queued') = (lookup_due_at IS NOT NULL)
  AND (lookup_error IS NULL OR (lookup_error <> '' AND lookup_state IS NOT NULL))
  AND (lookup_state IS NOT 'failed' OR lookup_error IS NOT NULL)
);

-- One watch per dedupe key and profile among the watches not archived (a paused one counts).
CREATE UNIQUE INDEX watch_dedupe_key_idx ON watch (profile_id, dedupe_key) WHERE archived_at IS NULL;
-- Lookups due now (the intake worker).
CREATE INDEX watch_lookup_due_idx ON watch (lookup_due_at) WHERE lookup_due_at IS NOT NULL;

-- A watch written from 0002 on has its dedupe key and its lookup state (S§2.9: a request saved
-- without its durable lookup would never be researched). Rows written before 0002 keep their nulls.
CREATE TRIGGER watch_intake_complete BEFORE INSERT ON watch
WHEN NEW.dedupe_key IS NULL OR NEW.lookup_state IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a new watch has its dedupe key and lookup state (S§2.9)');
END;

-- S§5.8 Scheduler. job.cron is the cadence, in croner syntax (S§3.3 names croner for next-run
-- times), and next_run_at the earliest slot not yet run; a catch-up coalesces the cron's slots from
-- next_run_at to now. retry_at is the one pending one-off retry (DNS gate, failed run): a newer one
-- replaces it, a run that stands for it clears it, and it never moves the cadence.
ALTER TABLE job ADD COLUMN retry_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', retry_at) IS retry_at
);

-- job_run: why the run started (JOB_RUN_REASONS: slot, boot, caller, retry), how many slots of the
-- cadence it stands for, and what Diagnostics shows (an error, counts, what the partial results
-- hold). A run is open exactly while it is running; its open row is the job's overlap lock.
ALTER TABLE job_run ADD COLUMN reason TEXT CONSTRAINT job_run_ended_when_finished CHECK (
  (status = 'running') = (ended_at IS NULL)
);
ALTER TABLE job_run ADD COLUMN coalesced_slots INTEGER CONSTRAINT job_run_reason CHECK (
  (reason IS NULL) = (coalesced_slots IS NULL) AND (coalesced_slots IS NULL OR coalesced_slots >= 0)
);
ALTER TABLE job_run ADD COLUMN detail_json TEXT CHECK (
  detail_json IS NULL OR (json_valid(detail_json) AND json_type(detail_json) = 'object')
);

-- The overlap lock: at most one open run per job. Starting a run inserts its row, which is refused
-- while another run of the job is open (a second caller joins that one instead); ending it sets
-- ended_at. Only the server runs the scheduler, so a run still open at boot belonged to a process
-- that died: boot ends it (timed_out when its deadline has passed, failed otherwise) before the
-- catch-up.
CREATE UNIQUE INDEX job_run_open_idx ON job_run (job_id) WHERE ended_at IS NULL;

-- The last accepted alert of a watch is read from the outbox, never stamped on the watch: the
-- watch's events of one kind, newest first, and their deliveries' accepted_at (S§2.11), with the
-- price from the observation the event names. This index serves that walk and replaces 0001's
-- index on watch_id alone, which it covers as a foreign-key child index.
DROP INDEX notification_event_watch_idx;
CREATE INDEX notification_event_watch_kind_idx ON notification_event (watch_id, kind, created_at);

-- S§5.11 channels: a name to show; switched off while disabled_at is set; removed while removed_at
-- is set (a channel with deliveries is never deleted: they keep accepted_at, S§2.11). name and
-- created_at are null only on a channel written before 0002.
ALTER TABLE channel ADD COLUMN name TEXT CHECK (name IS NULL OR name <> '');
ALTER TABLE channel ADD COLUMN created_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at
);
ALTER TABLE channel ADD COLUMN disabled_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', disabled_at) IS disabled_at
);
ALTER TABLE channel ADD COLUMN removed_at TEXT CHECK (
  strftime('%Y-%m-%dT%H:%M:%fZ', removed_at) IS removed_at
);

-- S§5.13 owner auth. The password is kept as a PHC string from crypto.argon2
-- ($argon2id$v=19$m=…,t=…,p=…$salt$hash, so the parameters and salt travel with the hash), one per
-- profile, and outside `setting`, so no settings route can read it.
CREATE TABLE owner_password (
  profile_id INTEGER NOT NULL PRIMARY KEY REFERENCES profile (id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  set_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', set_at) IS set_at),
  CONSTRAINT owner_password_phc CHECK (password_hash GLOB '$argon2*')
) STRICT;

-- A login session. The cookie carries a random token; only its SHA-256, in lower-case hex, is
-- stored, so a copy of the database opens no session. Logging out deletes the row.
CREATE TABLE session (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profile (id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
  expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS expires_at),
  last_seen_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at) IS last_seen_at),
  CONSTRAINT session_token_hash CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT session_order CHECK (expires_at > created_at AND last_seen_at >= created_at)
) STRICT;
