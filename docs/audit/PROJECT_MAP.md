# Project map

Preserved 2026-09-27 from prior investigation; no new broad source reading. Canonical architecture remains outside this audit.

| Application/infrastructure | Actual responsibility | Existing evidence |
| --- | --- | --- |
| apps/api | NestJS modular monolith; booking/payments/auth/tenancy/platform/integrations and workers | app.module.ts; [architecture](../architecture/overview.md) |
| apps/web | Next auth, tenant/property dashboard, platform admin, payment return | [screen inventory](UI_UX_AUDIT.md#application-and-screen-inventory) |
| apps/wordpress-plugin | Guest search/selection/details/review/payment/status/cancel; Elementor, pairing/updater | Plugin Frontend/Admin/Core paths; UI report |
| packages/domain-contracts | PMS/payment/mail/storage contracts, booking/money types; billing stub | src/index.ts |
| packages/shared-types and packages/ui | Context types, React primitives/tokens/shell | Package source; UI report |
| PostgreSQL / Prisma | Tenant records, RLS/constraints, operation/event history and guest-money ledger | Schema and SQL migrations |
| Redis / BullMQ | Sessions/tokens/rate limits and scheduled/integration queues | API auth/tenancy/Clock workers |
| Clock PMS+ | External operational reservations, availability/pricing and folios | [Clock architecture](../integrations/clock/architecture.md) |
| Stripe / PokPay | Guest checkout/refunds; providers currently enforce test/staging | apps/api/src/payments; live capability not inferred |
| Resend / R2 / Sentry | Email, media and optional error reporting | mail/storage/observability; ops report |

Workers live inside API; no separate worker app/direct OTA adapter/implemented paid subscription service established.

## Roles and domains

Organization is tenant; Property is hotel/site. TenantOwner, TenantAdmin and PropertyStaff use property role templates/capabilities/overrides. PlatformAdmin is a separate audience. Guests use anonymous scoped sessions and signed links; provider accounts are integration identities.

Receptionist/manager/finance/housekeeping are operational personas, not proven distinct built-in applications. Staff User and tenant Guest are separate concepts.

| Domain | Existing model/services | Boundary |
| --- | --- | --- |
| Catalog | Property, RoomType, Room, Amenity, images | Local catalog plus Clock mappings |
| Inventory | InventoryUnit, RoomAvailability, AvailabilityBlock/targets | Room-type counters vs physical-room overlap; three selling modes |
| Pricing | RatePlan, RateRule, RoomPriceOverride, CancellationPolicy, signed quotes | Local or Clock offers; snapshot gaps recorded |
| Reservations | Booking, order-reference child grouping, state machine, IntegrationOperation | No Order entity; operational stay state incomplete |
| Guests | Guest duplicate/tombstone links, ClockGuestMapping | Separate from global staff User |
| Guest money | Payment CHARGE/REFUND, PaymentProviderSession | Allocation/settlement gaps; not platform billing |
| External accounting | ClockFolio | Projection/reconciliation, not own invoice/general ledger |
| Integrations | Connection/assignment/catalog/ranking/event/manual-review models | Encrypted credentials; durable event recovery present |
| Access/operations | Membership/capability/template/assignment/override, AuditLog, Notification | UI checks complement API controls |
| Platform billing | Plan, Organization.planId, caps, BillingProvider stub | Free foundation; paid subscription/dunning planned |

## Principal paths

Guest → WordPress relay → catalog/quote → LocalPmsProvider or MultiRoomBookingService → inventory/operation → gateway → verified callback → Clock/local fulfillment → notification.

Staff → Next property/capability context → catalog/reservation/payment/guest/report APIs. Platform admin → separate routes → explicit oversight operations.

Clock SNS → verification → provider_events → BullMQ → resource fetch → hydration → reconciliation/manual review. Same-event ownership/recreation fixes do not themselves establish account binding, cross-event ordering or inventory effects.

Booking statuses: DRAFT, QUOTED, INVENTORY_REVALIDATING, PAYMENT_PENDING, PAYMENT_NOT_REQUIRED, PMS_CREATION_PENDING, PMS_CONFIRMATION_PENDING, CONFIRMED, AVAILABILITY_FAILED, PAYMENT_FAILED, PMS_UNKNOWN_RESULT, PMS_REJECTED, MANUAL_REVIEW, CANCELLED, EXPIRED. Exact graph: apps/api/src/booking/booking-state-machine.ts. Check-in/out/no-show are not distinct MUST statuses.

Payment receipt, refund settlement, PMS confirmation, inventory ownership and email delivery need independent evidence.

## Product questions

MUST supports booking sales and staff visibility. Full PMS operations (housekeeping, maintenance, room moves, services) require an owner scope decision; absence is not automatically a defect for a Clock-connected booking product. Bounded units will distinguish necessary workflows from premature modules.
