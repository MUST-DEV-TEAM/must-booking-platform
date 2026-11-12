-- Reservation tab counts check whether each booking's current attention alert was dismissed.
-- Index only those audit events, so the lookup does not rescan the hotel's audit history per booking.
-- Additive and safe to rerun. Rolling back application code can retain this index.
CREATE INDEX IF NOT EXISTS audit_logs_booking_attention_dismissed
  ON audit_logs (tenant_id, property_id, target_id)
  WHERE target_type = 'booking' AND action = 'booking.attention_dismissed';
