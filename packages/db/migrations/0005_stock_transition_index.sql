-- Seek the latest out and first following in without scanning other availability states.
CREATE INDEX price_observation_stock_time_idx
  ON price_observation (listing_id, availability, observed_at);
