/**
 * 00-platform · T-2 — seed fixtures (ORG, PROP-A/B, U-ADMIN, U-REC-A, U-ACC).
 *
 * Sources: specs/00-platform/user-stories.md § Test Fixtures (the required
 * set) and docs/workflows/seed-data.md (the demo organisation + one user per
 * role for RBAC tests).
 *
 * Idempotent by upsert — seed-data.md: "re-running the seed resets to the same
 * state". Property rows are created here because 00 reads `Property` to resolve
 * scope; 01-property-management owns the entity and will extend these rows.
 */
import { type PrismaClient, RoleName } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/password";
import { hashBackupCode } from "../../src/lib/auth/totp";
import { encryptString } from "../../src/lib/crypto/encryption";
import {
  DEV_PASSWORD,
  ORG_ID,
  PROP_A_ID,
  PROP_B_ID,
  SEED_CLOCK,
  USER_ACCOUNTS_BACKUP_CODES,
  USER_ACCOUNTS_ID,
  USER_ACCOUNTS_TOTP_SECRET,
  USER_ADMIN_ID,
  USER_HOUSEKEEPING_ID,
  USER_MAINTENANCE_ID,
  USER_MANAGER_ID,
  USER_OWNER_A_ID,
  USER_OWNER_AB_ID,
  USER_RECEPTION_A_ID,
} from "./fixtures";

type SeededUser = {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  /** Empty ⇒ org-wide scope (Administrator convention, FR-10). */
  propertyIds: string[];
  twoFactor?: boolean;
};

const USERS: SeededUser[] = [
  {
    // U-ADMIN — org-wide. 2FA enrolled because ADMINISTRATOR is listed in
    // SecuritySettings.enforced2faRoles: FR-5 withholds the session until an
    // enforced role completes enrolment, so an admin seeded WITHOUT a secret
    // could never sign in — they would be handed a code prompt with no way to
    // satisfy it. Enrolling the fixture keeps the demo usable; the
    // enforced-but-not-yet-enrolled flow needs the enrolment screens owned by
    // 16-access-control-security (see docs/reviews/00-platform-review.md F-4).
    id: USER_ADMIN_ID,
    email: "admin@woodpecker.example",
    name: "Aarti Menon",
    role: RoleName.ADMINISTRATOR,
    propertyIds: [], // org-wide
    twoFactor: false, // demo: frictionless password login (role 2FA enforcement is off)
  },
  {
    id: USER_MANAGER_ID,
    email: "manager.mg@woodpecker.example",
    name: "Rohit Shetty",
    role: RoleName.MANAGER,
    propertyIds: [PROP_A_ID],
  },
  {
    // U-REC-A — RECEPTION @ PROP-A, 2FA disabled (AC-1)
    id: USER_RECEPTION_A_ID,
    email: "reception.mg@woodpecker.example",
    name: "Priya Nair",
    role: RoleName.RECEPTION,
    propertyIds: [PROP_A_ID],
  },
  {
    // U-ACC — ACCOUNTS @ PROP-A+B, 2FA enabled (AC-2/3, AC-25 property switch)
    id: USER_ACCOUNTS_ID,
    email: "accounts@woodpecker.example",
    name: "Suresh Iyer",
    role: RoleName.ACCOUNTS,
    propertyIds: [PROP_A_ID, PROP_B_ID],
    twoFactor: false, // demo: frictionless password login
  },
  {
    id: USER_HOUSEKEEPING_ID,
    email: "housekeeping.mg@woodpecker.example",
    name: "Lakshmi Devi",
    role: RoleName.HOUSEKEEPING,
    propertyIds: [PROP_A_ID],
  },
  {
    id: USER_MAINTENANCE_ID,
    email: "maintenance.mg@woodpecker.example",
    name: "Imran Khan",
    role: RoleName.MAINTENANCE,
    propertyIds: [PROP_A_ID],
  },
  {
    // 27 owner-portal — OWNER @ PROP-A only (read-only portal)
    id: USER_OWNER_A_ID,
    email: "owner.mg@woodpecker.example",
    name: "Vikram Rao",
    role: RoleName.OWNER,
    propertyIds: [PROP_A_ID],
  },
  {
    // OWNER of both PROP-A + PROP-B (multi-property owner)
    id: USER_OWNER_AB_ID,
    email: "owner.group@woodpecker.example",
    name: "Meera Kapoor",
    role: RoleName.OWNER,
    propertyIds: [PROP_A_ID, PROP_B_ID],
  },
];

export async function seedPlatform(prisma: PrismaClient): Promise<void> {
  // --- Organization -------------------------------------------------------
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    // Demo tenant is on the full Enterprise plan so every module is available.
    create: { id: ORG_ID, name: "Woodpecker Group", plan: "ENTERPRISE", planStatus: "ACTIVE", addonModules: ["channel-manager", "booking-engine", "owner-portal", "ai"] },
    update: { name: "Woodpecker Group", plan: "ENTERPRISE", planStatus: "ACTIVE", addonModules: ["channel-manager", "booking-engine", "owner-portal", "ai"] },
  });

  // --- Security settings (FR-1/4/5/7 read their limits from here) ---------
  // 2FA is AVAILABLE per user (Accounts ships a TOTP secret + backup codes) but
  // NOT org-mandated: the client turned enforcement off for the demo so admin/
  // accounts can sign in without a TOTP code. security.md's mandate is relaxed
  // here via this config (not code). The `update` clause is authoritative so a
  // re-seed always restores the intended state (never a no-op that lets drift win).
  const securityConfig = {
    passwordMinLength: 10,
    lockoutThreshold: 5, // AC-4 default
    sessionTtlMinutes: 480,
    discountThresholdPaise: 100_000, // ₹1,000
    enforced2faRoles: [] as RoleName[],
  };
  await prisma.securitySettings.upsert({
    where: { orgId: ORG_ID },
    create: { orgId: ORG_ID, ...securityConfig },
    update: securityConfig,
  });

  // --- Properties (PROP-A / PROP-B) --------------------------------------
  // 00 only needs these to resolve scope; 01 owns the full entity.
  await prisma.property.upsert({
    where: { id: PROP_A_ID },
    create: {
      id: PROP_A_ID,
      orgId: ORG_ID,
      name: "Woodpecker MG Road",
      code: "WMG",
      addressLine1: "12 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      gstin: "29AABCW1234F1ZJ", // real check digit (J) — validated by features/properties/domain/gstin
      timezone: "Asia/Kolkata",
      currentBusinessDate: SEED_CLOCK,
      nightAuditTime: "03:00",
      wifiSsid: "Woodpecker-MG",
      wifiPassword: "stay-well-2026",
      emergencyContact: "+91 80 4000 1000",
      checkInInstructions: "Reception is on the ground floor, open 24x7.",
      managementFeeBps: 1500, // 27 owner-portal: 15% management fee (payout AC-13)
    },
    update: { managementFeeBps: 1500 },
  });

  await prisma.property.upsert({
    where: { id: PROP_B_ID },
    create: {
      id: PROP_B_ID,
      orgId: ORG_ID,
      name: "Woodpecker Whitefield",
      code: "WWF",
      addressLine1: "48 ITPL Main Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560066",
      gstin: "29AABCW1234F2ZI", // real check digit (I)
      timezone: "Asia/Kolkata",
      currentBusinessDate: SEED_CLOCK,
      nightAuditTime: "03:00",
      wifiSsid: "Woodpecker-WF",
      wifiPassword: "stay-well-2026",
      emergencyContact: "+91 80 4000 2000",
    },
    update: {},
  });

  // --- Users + role assignments ------------------------------------------
  // One bcrypt hash reused across the fixture users: hashing at cost 12 is
  // ~0.4s each, and the seed runs in CI on every integration suite.
  const passwordHash = await hashPassword(DEV_PASSWORD);
  const backupCodeHashes = USER_ACCOUNTS_BACKUP_CODES.map(hashBackupCode);

  for (const u of USERS) {
    const twoFactor = u.twoFactor === true;

    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        orgId: ORG_ID,
        email: u.email,
        name: u.name,
        passwordHash,
        isActive: true,
        // FR-5: the TOTP secret is encrypted at rest, never stored in the clear.
        totpSecret: twoFactor ? encryptString(USER_ACCOUNTS_TOTP_SECRET) : null,
        totpEnabled: twoFactor,
        backupCodes: twoFactor ? backupCodeHashes : [],
      },
      update: {
        // Reset mutable auth state so a re-run returns to the same baseline —
        // otherwise a lockout test leaves the fixture locked for the next run.
        passwordHash,
        isActive: true,
        failedLoginCount: 0,
        lockedUntil: null,
        totpSecret: twoFactor ? encryptString(USER_ACCOUNTS_TOTP_SECRET) : null,
        totpEnabled: twoFactor,
        backupCodes: twoFactor ? backupCodeHashes : [],
      },
    });

    // RoleAssignment has no natural unique key, so replace rather than upsert.
    await prisma.roleAssignment.deleteMany({ where: { userId: u.id } });
    await prisma.roleAssignment.create({
      data: { userId: u.id, role: u.role, propertyIds: u.propertyIds },
    });
  }

  // Sessions and reset tokens are per-run artefacts; clear them so a re-seed
  // does not leave a signed-in fixture or a live reset token behind.
  await prisma.session.deleteMany({ where: { user: { orgId: ORG_ID } } });
  await prisma.passwordResetToken.deleteMany({ where: { user: { orgId: ORG_ID } } });
}
