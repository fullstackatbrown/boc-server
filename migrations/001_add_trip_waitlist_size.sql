-- Adds Trip.waitlistSize. NULL means an unlimited waitlist, which is exactly the
-- behaviour every existing trip has today, so no backfill is needed.
ALTER TABLE trips ADD COLUMN waitlist_size INT NULL DEFAULT NULL AFTER max_size;

-- Down:
-- ALTER TABLE trips DROP COLUMN waitlist_size;
