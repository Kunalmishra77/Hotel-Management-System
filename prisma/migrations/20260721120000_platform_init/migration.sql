-- =============================================================================
-- 00-platform · T-1 — baseline schema + platform DB-level constraints
--
-- Materializes the canonical, finalized prisma/schema.prisma (docs say all 26
-- modules' schema-deltas are already folded in, so the datamodel is created as
-- one baseline). Per-module DB-level constraints from
-- docs/architecture/database-setup.md are added by each module's own T-1
-- migration in tier order:
--   03 → RoomAllocation EXCLUDE (no overbooking)   04 → Guest pg_trgm GIN index
--   06 → FolioLine/Payment/Invoice append-only     09 → Attendance unique/day
-- This migration owns only 00's constraints: the extensions and the
-- append-only guards on AuditLog (FR-16) and DomainEvent (FR-19).
-- =============================================================================

-- Extensions (database-setup.md § Postgres version & extensions).
-- Created here so later modules' migrations can rely on them:
--   btree_gist → 03's no-overbooking EXCLUDE constraint
--   pg_trgm    → 04/15 fuzzy guest search (p95 < 500ms)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('ADMINISTRATOR', 'MANAGER', 'RECEPTION', 'ACCOUNTS', 'HOUSEKEEPING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('GUESTS', 'RESERVATIONS', 'BALANCES', 'ROOMS', 'STAFF');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('DRAFT', 'VALIDATED', 'COMMITTING', 'COMMITTED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'OK', 'ERROR', 'SKIPPED_DUPLICATE');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('VACANT', 'OCCUPIED', 'RESERVED', 'UNDER_MAINTENANCE', 'HOUSEKEEPING');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('DIRECT', 'WEBSITE', 'PHONE', 'WALK_IN', 'AIRBNB', 'BOOKING_COM', 'AGODA', 'MAKEMYTRIP', 'GOIBIBO', 'CORPORATE', 'TRAVEL_AGENT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ENQUIRY', 'CONFIRMED', 'IN_HOUSE', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('AADHAAR', 'PASSPORT', 'DRIVING_LICENCE', 'PAN', 'VOTER_ID', 'VISA');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('ROOM', 'FOOD', 'LAUNDRY', 'AIRPORT_TRANSFER', 'TAXI', 'KITCHEN', 'EXTRA_BED', 'POS', 'MISC', 'DISCOUNT', 'TAX', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'UPI', 'BANK_TRANSFER', 'ONLINE', 'CORPORATE_CREDIT');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('TAX_INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExpenseHead" AS ENUM ('HOUSEKEEPING', 'KITCHEN', 'MAINTENANCE', 'UTILITIES', 'STAFF', 'ADMINISTRATION', 'MISC');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('NONE', 'CASUAL', 'SICK', 'PAID', 'UNPAID');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "HousekeepingTaskType" AS ENUM ('CLEANING', 'LINEN_CHANGE', 'TOWEL_CHANGE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "HousekeepingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('AC', 'ELECTRICAL', 'PLUMBING', 'FURNITURE', 'PAINTING', 'PEST_CONTROL', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "AutomationCategory" AS ENUM ('BEFORE_ARRIVAL', 'DURING_STAY', 'AFTER_CHECKOUT', 'MARKETING');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('OPEN', 'SETTLED', 'VOID');

-- CreateEnum
CREATE TYPE "DynamicRateStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pincode" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "gstin" TEXT,
    "ownerName" TEXT,
    "ownerContact" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentBusinessDate" DATE,
    "nightAuditTime" TEXT,
    "dayUseEnabled" BOOLEAN NOT NULL DEFAULT false,
    "holdTtlHours" INTEGER NOT NULL DEFAULT 24,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "noShowRetainAdvance" BOOLEAN NOT NULL DEFAULT true,
    "wifiSsid" TEXT,
    "wifiPassword" TEXT,
    "houseRules" TEXT,
    "emergencyContact" TEXT,
    "locationMapUrl" TEXT,
    "checkInInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backupCodes" TEXT[],
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "propertyIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionOverride" (
    "id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,

    CONSTRAINT "PermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "activePropertyId" TEXT,
    "ip" TEXT,
    "device" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecuritySettings" (
    "orgId" TEXT NOT NULL,
    "passwordMinLength" INTEGER NOT NULL DEFAULT 10,
    "lockoutThreshold" INTEGER NOT NULL DEFAULT 5,
    "enforced2faRoles" "RoleName"[],
    "sessionTtlMinutes" INTEGER NOT NULL DEFAULT 480,
    "discountThresholdPaise" INTEGER NOT NULL DEFAULT 100000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecuritySettings_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "ip" TEXT,
    "device" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationInbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "target" TEXT,
    "sizeBytes" BIGINT,
    "error" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "fileObjectKey" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNum" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "action" TEXT NOT NULL DEFAULT 'CREATE',
    "targetType" TEXT,
    "targetId" TEXT,
    "error" TEXT,
    "importKey" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomCategory" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseRatePaise" INTEGER NOT NULL,
    "floorPaise" INTEGER,
    "ceilPaise" INTEGER,
    "maxAdults" INTEGER NOT NULL DEFAULT 2,
    "maxChildren" INTEGER NOT NULL DEFAULT 1,
    "hsnSac" TEXT,
    "gstBps" INTEGER NOT NULL DEFAULT 1200,

    CONSTRAINT "RoomCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "floorId" TEXT,
    "categoryId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'VACANT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomBlock" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "maintenanceJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "BookingSource" NOT NULL,
    "channelRef" TEXT,
    "channelAccountId" TEXT,
    "corporateId" TEXT,
    "travelAgentId" TEXT,
    "checkInDate" DATE NOT NULL,
    "checkOutDate" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "expectedArrival" TEXT,
    "nights" INTEGER NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "holdExpiresAt" TIMESTAMP(3),
    "ratePaise" INTEGER NOT NULL,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "extraBedPaise" INTEGER NOT NULL DEFAULT 0,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,
    "otherChargesPaise" INTEGER NOT NULL DEFAULT 0,
    "advancePaise" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAllocation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,

    CONSTRAINT "RoomAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "gender" TEXT,
    "dob" DATE,
    "anniversary" DATE,
    "nationality" TEXT,
    "occupation" TEXT,
    "mobile" TEXT NOT NULL,
    "mobileHash" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "emailHash" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "pincode" TEXT,
    "companyName" TEXT,
    "gstNumber" TEXT,
    "purposeOfVisit" TEXT,
    "specialRequests" TEXT,
    "foodPreference" TEXT,
    "medicalNotes" TEXT,
    "preferredRoomCategoryId" TEXT,
    "preferredFloor" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestId" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "type" "IdType" NOT NULL,
    "maskedValue" TEXT NOT NULL,
    "valueHash" TEXT,
    "encryptedValue" TEXT,
    "scanObjectKey" TEXT,
    "scanChecksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestStatsSnapshot" (
    "guestId" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "totalRoomNights" INTEGER NOT NULL DEFAULT 0,
    "totalRevenuePaise" BIGINT NOT NULL DEFAULT 0,
    "outstandingPaise" BIGINT NOT NULL DEFAULT 0,
    "preferredCategoryId" TEXT,
    "preferredRatePaise" INTEGER,
    "lastStayAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestStatsSnapshot_pkey" PRIMARY KEY ("guestId")
);

-- CreateTable
CREATE TABLE "Folio" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RESERVATION',
    "reservationId" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolioLine" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPaise" INTEGER NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "hsnSac" TEXT,
    "placeOfSupplyState" TEXT,
    "businessDate" DATE NOT NULL,
    "reversalOfId" TEXT,
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolioLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "reference" TEXT,
    "gatewayOrderId" TEXT,
    "settlementBatchId" TEXT,
    "isRefund" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSeries" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InvoiceSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'TAX_INVOICE',
    "cancelsInvoiceId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerGstin" TEXT,
    "placeOfSupply" TEXT NOT NULL,
    "taxableValuePaise" BIGINT NOT NULL,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" BIGINT NOT NULL,
    "pdfObjectKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountBps" INTEGER,
    "discountPaise" INTEGER,
    "maxDiscountPaise" INTEGER,
    "minBookingPaise" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "usageLimit" INTEGER,
    "usageLimitPerGuest" INTEGER NOT NULL DEFAULT 1,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "appliesToPropertyIds" TEXT[],
    "appliesToCategoryIds" TEXT[],
    "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "reservationId" TEXT,
    "folioId" TEXT,
    "discountPaise" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "head" "ExpenseHead" NOT NULL,
    "subCategory" TEXT,
    "description" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "spentOn" DATE NOT NULL,
    "paidVia" "PaymentMode",
    "vendor" TEXT,
    "billObjectKey" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "address" TEXT,
    "department" TEXT NOT NULL,
    "monthlySalaryPaise" INTEGER NOT NULL,
    "joinedOn" DATE NOT NULL,
    "leftOn" DATE,
    "aadhaarMasked" TEXT,
    "panMasked" TEXT,
    "bankAccount" TEXT,
    "bankIfsc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDocument" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "workedMinutes" INTEGER,
    "isLeave" BOOLEAN NOT NULL DEFAULT false,
    "leaveType" "LeaveType" NOT NULL DEFAULT 'NONE',
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAdvance" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "recoveredPaise" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "runType" TEXT NOT NULL DEFAULT 'REGULAR',
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "netTotalPaise" BIGINT NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "basePaise" INTEGER NOT NULL,
    "advancePaise" INTEGER NOT NULL DEFAULT 0,
    "bonusPaise" INTEGER NOT NULL DEFAULT 0,
    "deductionPaise" INTEGER NOT NULL DEFAULT 0,
    "overtimePaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL,
    "paidDays" DOUBLE PRECISION,
    "lopDays" DOUBLE PRECISION,
    "otMinutes" INTEGER,
    "notes" TEXT,
    "payslipObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingTask" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "type" "HousekeepingTaskType" NOT NULL,
    "status" "HousekeepingStatus" NOT NULL DEFAULT 'PENDING',
    "linenChanged" BOOLEAN NOT NULL DEFAULT false,
    "towelChanged" BOOLEAN NOT NULL DEFAULT false,
    "complaintText" TEXT,
    "raisedMaintenanceJobId" TEXT,
    "notes" TEXT,
    "assignedToStaffId" TEXT,
    "clientUpdatedAt" TIMESTAMP(3),
    "serverStatusChangedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousekeepingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceJob" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomId" TEXT,
    "category" "MaintenanceCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "isPreventive" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" DATE,
    "recurrence" TEXT,
    "roomBlockId" TEXT,
    "costPaise" INTEGER,
    "reportedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "body" TEXT NOT NULL,
    "providerTemplateId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAutomation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "category" "AutomationCategory" NOT NULL,
    "triggerEvent" TEXT,
    "scheduleOffsetMinutes" INTEGER,
    "templateKey" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "audienceFilter" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MessageAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "segmentRef" TEXT,
    "couponId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationConsent" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "marketingStatus" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "config" JSONB NOT NULL,

    CONSTRAINT "MessagingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "guestId" TEXT,
    "channel" "Channel" NOT NULL,
    "category" "AutomationCategory",
    "templateKey" TEXT,
    "toAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerRef" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "triggeredByEvent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "sentiment" TEXT,
    "sentimentScore" DOUBLE PRECISION,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAccount" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "certifiedAt" TIMESTAMP(3),
    "credentialsRef" TEXT,
    "config" JSONB NOT NULL,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "ChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomTypeMapping" (
    "id" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "roomCategoryId" TEXT NOT NULL,
    "externalRoomType" TEXT NOT NULL,
    "externalRatePlan" TEXT,

    CONSTRAINT "RoomTypeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSyncLog" (
    "id" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStatSnapshot" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "availableRoomNights" INTEGER NOT NULL,
    "occupiedRoomNights" INTEGER NOT NULL,
    "roomRevenuePaise" BIGINT NOT NULL,
    "totalRevenuePaise" BIGINT NOT NULL,
    "expensePaise" BIGINT NOT NULL,
    "adrPaise" INTEGER NOT NULL,
    "revparPaise" INTEGER NOT NULL,
    "occupancyBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyStatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NightAuditRun" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NightAuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "objectKey" TEXT,
    "rowCount" INTEGER,
    "includesPii" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInteractionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputRedacted" JSONB,
    "outputRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSegment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleJson" JSONB NOT NULL,
    "guestIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOutlet" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultGstBps" INTEGER NOT NULL DEFAULT 500,

    CONSTRAINT "PosOutlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePaise" INTEGER NOT NULL,
    "hsnSac" TEXT,
    "gstBps" INTEGER NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "reservationId" TEXT,
    "status" "PosOrderStatus" NOT NULL DEFAULT 'OPEN',
    "subtotalPaise" INTEGER NOT NULL DEFAULT 0,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "cgstPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstPaise" INTEGER NOT NULL DEFAULT 0,
    "igstPaise" INTEGER NOT NULL DEFAULT 0,
    "roundOffPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "settlementInvoiceId" TEXT,
    "settlementPaymentId" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPaise" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "hsnSac" TEXT,
    "gstBps" INTEGER NOT NULL DEFAULT 500,

    CONSTRAINT "PosOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCostPaise" INTEGER,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeComponent" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyPerUnit" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RecipeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "credentialsRef" TEXT,
    "glMappings" JSONB,

    CONSTRAINT "AccountingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSyncLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEngineConfig" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "onlineSellableCategoryIds" TEXT[],
    "depositPolicy" TEXT NOT NULL DEFAULT 'PCT',
    "depositValue" INTEGER NOT NULL DEFAULT 2000,
    "checkoutTtlMin" INTEGER NOT NULL DEFAULT 15,
    "minLos" INTEGER NOT NULL DEFAULT 1,
    "maxLos" INTEGER,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "maxRoomsPerBooking" INTEGER NOT NULL DEFAULT 5,
    "cancelWindowHours" INTEGER NOT NULL DEFAULT 48,
    "gatewayProvider" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BookingEngineConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEngineOrder" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "gatewayOrderId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "consentVersion" TEXT,
    "consentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEngineOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlan" (
    "id" TEXT NOT NULL,
    "roomCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePaise" INTEGER NOT NULL,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynamicRate" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomCategoryId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "suggestedPaise" INTEGER NOT NULL,
    "appliedPaise" INTEGER,
    "status" "DynamicRateStatus" NOT NULL DEFAULT 'SUGGESTED',
    "approvedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "DynamicRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Corporate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "creditLimitPaise" BIGINT NOT NULL DEFAULT 0,
    "receivablePaise" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Corporate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiatedRate" (
    "id" TEXT NOT NULL,
    "corporateId" TEXT NOT NULL,
    "roomCategoryId" TEXT NOT NULL,
    "ratePaise" INTEGER NOT NULL,

    CONSTRAINT "NegotiatedRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelAgent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commissionBps" INTEGER NOT NULL DEFAULT 0,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_orgId_idx" ON "Property"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_orgId_code_key" ON "Property"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE INDEX "RoleAssignment_userId_idx" ON "RoleAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionOverride_role_permission_key" ON "PermissionOverride"("role", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_entityType_entityId_idx" ON "AuditLog"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_action_idx" ON "AuditLog"("orgId", "action");

-- CreateIndex
CREATE INDEX "AuditLog_propertyId_idx" ON "AuditLog"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_seq_key" ON "DomainEvent"("seq");

-- CreateIndex
CREATE INDEX "DomainEvent_type_aggregateId_idx" ON "DomainEvent"("type", "aggregateId");

-- CreateIndex
CREATE INDEX "DomainEvent_dispatchedAt_idx" ON "DomainEvent"("dispatchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationInbox_provider_externalId_key" ON "IntegrationInbox"("provider", "externalId");

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");

-- CreateIndex
CREATE INDEX "ImportBatch_orgId_status_idx" ON "ImportBatch"("orgId", "status");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_status_idx" ON "ImportRow"("batchId", "status");

-- CreateIndex
CREATE INDEX "ImportRow_importKey_idx" ON "ImportRow"("importKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_rowNum_key" ON "ImportRow"("batchId", "rowNum");

-- CreateIndex
CREATE INDEX "Floor_propertyId_idx" ON "Floor"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Floor_propertyId_name_key" ON "Floor"("propertyId", "name");

-- CreateIndex
CREATE INDEX "RoomCategory_propertyId_idx" ON "RoomCategory"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomCategory_propertyId_name_key" ON "RoomCategory"("propertyId", "name");

-- CreateIndex
CREATE INDEX "Room_propertyId_status_idx" ON "Room"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Room_propertyId_number_key" ON "Room"("propertyId", "number");

-- CreateIndex
CREATE INDEX "RoomBlock_roomId_startDate_endDate_idx" ON "RoomBlock"("roomId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Reservation_propertyId_status_idx" ON "Reservation"("propertyId", "status");

-- CreateIndex
CREATE INDEX "Reservation_propertyId_checkInDate_idx" ON "Reservation"("propertyId", "checkInDate");

-- CreateIndex
CREATE INDEX "Reservation_guestId_idx" ON "Reservation"("guestId");

-- CreateIndex
CREATE INDEX "Reservation_corporateId_idx" ON "Reservation"("corporateId");

-- CreateIndex
CREATE INDEX "Reservation_travelAgentId_idx" ON "Reservation"("travelAgentId");

-- CreateIndex
CREATE INDEX "Reservation_channelRef_idx" ON "Reservation"("channelRef");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_propertyId_code_key" ON "Reservation"("propertyId", "code");

-- CreateIndex
CREATE INDEX "RoomAllocation_roomId_startDate_endDate_idx" ON "RoomAllocation"("roomId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "RoomAllocation_propertyId_idx" ON "RoomAllocation"("propertyId");

-- CreateIndex
CREATE INDEX "Guest_orgId_mobileHash_idx" ON "Guest"("orgId", "mobileHash");

-- CreateIndex
CREATE INDEX "Guest_orgId_emailHash_idx" ON "Guest"("orgId", "emailHash");

-- CreateIndex
CREATE INDEX "Guest_orgId_gstNumber_idx" ON "Guest"("orgId", "gstNumber");

-- CreateIndex
CREATE INDEX "Guest_orgId_city_idx" ON "Guest"("orgId", "city");

-- CreateIndex
CREATE INDEX "GuestId_guestId_idx" ON "GuestId"("guestId");

-- CreateIndex
CREATE INDEX "GuestId_type_valueHash_idx" ON "GuestId"("type", "valueHash");

-- CreateIndex
CREATE UNIQUE INDEX "Folio_reservationId_key" ON "Folio"("reservationId");

-- CreateIndex
CREATE INDEX "Folio_propertyId_idx" ON "Folio"("propertyId");

-- CreateIndex
CREATE INDEX "FolioLine_folioId_idx" ON "FolioLine"("folioId");

-- CreateIndex
CREATE INDEX "FolioLine_businessDate_idx" ON "FolioLine"("businessDate");

-- CreateIndex
CREATE INDEX "Payment_folioId_idx" ON "Payment"("folioId");

-- CreateIndex
CREATE INDEX "Payment_propertyId_receivedAt_idx" ON "Payment"("propertyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSeries_propertyId_financialYear_key" ON "InvoiceSeries"("propertyId", "financialYear");

-- CreateIndex
CREATE INDEX "Invoice_propertyId_issuedAt_idx" ON "Invoice"("propertyId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_propertyId_number_key" ON "Invoice"("propertyId", "number");

-- CreateIndex
CREATE INDEX "Coupon_orgId_status_idx" ON "Coupon"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_orgId_code_key" ON "Coupon"("orgId", "code");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_guestId_idx" ON "CouponRedemption"("couponId", "guestId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_reservationId_key" ON "CouponRedemption"("couponId", "reservationId");

-- CreateIndex
CREATE INDEX "Expense_propertyId_spentOn_idx" ON "Expense"("propertyId", "spentOn");

-- CreateIndex
CREATE INDEX "Expense_propertyId_head_idx" ON "Expense"("propertyId", "head");

-- CreateIndex
CREATE INDEX "Staff_propertyId_idx" ON "Staff"("propertyId");

-- CreateIndex
CREATE INDEX "StaffDocument_staffId_idx" ON "StaffDocument"("staffId");

-- CreateIndex
CREATE INDEX "Attendance_staffId_idx" ON "Attendance"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_staffId_day_key" ON "Attendance"("staffId", "day");

-- CreateIndex
CREATE INDEX "StaffAdvance_staffId_idx" ON "StaffAdvance"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_propertyId_month_sequence_key" ON "PayrollRun"("propertyId", "month", "sequence");

-- CreateIndex
CREATE INDEX "PayrollLine_runId_idx" ON "PayrollLine"("runId");

-- CreateIndex
CREATE INDEX "HousekeepingTask_propertyId_status_idx" ON "HousekeepingTask"("propertyId", "status");

-- CreateIndex
CREATE INDEX "HousekeepingTask_roomId_idx" ON "HousekeepingTask"("roomId");

-- CreateIndex
CREATE INDEX "MaintenanceJob_propertyId_status_idx" ON "MaintenanceJob"("propertyId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceJob_scheduledFor_idx" ON "MaintenanceJob"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_orgId_key_channel_language_key" ON "MessageTemplate"("orgId", "key", "channel", "language");

-- CreateIndex
CREATE INDEX "MessageAutomation_orgId_category_idx" ON "MessageAutomation"("orgId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationConsent_guestId_channel_key" ON "CommunicationConsent"("guestId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingAccount_orgId_channel_provider_key" ON "MessagingAccount"("orgId", "channel", "provider");

-- CreateIndex
CREATE INDEX "MessageLog_guestId_idx" ON "MessageLog"("guestId");

-- CreateIndex
CREATE INDEX "MessageLog_status_idx" ON "MessageLog"("status");

-- CreateIndex
CREATE INDEX "MessageLog_propertyId_createdAt_idx" ON "MessageLog"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_guestId_idx" ON "Feedback"("guestId");

-- CreateIndex
CREATE INDEX "Feedback_propertyId_createdAt_idx" ON "Feedback"("propertyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAccount_propertyId_provider_key" ON "ChannelAccount"("propertyId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "RoomTypeMapping_channelAccountId_externalRoomType_key" ON "RoomTypeMapping"("channelAccountId", "externalRoomType");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_channelAccountId_createdAt_idx" ON "ChannelSyncLog"("channelAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStatSnapshot_propertyId_businessDate_key" ON "DailyStatSnapshot"("propertyId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "NightAuditRun_propertyId_businessDate_key" ON "NightAuditRun"("propertyId", "businessDate");

-- CreateIndex
CREATE INDEX "ExportJob_userId_createdAt_idx" ON "ExportJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteractionLog_feature_createdAt_idx" ON "AiInteractionLog"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "GuestSegment_orgId_idx" ON "GuestSegment"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PosOutlet_propertyId_name_key" ON "PosOutlet"("propertyId", "name");

-- CreateIndex
CREATE INDEX "MenuItem_outletId_idx" ON "MenuItem"("outletId");

-- CreateIndex
CREATE INDEX "PosOrder_propertyId_status_idx" ON "PosOrder"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_propertyId_code_key" ON "PosOrder"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_propertyId_name_key" ON "InventoryItem"("propertyId", "name");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_idx" ON "InventoryMovement"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_refType_refId_itemId_key" ON "InventoryMovement"("refType", "refId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeComponent_menuItemId_itemId_key" ON "RecipeComponent"("menuItemId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingConfig_orgId_provider_key" ON "AccountingConfig"("orgId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingSyncLog_provider_entityType_entityId_key" ON "AccountingSyncLog"("provider", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingEngineConfig_propertyId_key" ON "BookingEngineConfig"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingEngineConfig_slug_key" ON "BookingEngineConfig"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BookingEngineOrder_gatewayOrderId_key" ON "BookingEngineOrder"("gatewayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingEngineOrder_idempotencyKey_key" ON "BookingEngineOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BookingEngineOrder_propertyId_status_idx" ON "BookingEngineOrder"("propertyId", "status");

-- CreateIndex
CREATE INDEX "RatePlan_roomCategoryId_idx" ON "RatePlan"("roomCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "DynamicRate_roomCategoryId_date_key" ON "DynamicRate"("roomCategoryId", "date");

-- CreateIndex
CREATE INDEX "Corporate_orgId_idx" ON "Corporate"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "NegotiatedRate_corporateId_roomCategoryId_key" ON "NegotiatedRate"("corporateId", "roomCategoryId");

-- CreateIndex
CREATE INDEX "TravelAgent_orgId_idx" ON "TravelAgent"("orgId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomCategory" ADD CONSTRAINT "RoomCategory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "RoomCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "Corporate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "TravelAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAllocation" ADD CONSTRAINT "RoomAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAllocation" ADD CONSTRAINT "RoomAllocation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestId" ADD CONSTRAINT "GuestId_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLine" ADD CONSTRAINT "FolioLine_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceSeries" ADD CONSTRAINT "InvoiceSeries_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocument" ADD CONSTRAINT "StaffDocument_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomTypeMapping" ADD CONSTRAINT "RoomTypeMapping_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "PosOutlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderItem" ADD CONSTRAINT "PosOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeComponent" ADD CONSTRAINT "RecipeComponent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_roomCategoryId_fkey" FOREIGN KEY ("roomCategoryId") REFERENCES "RoomCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiatedRate" ADD CONSTRAINT "NegotiatedRate_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "Corporate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- 00 FR-16 / AC-15 — AuditLog is append-only.
--
-- Enforced with a trigger rather than REVOKE UPDATE, DELETE: Prisma connects as
-- the table owner, and an owner cannot be stripped of its own privileges, so a
-- REVOKE would be silently ineffective. A BEFORE trigger fires for the owner too.
-- =============================================================================
CREATE OR REPLACE FUNCTION enforce_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on % is not permitted (table is append-only)',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditlog_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- =============================================================================
-- 00 FR-18/19 — DomainEvent: the event itself is immutable, but the outbox
-- dispatcher MUST stamp dispatchedAt and increment attempts. So this is not a
-- blanket append-only guard: DELETE is refused outright ("the event row is
-- never discarded"), and UPDATE may touch ONLY the dispatch bookkeeping columns.
-- Rewriting a payload, retargeting an aggregate, or reordering seq is refused.
-- =============================================================================
CREATE OR REPLACE FUNCTION enforce_domainevent_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: DomainEvent rows are never deleted'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW."id"          IS DISTINCT FROM OLD."id"
  OR NEW."seq"         IS DISTINCT FROM OLD."seq"
  OR NEW."orgId"       IS DISTINCT FROM OLD."orgId"
  OR NEW."propertyId"  IS DISTINCT FROM OLD."propertyId"
  OR NEW."type"        IS DISTINCT FROM OLD."type"
  OR NEW."aggregateId" IS DISTINCT FROM OLD."aggregateId"
  OR NEW."payload"::text IS DISTINCT FROM OLD."payload"::text
  OR NEW."occurredAt"  IS DISTINCT FROM OLD."occurredAt" THEN
    RAISE EXCEPTION 'APPEND_ONLY: only dispatchedAt/attempts may be updated on DomainEvent'
      USING ERRCODE = '0A000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER domainevent_immutable
  BEFORE UPDATE OR DELETE ON "DomainEvent"
  FOR EACH ROW EXECUTE FUNCTION enforce_domainevent_immutable();
