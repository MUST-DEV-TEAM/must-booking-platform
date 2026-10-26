-- Milestone 24, platform admin console: direct "enter as owner" access for Super admins.
-- Additive and re-runnable.
--
-- TEMPORARY by owner decision (2026-10-20): a direct session needs no approval, reason or expiry, can
-- hide its banner, and is invisible to the hotel owner. The safeguards are to be restored later
-- (see docs/roadmap/milestones/24-platform-admin-plan.md, "Direct access: temporary shortcut").

-- ---- support sessions: direct mode and banner choice ------------------------------------------
ALTER TABLE "support_sessions"
  ADD COLUMN IF NOT EXISTS "direct" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "show_banner" BOOLEAN NOT NULL DEFAULT true;

-- ---- hotel audit rows written during a direct session are hidden from the hotel ----------------
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION "audit_logs_set_hidden"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW."request_context" #>> '{support,hidden}') = 'true' THEN
    NEW."hidden" := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "audit_logs_set_hidden" ON "audit_logs";
CREATE TRIGGER "audit_logs_set_hidden" BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_set_hidden"();

-- Restrictive, so it narrows every existing read path (activity workspace, exports, staff history):
-- only platform roles ever see a hidden row.
DROP POLICY IF EXISTS "audit_logs_hide_platform_actions" ON "audit_logs";
CREATE POLICY "audit_logs_hide_platform_actions" ON "audit_logs" AS RESTRICTIVE FOR SELECT
  USING ("hidden" = false OR current_setting('app.role', true) IN ('platform_admin', 'platform_console'));

CREATE INDEX IF NOT EXISTS "audit_logs_hidden" ON "audit_logs" ("tenant_id", "created_at" DESC)
  WHERE "hidden" = true;

-- ---- Super admin gets the new capability --------------------------------------------------------
UPDATE "platform_roles"
SET "capabilities" = array_append("capabilities", 'platform.support.direct'), "updated_at" = now()
WHERE "key" = 'super_admin' AND NOT ('platform.support.direct' = ANY ("capabilities"));
