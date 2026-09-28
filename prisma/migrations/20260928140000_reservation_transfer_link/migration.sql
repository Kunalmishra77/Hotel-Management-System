-- Cross-property transfer: the continuation booking points back to its origin.
ALTER TABLE "Reservation" ADD COLUMN "transferredFromId" TEXT;
