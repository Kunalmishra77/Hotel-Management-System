-- Expedia as a booking source (client, 31 Oct 2026). Additive enum value only.
ALTER TYPE "BookingSource" ADD VALUE IF NOT EXISTS 'EXPEDIA';
