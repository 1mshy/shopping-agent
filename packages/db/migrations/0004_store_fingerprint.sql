-- Cache versioned fingerprint evidence by origin and market on its storefront. Older rows are uncached.
ALTER TABLE store ADD COLUMN fingerprint_json TEXT
  CHECK (fingerprint_json IS NULL OR (json_valid(fingerprint_json) AND json_type(fingerprint_json) = 'object'));
