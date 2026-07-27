-- Milestone 1, Task 1: tenancy and staff schema. RLS is deliberately added in
-- Task 2, after the request-scoped Postgres context wrapper exists.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE "TenantMembershipRole" AS ENUM ('OWNER', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PropertyRoleTemplateKind" AS ENUM ('BUILT_IN', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

CREATE TABLE IF NOT EXISTS "properties" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "slug" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "properties_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "properties_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "properties_tenant_id_slug_key" UNIQUE ("tenant_id", "slug"),
  CONSTRAINT "properties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "properties_tenant_id_idx" ON "properties"("tenant_id");

CREATE TABLE IF NOT EXISTS "tenant_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "TenantMembershipRole" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_memberships_tenant_id_user_id_key" UNIQUE ("tenant_id", "user_id"),
  CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_one_owner_per_tenant" ON "tenant_memberships"("tenant_id") WHERE "role" = 'OWNER';

CREATE TABLE IF NOT EXISTS "capabilities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capabilities_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "capabilities_tenant_id_key_key" UNIQUE ("tenant_id", "key"),
  CONSTRAINT "capabilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "capabilities_tenant_id_idx" ON "capabilities"("tenant_id");

CREATE TABLE IF NOT EXISTS "property_role_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "kind" "PropertyRoleTemplateKind" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_role_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "property_role_templates_tenant_id_property_id_id_key" UNIQUE ("tenant_id", "property_id", "id"),
  CONSTRAINT "property_role_templates_tenant_id_property_id_name_key" UNIQUE ("tenant_id", "property_id", "name"),
  CONSTRAINT "property_role_templates_tenant_id_property_id_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "property_role_templates_tenant_id_property_id_idx" ON "property_role_templates"("tenant_id", "property_id");

CREATE TABLE IF NOT EXISTS "property_role_template_capabilities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "role_template_id" UUID NOT NULL,
  "capability_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_role_template_capabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "property_role_template_capabilities_tenant_id_property_id_role_template_id_capability_id_key" UNIQUE ("tenant_id", "property_id", "role_template_id", "capability_id"),
  CONSTRAINT "property_role_template_capabilities_role_template_fkey" FOREIGN KEY ("tenant_id", "property_id", "role_template_id") REFERENCES "property_role_templates"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "property_role_template_capabilities_capability_fkey" FOREIGN KEY ("tenant_id", "capability_id") REFERENCES "capabilities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "property_role_template_capabilities_tenant_id_property_id_idx" ON "property_role_template_capabilities"("tenant_id", "property_id");

CREATE TABLE IF NOT EXISTS "property_staff_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "property_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role_template_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_staff_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "property_staff_assignments_tenant_id_property_id_user_id_key" UNIQUE ("tenant_id", "property_id", "user_id"),
  CONSTRAINT "property_staff_assignments_property_fkey" FOREIGN KEY ("tenant_id", "property_id") REFERENCES "properties"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "property_staff_assignments_membership_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "property_staff_assignments_role_template_fkey" FOREIGN KEY ("tenant_id", "property_id", "role_template_id") REFERENCES "property_role_templates"("tenant_id", "property_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "property_staff_assignments_tenant_id_user_id_idx" ON "property_staff_assignments"("tenant_id", "user_id");
