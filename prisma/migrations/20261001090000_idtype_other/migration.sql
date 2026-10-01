-- Add an "Other" identity-document type (check-in / guest ID capture).
-- Additive, idempotent; Postgres 12+ allows ADD VALUE outside a value-using txn.
ALTER TYPE "IdType" ADD VALUE IF NOT EXISTS 'OTHER';
