/**
 * Resolves the icon name a NavItem declares to a lucide component.
 *
 * navigation.ts stays pure data (unit-testable, no JSX); the mapping to actual
 * components lives here in the UI layer.
 */
import {
  Banknote,
  BedDouble,
  Bot,
  Briefcase,
  Building2,
  Cable,
  CalendarDays,
  ChartColumn,
  Gauge,
  Globe,
  IdCard,
  Landmark,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Package,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  UtensilsCrossed,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Building2,
  BedDouble,
  CalendarDays,
  Users,
  Sparkles,
  Wrench,
  Receipt,
  Wallet,
  ChartColumn,
  Gauge,
  IdCard,
  Search,
  Settings,
  ShieldCheck,
  MessageSquare,
  Bot,
  Cable,
  Globe,
  TrendingUp,
  UtensilsCrossed,
  Package,
  Banknote,
  Landmark,
  Briefcase,
  Upload,
  MoreHorizontal,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? MoreHorizontal;
  return <Icon className={className} aria-hidden="true" />;
}
