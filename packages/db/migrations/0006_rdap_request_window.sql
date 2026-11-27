-- At most ten wire starts occupy the rolling RDAP window for this installation.
-- Slots contain timing only. No endpoint, domain, contact or response body is stored here.
CREATE TABLE rdap_request_start (
  slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 0 AND 9),
  started_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS started_at)
) STRICT;
