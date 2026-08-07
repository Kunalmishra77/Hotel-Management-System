-- FRRO / Form C for foreign guests at check-in (03 T7, MoM; India legal req).
-- One per stay; passport/visa numbers are NOT stored here (they live encrypted
-- on GuestId) — `details` holds a masked snapshot that sources the PDF.

-- CreateTable
CREATE TABLE "CForm" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "passportPlaceOfIssue" TEXT,
    "passportIssueDate" DATE,
    "passportExpiryDate" DATE,
    "visaType" TEXT,
    "visaIssueDate" DATE,
    "visaExpiryDate" DATE,
    "arrivalFromCity" TEXT,
    "arrivalFromCountry" TEXT,
    "arrivalInIndiaDate" DATE,
    "nextDestination" TEXT,
    "purposeOfVisit" TEXT,
    "details" JSONB NOT NULL,
    "pdfObjectKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "submissionRef" TEXT,
    "capturedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CForm_reservationId_key" ON "CForm"("reservationId");

-- CreateIndex
CREATE INDEX "CForm_propertyId_idx" ON "CForm"("propertyId");

-- AddForeignKey
ALTER TABLE "CForm" ADD CONSTRAINT "CForm_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CForm" ADD CONSTRAINT "CForm_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
