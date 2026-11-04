-- Preserve historical source labels; new staff writes use the current source catalog.
ALTER TABLE venue_reservations DROP CONSTRAINT IF EXISTS venue_reservations_source_check;
ALTER TABLE venue_reservations ADD CONSTRAINT venue_reservations_source_check CHECK (source IN ('staff','word_of_mouth','website','api','phone','walk_in','whatsapp','instagram','facebook','viber','messenger','email','hotel_reception','google','tripadvisor','other'));
ALTER TABLE venue_reservations ALTER COLUMN source SET DEFAULT 'other';
