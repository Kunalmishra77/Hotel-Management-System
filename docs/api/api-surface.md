# API Surface

There is **no separate backend** — the API is **Server Actions** (mutations/forms) + **Route Handlers** under `src/app/api` (webhooks, exports, SSE, public booking engine, AI streaming). Conventions: [`.claude/rules/api-conventions.md`](../../.claude/rules/api-conventions.md). Every action: `zod validate → authorize (permission + property scope) → transaction → emit event + audit → typed Result`.

## Server Actions by module (representative — full list in each spec's `design.md`)
| Module | Key actions |
|---|---|
| 00-platform | `signIn`, `verifyTotp`, `enroll2fa`, `requestPasswordReset`, `resetPassword`, `assignRole`, `switchProperty` |
| 01-property | `createProperty`, `updateProperty`, `deactivateProperty`, `addFloor` |
| 02-room | `createCategory`, `createRoom`, `changeRoomStatus`, `blockRoom` |
| 03-reservations | `searchAvailability`, `createReservation`, `holdReservation`, `confirmReservation`, `modifyReservation`, `cancelReservation`, `reallocateRoom`, `checkIn`, `checkOut`, `createFromChannel`, `markNoShows` |
| 04-guest | `createGuest`, `updateGuest`, `addGuestId`, `revealPii`, `mergeGuests`, `exportGuestData`, `eraseGuest` |
| 06-billing | `ensureFolio`, `ensureDirectSaleFolio`, `postFolioCharge`, `postRoomCharges`, `reverseFolioLine`, `applyDiscount`, `recordPayment`, `refund`, `startOnlinePayment`, `generateInvoice`, `voidInvoice`, `settlePosSaleDirect`, `corporateReceivable` |
| 07-expenses | `createExpense`, `approveExpense` |
| 09/21 | `createStaff`, `recordAttendance` / `generateRun`, `adjustLine`, `finalizeRun` |
| 10/11 | `updateTaskStatus`, `syncOfflineUpdates` / `createJob`, `closeJob`, `blockRoomForJob` |
| 12-comms | `manageTemplate`, `manageAutomation`, `launchCampaign`, `sendManual` |
| 13-channels | `connectChannel`, `mapRoomType`, `activateChannel`, `processInboundReservation` |
| 14-analytics | `runNightAudit`, `dashboardTiles` |
| 15-search | `search`, `export` |
| 16-security | `createUser`, `assignRole`, `setPermissionOverride`, `triggerBackup`, `forceLogout` |
| 18-ai | chat, `nlSearch`, `classifySentiment`, `forecast`, `suggestRates`, `segment` |
| 19/20 | `createOrder`, `settleToFolio`, `settleDirect`, `voidOrder` / `recordMovement` |
| 22/24/25 | `configureAccounting` / `runPricingEngine`, `approveRate` / `createCorporate`, `reserveCredit`, `releaseCredit`, `getNegotiatedRate`, `setNegotiatedRate` |

## Route Handlers (`src/app/api/…`)
| Route | Purpose | Auth |
|---|---|---|
| `/api/auth/*` | Auth.js endpoints | public/session |
| `/api/webhooks/payments/{provider}` | payment capture | **signature-verified** + inbox dedupe |
| `/api/webhooks/messaging/{provider}` | delivery status / opt-out / feedback | signature-verified |
| `/api/webhooks/channels/{provider}` | inbound OTA reservations | signature-verified |
| `/api/realtime` | SSE (LISTEN/NOTIFY) live occupancy/sync | session, permission/property-filtered |
| `/api/exports/*` | Excel/PDF/CSV downloads | session + `export:*` |
| `/api/booking-engine/v1/{slug}/*` | **public** availability + book-and-pay | unauthenticated, **rate-limited**, bot-protected |
| `/api/ai/*` | chatbot / NL-search streaming | session + `ai:use` |

## Cross-cutting rules
- Typed `Result` (`{ok, data}` | `{ok:false, error}`); never throw raw to the client; user-safe error codes (each spec has an error catalog).
- Cursor pagination; no unbounded result sets (NFR).
- Idempotency keys on externally-triggered operations; webhooks verify signatures before any side effect.
- Realtime/SSE payloads carry no PII beyond need.
