/**
 * 01 · Property Management — T-2 seed fixtures.
 *
 * specs/01-property-management/user-stories.md § Test Fixtures requires:
 *   PROP-A floors, and ROOMS-A = 10 rooms in PROP-A —
 *   6 VACANT, 3 OCCUPIED, 1 UNDER_MAINTENANCE
 * which AC-6 then asserts rolls up to 33% live current-status occupancy.
 *
 * Rooms and categories are OWNED by 02-room-inventory; 01 only reads them for
 * the occupancy rollup. They are seeded here because 01's acceptance criteria
 * need them now — 02 will extend this with the fuller demo set from
 * docs/workflows/seed-data.md rather than duplicating it.
 */
import type { PrismaClient, RoomStatus } from "@prisma/client";
import {
  FLOOR_A_1_ID,
  FLOOR_A_2_ID,
  FLOOR_A_GROUND_ID,
  PROP_A_ID,
  PROP_B_ID,
  ROOM_CATEGORY_A_DELUXE_ID,
  ROOM_CATEGORY_A_SUITE_ID,
  ROOMS_A_PREFIX,
} from "./fixtures";

/** ROOMS-A composition, in room-number order so the board reads naturally. */
const ROOMS_A: { number: string; status: RoomStatus }[] = [
  { number: "101", status: "VACANT" },
  { number: "102", status: "VACANT" },
  { number: "103", status: "OCCUPIED" },
  { number: "104", status: "VACANT" },
  { number: "105", status: "OCCUPIED" },
  { number: "201", status: "VACANT" },
  { number: "202", status: "UNDER_MAINTENANCE" },
  { number: "203", status: "OCCUPIED" },
  { number: "204", status: "VACANT" },
  { number: "205", status: "VACANT" },
];

/**
 * Restore ROOMS-A to its seeded statuses.
 *
 * Exported because any test that mutates room status must be able to put the
 * fixture back — notably 00's `db-scoped` test, which deliberately issues an
 * `updateMany` with NO where clause to prove the scope filter works, and so
 * touches every room in PROP-A. The seed owns fixture state, so the reset lives
 * here rather than being re-hardcoded in each test.
 */
export async function resetRoomsA(prisma: PrismaClient): Promise<void> {
  for (const room of ROOMS_A) {
    await prisma.room.updateMany({
      where: { id: `${ROOMS_A_PREFIX}${room.number}` },
      data: { status: room.status, isActive: true },
    });
  }
}

export async function seedProperty(prisma: PrismaClient): Promise<void> {
  // --- Floors (FR-4, AC-4) ------------------------------------------------
  const floors = [
    { id: FLOOR_A_GROUND_ID, name: "Ground", sortOrder: 0 },
    { id: FLOOR_A_1_ID, name: "1", sortOrder: 1 },
    { id: FLOOR_A_2_ID, name: "2", sortOrder: 2 },
  ];

  for (const floor of floors) {
    await prisma.floor.upsert({
      where: { id: floor.id },
      create: { ...floor, propertyId: PROP_A_ID },
      update: { name: floor.name, sortOrder: floor.sortOrder },
    });
  }

  // --- Room categories (owned by 02; needed for the Room FK) --------------
  // Rates per docs/workflows/seed-data.md: Deluxe ₹4,000, Suite ₹7,000.
  await prisma.roomCategory.upsert({
    where: { id: ROOM_CATEGORY_A_DELUXE_ID },
    create: {
      id: ROOM_CATEGORY_A_DELUXE_ID,
      propertyId: PROP_A_ID,
      name: "Deluxe",
      baseRatePaise: 400_000,
      floorPaise: 300_000,
      ceilPaise: 800_000,
      hsnSac: "996311",
      gstBps: 1200,
      maxAdults: 2,
      maxChildren: 1,
    },
    update: {},
  });

  await prisma.roomCategory.upsert({
    where: { id: ROOM_CATEGORY_A_SUITE_ID },
    create: {
      id: ROOM_CATEGORY_A_SUITE_ID,
      propertyId: PROP_A_ID,
      name: "Suite",
      baseRatePaise: 700_000,
      hsnSac: "996311",
      gstBps: 1200,
      maxAdults: 3,
      maxChildren: 2,
    },
    update: {},
  });

  // --- ROOMS-A (AC-6: 10 rooms → 6 vacant, 3 occupied, 1 maintenance) -----
  for (const room of ROOMS_A) {
    const id = `${ROOMS_A_PREFIX}${room.number}`;
    // Floor 1xx → "1", 2xx → "2"; suites are the 20x line.
    const onFirstFloor = room.number.startsWith("1");

    await prisma.room.upsert({
      where: { id },
      create: {
        id,
        propertyId: PROP_A_ID,
        floorId: onFirstFloor ? FLOOR_A_1_ID : FLOOR_A_2_ID,
        categoryId: onFirstFloor ? ROOM_CATEGORY_A_DELUXE_ID : ROOM_CATEGORY_A_SUITE_ID,
        number: room.number,
        status: room.status,
        isActive: true,
      },
      // Reset status on re-seed: an AC-7 test that checks a room in must not
      // leave the fixture occupied for the next run.
      update: { status: room.status, isActive: true },
    });
  }

  // PROP-B is deliberately left without rooms: AC-8 asserts a property-scoped
  // user sees only their own property, and an empty PROP-B also exercises the
  // "no rooms ⇒ 0%, not NaN" path in occupancyRollup.
  await prisma.property.update({
    where: { id: PROP_B_ID },
    data: { isActive: true },
  });
}
