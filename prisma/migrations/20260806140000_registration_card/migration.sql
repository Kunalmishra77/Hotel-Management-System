-- Digital registration card + e-signature captured at check-in (03 T6, MoM).
-- One per stay; the signature image lives in encrypted object storage (the row
-- holds only the key + checksum). guestSnapshot freezes the signed card.

-- CreateTable
CREATE TABLE "RegistrationCard" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "signatureObjectKey" TEXT,
    "signatureChecksum" TEXT,
    "keyCardRef" TEXT,
    "guestSnapshot" JSONB NOT NULL,
    "capturedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationCard_reservationId_key" ON "RegistrationCard"("reservationId");

-- CreateIndex
CREATE INDEX "RegistrationCard_propertyId_idx" ON "RegistrationCard"("propertyId");

-- AddForeignKey
ALTER TABLE "RegistrationCard" ADD CONSTRAINT "RegistrationCard_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationCard" ADD CONSTRAINT "RegistrationCard_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
