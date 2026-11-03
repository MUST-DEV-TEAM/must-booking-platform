-- New hotels default to MIXED: guests may pick a room type only, or a specific room.
ALTER TABLE properties ALTER COLUMN "booking_mode" SET DEFAULT 'MIXED';
