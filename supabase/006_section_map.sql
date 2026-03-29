-- Section map center for placing labels on padron subdivisions
ALTER TABLE sections ADD COLUMN IF NOT EXISTS map_center JSONB;
-- stores {"lat": -33.5, "lng": -56.2} for sub-section label placement
