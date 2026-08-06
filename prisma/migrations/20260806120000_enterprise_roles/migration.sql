-- Enterprise login roles (Phase 2C). Additive only: the six existing RoleName
-- values and every existing RoleAssignment row are unchanged. Postgres 12+
-- allows ADD VALUE inside the migration transaction because none of the new
-- values are used in this same migration.
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'ASSISTANT_MANAGER';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'HR';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'INVENTORY_MANAGER';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'PURCHASE_MANAGER';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'POS_MANAGER';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'SECURITY_SUPERVISOR';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'LAUNDRY_SUPERVISOR';
