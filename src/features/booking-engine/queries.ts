/**
 * Booking-engine public reads — 23 T-6/T-16 (FR-2/3/15/16/18/20, AC-1/2/3/15).
 *
 * All reads expose ONLY online-sellable inventory and NEVER other-guest PII or
 * internal room numbers (FR-2/20). Availability is 03's single truth
 * (`findFreeRooms`); pricing is 24's resolved rate with base-tariff fallback;
 * the display total is GST-inclusive from `RoomCategory.gstBps`.
 */
import { findFreeRooms, type RoomFinder } from "@/features/reservations/availability";
import { nights as computeNights } from "@/features/reservations/domain/nights";
import { computeCouponDiscount, type CouponLike } from "@/features/billing/domain/coupon-discount";
import { bookingDb, safeResolvedRate } from "./internal";
import { depositAmount, type DepositPolicy } from "./domain/deposit";
import { gstInclusiveDisplay } from "./domain/gst-display";

export type PublishedConfig = {
  configId: string;
  propertyId: string;
  orgId: string;
  timezone: string;
  propertyState: string;
  propertyName: string;
  slug: string;
  onlineSellableCategoryIds: string[];
  depositPolicy: DepositPolicy;
  depositValue: number;
  checkoutTtlMin: number;
  minLos: number;
  maxLos: number | null;
  leadTimeDays: number;
  maxRoomsPerBooking: number;
  cancelWindowHours: number;
};

/** A published property, for the public customer home listing. No PII, no
 *  inventory internals — just what a guest needs to pick a place to stay. */
export type PublishedSite = {
  slug: string;
  propertyName: string;
  city: string;
  state: string;
};

/** List every PUBLISHED booking site whose property is active & not deleted,
 *  ordered by property name. Drives the customer website's property grid.
 *  Unauthenticated-safe (public read), bounded, and never exposes PII. */
export async function listPublishedSites(): Promise<PublishedSite[]> {
  const prisma = bookingDb();
  const configs = await prisma.bookingEngineConfig.findMany({
    where: { isPublished: true },
    select: { slug: true, propertyId: true },
  });
  if (configs.length === 0) return [];
  const properties = await prisma.property.findMany({
    where: {
      id: { in: configs.map((c) => c.propertyId) },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, name: true, city: true, state: true },
  });
  const byId = new Map(properties.map((p) => [p.id, p]));
  return configs
    .flatMap((c) => {
      const p = byId.get(c.propertyId);
      return p ? [{ slug: c.slug, propertyName: p.name, city: p.city, state: p.state }] : [];
    })
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}

/** Load a PUBLISHED config for a public slug, joined with its property. Null if
 *  the slug is unknown or the site is not published (FR-1/2). */
export async function loadPublishedConfig(slug: string): Promise<PublishedConfig | null> {
  const prisma = bookingDb();
  const cfg = await prisma.bookingEngineConfig.findUnique({ where: { slug } });
  if (!cfg || !cfg.isPublished) return null;
  const property = await prisma.property.findFirst({
    where: { id: cfg.propertyId, isActive: true, deletedAt: null },
    select: { id: true, orgId: true, timezone: true, state: true, name: true },
  });
  if (!property) return null;
  return {
    configId: cfg.id,
    propertyId: cfg.propertyId,
    orgId: property.orgId,
    timezone: property.timezone,
    propertyState: property.state,
    propertyName: property.name,
    slug: cfg.slug,
    onlineSellableCategoryIds: cfg.onlineSellableCategoryIds,
    depositPolicy: cfg.depositPolicy as DepositPolicy,
    depositValue: cfg.depositValue,
    checkoutTtlMin: cfg.checkoutTtlMin,
    minLos: cfg.minLos,
    maxLos: cfg.maxLos,
    leadTimeDays: cfg.leadTimeDays,
    maxRoomsPerBooking: cfg.maxRoomsPerBooking,
    cancelWindowHours: cfg.cancelWindowHours,
  };
}

/** Rich, date-independent property content for the OTA-style property page:
 *  identity + location + the sellable room types (photos, amenities, from-price).
 *  Public read; no PII, no inventory internals. */
export type ShowcaseRoomType = {
  id: string;
  name: string;
  description: string | null;
  amenities: string[];
  imageUrls: string[];
  fromPaise: number; // GST-inclusive nightly "from" price
};
export type PropertyShowcase = {
  slug: string;
  propertyName: string;
  city: string;
  state: string;
  addressLine1: string;
  heroImages: string[];
  amenities: string[]; // union across room types
  roomTypes: ShowcaseRoomType[];
  fromPaise: number | null; // cheapest room type
  cancelWindowHours: number;
};

export async function loadPropertyShowcase(slug: string): Promise<PropertyShowcase | null> {
  const prisma = bookingDb();
  const cfg = await prisma.bookingEngineConfig.findUnique({ where: { slug } });
  if (!cfg || !cfg.isPublished) return null;
  const property = await prisma.property.findFirst({
    where: { id: cfg.propertyId, isActive: true, deletedAt: null },
    select: { id: true, name: true, city: true, state: true, addressLine1: true },
  });
  if (!property) return null;

  const cats = await prisma.roomCategory.findMany({
    where: { propertyId: property.id, id: { in: cfg.onlineSellableCategoryIds } },
    orderBy: { baseRatePaise: "asc" },
    select: { id: true, name: true, description: true, amenities: true, imageUrls: true, baseRatePaise: true, gstBps: true },
  });

  const roomTypes: ShowcaseRoomType[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    amenities: c.amenities,
    imageUrls: c.imageUrls,
    fromPaise: Math.round(c.baseRatePaise * (1 + c.gstBps / 10_000)),
  }));

  const heroImages = [...new Set(roomTypes.flatMap((r) => r.imageUrls))].slice(0, 6);
  const amenities = [...new Set(roomTypes.flatMap((r) => r.amenities))];
  const fromPaise = roomTypes.length ? Math.min(...roomTypes.map((r) => r.fromPaise)) : null;

  return {
    slug: cfg.slug,
    propertyName: property.name,
    city: property.city,
    state: property.state,
    addressLine1: property.addressLine1,
    heroImages,
    amenities,
    roomTypes,
    fromPaise,
    cancelWindowHours: cfg.cancelWindowHours,
  };
}

/** The nightly dates of a stay, as UTC-midnight calendar dates (matches @db.Date). */
function nightlyDates(checkIn: Date, n: number): Date[] {
  const base = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86_400_000));
}

/** Sum the resolved nightly rate across the stay (per room), with base fallback. */
export async function resolveStayNetPerRoom(input: {
  orgId: string;
  propertyId: string;
  roomCategoryId: string;
  baseRatePaise: number;
  checkInDate: Date;
  nights: number;
}): Promise<{ netPerRoomPaise: number; source: string }> {
  const dates = nightlyDates(input.checkInDate, input.nights);
  let total = 0;
  let source = "base";
  for (const date of dates) {
    const r = await safeResolvedRate({
      orgId: input.orgId,
      propertyId: input.propertyId,
      roomCategoryId: input.roomCategoryId,
      date,
      baseRatePaise: input.baseRatePaise,
    });
    total += r.ratePaise;
    if (r.source !== "base") source = r.source;
  }
  return { netPerRoomPaise: total, source };
}

export type AvailabilityCategory = {
  roomCategoryId: string;
  name: string;
  available: number; // count of free rooms (never internal room numbers, FR-20)
  nights: number;
  /** GST-inclusive display total for the whole stay for `rooms` rooms (paise). */
  totalPaise: number;
  netPaise: number;
  taxPaise: number;
  gstBps: number;
  depositPaise: number;
  rateSource: string;
  // Rich booking cards (wave 1) — public display only, no PII.
  description: string | null;
  amenities: string[];
  imageUrls: string[];
};

export type AvailabilityResult = {
  propertyName: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  categories: AvailabilityCategory[];
};

/** Per-category availability + GST-inclusive price for a date range (FR-3). */
export async function getPublicAvailability(
  cfg: PublishedConfig,
  query: { checkInDate: Date; checkOutDate: Date; adults: number; children: number; rooms: number },
): Promise<AvailabilityResult> {
  const prisma = bookingDb();
  const n = computeNights(query.checkInDate, query.checkOutDate, cfg.timezone);

  // 03's single availability truth — free rooms for the range, honouring
  // allocations + blocks. Filter to online-sellable categories only (FR-2).
  const free = await findFreeRooms(prisma as unknown as RoomFinder, {
    propertyId: cfg.propertyId,
    checkInDate: query.checkInDate,
    checkOutDate: query.checkOutDate,
    adults: query.adults,
    children: query.children,
  });

  const sellable = new Set(cfg.onlineSellableCategoryIds);
  const byCategory = new Map<string, { name: string; baseRatePaise: number; count: number }>();
  for (const room of free) {
    if (!sellable.has(room.categoryId)) continue;
    const entry = byCategory.get(room.categoryId);
    if (entry) entry.count += 1;
    else byCategory.set(room.categoryId, { name: room.categoryName, baseRatePaise: room.baseRatePaise, count: 1 });
  }

  // gstBps + display fields are per category — read the sellable categories once.
  const catRows = await prisma.roomCategory.findMany({
    where: { propertyId: cfg.propertyId, id: { in: [...byCategory.keys()] } },
    select: { id: true, gstBps: true, description: true, amenities: true, imageUrls: true },
  });
  const gstByCat = new Map(catRows.map((c) => [c.id, c.gstBps]));
  const displayByCat = new Map(
    catRows.map((c) => [c.id, { description: c.description, amenities: c.amenities, imageUrls: c.imageUrls }]),
  );

  const categories: AvailabilityCategory[] = [];
  for (const [categoryId, info] of byCategory) {
    if (info.count < query.rooms) continue; // can't fulfil the requested rooms
    const gstBps = gstByCat.get(categoryId) ?? 1200;
    const { netPerRoomPaise, source } = await resolveStayNetPerRoom({
      orgId: cfg.orgId,
      propertyId: cfg.propertyId,
      roomCategoryId: categoryId,
      baseRatePaise: info.baseRatePaise,
      checkInDate: query.checkInDate,
      nights: n,
    });
    // GST-inclusive from netPerRoom × rooms (net already spans all nights).
    const display = gstInclusiveDisplay(netPerRoomPaise * query.rooms, 1, gstBps, 1);
    categories.push({
      roomCategoryId: categoryId,
      name: info.name,
      available: info.count,
      nights: n,
      totalPaise: display.grossPaise,
      netPaise: display.netPaise,
      taxPaise: display.taxPaise,
      gstBps,
      depositPaise: depositAmount(display.grossPaise, cfg),
      rateSource: source,
      description: displayByCat.get(categoryId)?.description ?? null,
      amenities: displayByCat.get(categoryId)?.amenities ?? [],
      imageUrls: displayByCat.get(categoryId)?.imageUrls ?? [],
    });
  }
  categories.sort((a, b) => a.totalPaise - b.totalPaise);

  return {
    propertyName: cfg.propertyName,
    checkInDate: query.checkInDate,
    checkOutDate: query.checkOutDate,
    nights: n,
    categories,
  };
}

export type QuoteResult = {
  roomCategoryId: string;
  nights: number;
  netPaise: number;
  taxPaise: number;
  totalPaise: number;
  depositPaise: number;
  coupon?: { code: string; discountPaise: number; newTotalPaise: number; newDepositPaise: number } | { code: string; error: string };
};

/**
 * Price a single category for checkout, with optional coupon PREVIEW (no consume,
 * FR-23/AC-20). The `totalPaise`/`depositPaise` are what will be charged unless a
 * valid coupon lowers them — `charged == displayed` (FR-15).
 */
export async function quoteBooking(
  cfg: PublishedConfig,
  input: { roomCategoryId: string; checkInDate: Date; checkOutDate: Date; rooms: number; couponCode?: string },
): Promise<QuoteResult> {
  const prisma = bookingDb();
  const category = await prisma.roomCategory.findFirst({
    where: { id: input.roomCategoryId, propertyId: cfg.propertyId },
    select: { id: true, baseRatePaise: true, gstBps: true },
  });
  if (!category) throw new Error("Room type not found.");
  const n = computeNights(input.checkInDate, input.checkOutDate, cfg.timezone);
  const { netPerRoomPaise } = await resolveStayNetPerRoom({
    orgId: cfg.orgId, propertyId: cfg.propertyId, roomCategoryId: category.id,
    baseRatePaise: category.baseRatePaise, checkInDate: input.checkInDate, nights: n,
  });
  const net = netPerRoomPaise * input.rooms;
  const display = gstInclusiveDisplay(net, 1, category.gstBps, 1);
  const result: QuoteResult = {
    roomCategoryId: category.id, nights: n, netPaise: display.netPaise, taxPaise: display.taxPaise,
    totalPaise: display.grossPaise, depositPaise: depositAmount(display.grossPaise, cfg),
  };
  if (input.couponCode) {
    const preview = await previewCoupon({
      orgId: cfg.orgId, propertyId: cfg.propertyId, roomCategoryId: category.id,
      code: input.couponCode, bookingNetPaise: net, grossPaise: display.grossPaise, cfg,
    });
    result.coupon = preview.ok
      ? { code: input.couponCode, discountPaise: preview.discountPaise, newTotalPaise: preview.newTotalPaise, newDepositPaise: preview.newDepositPaise }
      : { code: input.couponCode, error: preview.reason };
  }
  return result;
}

export type CouponPreview =
  | { ok: true; discountPaise: number; newTotalPaise: number; newDepositPaise: number }
  | { ok: false; reason: "COUPON_INVALID" | "COUPON_EXHAUSTED" | "COUPON_INELIGIBLE" };

/**
 * Preview a coupon at checkout with NO side effects (FR-23/24, AC-20) — mirrors
 * 06.validateCoupon's eligibility gates using the pure `computeCouponDiscount`.
 * The coupon is redeemed atomically only later, inside the confirm transaction.
 *
 * NOTE (delta): ideally 06 exposes a system-callable coupon-preview so this does
 * not read the Coupon row directly. Until then this read mirrors 06's gates.
 */
export async function previewCoupon(input: {
  orgId: string;
  propertyId: string;
  roomCategoryId: string;
  code: string;
  bookingNetPaise: number;
  grossPaise: number;
  cfg: PublishedConfig;
  now?: Date;
}): Promise<CouponPreview> {
  const prisma = bookingDb();
  const now = input.now ?? new Date();
  const coupon = (await prisma.coupon.findFirst({
    where: { orgId: input.orgId, code: input.code },
  })) as
    | (CouponLike & {
        status: string;
        validFrom: Date;
        validTo: Date;
        usageLimit: number | null;
        timesUsed: number;
        appliesToPropertyIds: string[];
        appliesToCategoryIds: string[];
      })
    | null;

  if (!coupon) return { ok: false, reason: "COUPON_INVALID" };
  if (coupon.status !== "ACTIVE" || now < coupon.validFrom || now > coupon.validTo) {
    return { ok: false, reason: "COUPON_INVALID" };
  }
  if (coupon.usageLimit != null && coupon.timesUsed >= coupon.usageLimit) {
    return { ok: false, reason: "COUPON_EXHAUSTED" };
  }
  if (coupon.appliesToPropertyIds.length > 0 && !coupon.appliesToPropertyIds.includes(input.propertyId)) {
    return { ok: false, reason: "COUPON_INELIGIBLE" };
  }
  if (coupon.appliesToCategoryIds.length > 0 && !coupon.appliesToCategoryIds.includes(input.roomCategoryId)) {
    return { ok: false, reason: "COUPON_INELIGIBLE" };
  }
  // Discount applies to the pre-tax (net) booking value, like 06's DISCOUNT line.
  const discount = computeCouponDiscount(coupon, input.bookingNetPaise);
  if (discount <= 0) return { ok: false, reason: "COUPON_INELIGIBLE" };

  const newTotal = Math.max(0, input.grossPaise - discount);
  return {
    ok: true,
    discountPaise: discount,
    newTotalPaise: newTotal,
    newDepositPaise: depositAmount(newTotal, input.cfg),
  };
}
