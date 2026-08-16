/**
 * Maps a free-text amenity label to a lucide icon (best-effort keyword match).
 * Keeps the amenities grid visual without forcing staff to pick from a fixed list.
 */
import {
  Wifi, Snowflake, Tv, Coffee, UtensilsCrossed, Car, Bath, BedDouble, Wind,
  WashingMachine, Dumbbell, Waves, ParkingCircle, ConciergeBell, Refrigerator, Sparkles, type LucideIcon,
} from "lucide-react";

const RULES: { test: RegExp; icon: LucideIcon }[] = [
  { test: /wi-?fi|internet/i, icon: Wifi },
  { test: /air.?condition|\bac\b/i, icon: Snowflake },
  { test: /\btv\b|television|smart tv/i, icon: Tv },
  { test: /tea|coffee/i, icon: Coffee },
  { test: /kitchen|kitchenette/i, icon: UtensilsCrossed },
  { test: /fridge|refrigerat|mini.?bar/i, icon: Refrigerator },
  { test: /airport|transfer|taxi|cab/i, icon: Car },
  { test: /park/i, icon: ParkingCircle },
  { test: /bath|geyser|hot water|shower/i, icon: Bath },
  { test: /wash|laundry|dryer/i, icon: WashingMachine },
  { test: /gym|fitness/i, icon: Dumbbell },
  { test: /pool|swim/i, icon: Waves },
  { test: /desk|work/i, icon: Wind },
  { test: /bed|linen|pillow|blanket/i, icon: BedDouble },
  { test: /room service|housekeep|concierge|front desk/i, icon: ConciergeBell },
];

export function amenityIcon(label: string): LucideIcon {
  return RULES.find((r) => r.test.test(label))?.icon ?? Sparkles;
}
