# UI Foundation & Design System

The shared visual/interaction foundation every module's UI inherits. This is a **UI-heavy, mobile-first** product used by non-technical staff — consistency and speed matter. Governing rule: [mobile-first.md](../../.claude/rules/mobile-first.md).

## Stack
- **Tailwind CSS** + **shadcn/ui** (Radix primitives — accessible by default). CSS variables for theming ([`components.json`](../../components.json), [`tailwind.config.ts`](../../tailwind.config.ts)).
- Icons: `lucide-react`. Charts: `recharts`. Forms: `react-hook-form` + `zod`. Tables: `@tanstack/react-table`.

## Design tokens (CSS variables in `src/styles/globals.css`)
- Color roles: `--background/--foreground`, `--primary`, `--muted`, `--destructive`, `--border/--input/--ring` (light + dark). One brand primary; status colors map to room/booking states.
- **Status color map** (used on room board, reservation cards, tiles): Vacant=green, Occupied=red, Reserved=amber, Housekeeping=orange, Under-Maintenance=violet. Defined once; reused everywhere (no ad-hoc colors).
- Spacing/radius/typography scale from Tailwind; `min-h-touch` (44px) for tap targets.

## Shared components (`src/components/`)
| Group | Components |
|---|---|
| `ui/` | Button, Input, Select, Dialog, Sheet (bottom-sheet), Badge, Card, Tabs, Toast, Skeleton (shadcn) |
| `forms/` | FormField, MoneyInput (paise-aware, ₹), DateRangePicker, OccupancyPicker, PhoneInput |
| `tables/` | DataTable (paginated, cursor), collapses to cards on mobile |
| `cards/` | ReservationCard, RoomChip, GuestCard, StatTile |
| `charts/` | TrendChart, OccupancyBar (recharts; brand-neutral categorical palette, AA contrast) |
| `layout/` | AppShell, BottomNav (permission-filtered), PropertySwitcher, PageHeader |
| `mobile/` | ConnectivityBadge, SyncStatus, InstallPrompt, OfflineBanner (from 17) |

## Patterns (consistency rules)
- **Mobile-first**: base styles target phone; enhance up. Tables → cards on small screens.
- **Money**: always via `MoneyInput`/`formatINR` — never raw number formatting; internal paise, display ₹.
- **Forms**: numeric `inputmode` for amounts, `tel`/`email` types; inline zod validation; primary action ≥44px, thumb-reachable.
- **Optimistic UI** for common mutations (status change, add charge) with server reconcile.
- **Empty/loading/error states** required on every data view (Skeleton + friendly empty + error with retry).
- **Accessibility**: WCAG AA contrast, semantic HTML, visible focus, keyboard + screen-reader — inherit Radix defaults, don't undo them.

## Theming & i18n
- Light/dark via CSS variables. Copy is centralized (message templates + UI strings) so **localization** (English + Hindi/regional) can be added without touching components — templates already carry `language`.

## How modules use this
Feature UIs (`features/*/components`) compose these shared components only; they don't restyle primitives. New shared patterns are added here, not duplicated per module. Wireframes in each spec's `design.md` map to these components.
