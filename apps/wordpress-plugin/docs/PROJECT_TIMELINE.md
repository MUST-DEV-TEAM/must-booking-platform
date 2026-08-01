# Project Timeline

This is a concise evidence-backed history, not a task diary. Dates, tags, and results come from repository history; deployment to production is not implied. Use Git for exact implementation detail.

| Date or range | Event | Why it mattered | Result and current relevance | Confidence |
|---|---|---|---|---|
| 2026-03-12 | Repository initialized and plugin foundation added. | Established the WordPress plugin, bootstrap, and initial data/UI direction. | Starting point for all current code. | Verified |
| 2026-03-13 to 2026-03-19 | Public booking, Stripe environment, inventory/availability, checkout, email, pricing, reservation admin, and activity logging were established. | Created the first end-to-end local booking/payment surface and operational visibility. | Many current services and conventions trace to this phase, but later provider/payment work superseded behavior. | Verified |
| 2026-03-24 to 2026-03-27 | Reports, staff portal routing, Elementor widgets, booking calendar, and date-picker work landed; tagged releases reached `v0.3.27`. | Expanded the plugin from public booking into staff operations and page-builder integration. | `/staff`, portal modules, widgets, and managed booking UI remain compatibility surfaces. | Verified |
| 2026-03-28 to 2026-04-09 | Accommodation/admin workflows, guarded demo-data reset, managed staff accounts, responsive public flow, and a large `0.3.45`-era manual set evolved through the 0.3 train. | Operational scope grew rapidly and documentation first became comprehensive. | The manuals later became stale; useful durable content was consolidated in 2026-07. | Strongly supported |
| 2026-04-19 | `v0.4.0` introduced provider abstraction and Clock PMS support. | Added a second source of inventory/reservation truth and cross-system synchronization. | Provider interfaces, Clock mappings/mirrors/logs/jobs, inbound sync, and provider-aware actions remain central architecture. | Verified |
| 2026-04-23 to 2026-05-06 | Clock WBE inline and direct Clock setup/catalog/availability/booking support matured through `v0.4.1` to `v0.4.4`. | Separated embedded Clock booking from direct API-backed plugin booking. | Both integration modes remain visible; exact historical provider behavior requires Git. | Strongly supported |
| 2026-05-18 | PokPay implementation landed and `v0.4.5` was released. | Added a second online payment gateway and new callback/refund concerns. | PokPay SDK-order verification and merchant refund paths remain supported. | Verified |
| 2026-05-26 to 2026-06-03 | Rapid Clock synchronization, calendar, WBE, and portal releases continued through `v0.4.70`. | Broadened provider and operations coverage. | Many release messages are generic; exact changes must be recovered from commits rather than inferred. | Partially supported |
| 2026-06-10 to 2026-06-12 | Stripe/PokPay/Clock payment and folio accounting work consolidated around `v0.4.71`, `v0.4.74`, `v0.4.75`, and `v0.4.76`. | Began separating gateway truth, local ledger state, cancellation, refund, and Clock accounting. | Current money workflows retain distinct state planes and repair logic. | Verified |
| 2026-06-13 to 2026-06-18 | `v0.4.77` to `v0.4.82` added readiness/E2E tools, SNS inbound handling, lifecycle-routed provider status, refund review, amendments, cancellation financial snapshots, and accounting hardening. | Addressed cross-system retry, cancellation, and manual-review boundaries. | Durable processing/review rules remain current; repository evidence still recorded blocked real Clock acceptance. | Verified |
| 2026-06-19 to 2026-06-22 | Clock contract research was refreshed; automatic accommodation-charge cleanup/cancellation-fee posting stayed manual; deposit-folio diagnostics and PokPay credential evidence were hardened. | Prevented generic provider charge endpoints from being treated as safe automatic revenue mutation. | These safety boundaries remain accepted in ADR-0003. Dated research is not a current provider contract. | Verified |
| 2026-06-23 | `v0.4.85` added performance instrumentation, signed quote drafts, bounded work, safe Clock caches, and fresh final availability/price/guarantee validation. | Balanced public latency against oversell and stale-price risk. | Final live revalidation remains a core booking invariant; cancellation-policy comparison is incomplete. | Verified |
| 2026-06-24 | `v0.4.86` corrected Clock deposit verification for signed raw balances and normalized held amount. | Aggregate booking balance could not prove isolated website deposit accounting. | Current accounting rules require deposit folio isolation and standard-folio stability. | Verified |
| 2026-07-06 | `v0.4.87` added public calendar/payment display options, payment-policy defaults, and bidirectional Clock/website reference mapping. | Improved configurable public UX and cross-system traceability. | These display and reference contracts remain current. | Verified |
| 2026-07-07 | `v0.4.88` split Clock catalog, availability/rate, and reservation fallback schedules and diagnostics. | One schedule/last-run indicator could not express ownership or health. | Separate cron hooks and source-of-truth boundaries remain current. | Verified |
| 2026-07-10 to 2026-07-12 | Confirmation-integrity Phase 1/2 was developed on `codex/` branches. | Proposed immutable verification ownership, centralized authorization, attempt binding, and stronger schema. | Branch heads are not ancestors of current `main`; these controls are unreleased evidence/future work, not mitigation. | Verified branch state |
| 2026-07-12 | `v0.4.89` moved current-main Clock online booking to payment-first fulfillment. | Standard online flow should not create Clock inventory before authoritative payment. | Pending local mirrors now precede payment and Clock creation follows verified payment; durable paid-outcome/concurrency recovery gaps remain. | Verified |
| 2026-07-13 | `v0.4.90` fixed Linux-compatible release packaging. | Release assets must be portable and match updater expectations. | This established the historical `0.4.90` package baseline. | Verified |
| 2026-07-13 | Repository documentation was consolidated around current code/history evidence. | Forty-five overlapping tracked Markdown files included stale `0.3.45` manuals and pre-payment-first lifecycle claims. | Canonical docs now own current truth; temporary future cleanup phases live only in the consolidation plan. | Verified by current change |
| 2026-07-15 to 2026-07-17 | The `0.4.92` release candidate integrated confirmation/access controls, payment/refund integrity fixes, PHP 7.4 compatibility, and official Clock transport/accounting hardening. | Closed known IDOR, forged-return, duplicate-write, policy, and balance-only accounting gaps before environment acceptance. | Local lint and 42 standalone tests pass; WordPress/database/provider E2E remains pending. | Working-tree evidence |

## Historical cautions

- Tags are not continuous. Notable gaps include `v0.4.72`, `v0.4.73`, `v0.4.80`, and `v0.4.84`; tag `0.4.18` lacks the usual `v` prefix.
- Release metadata now agrees on `0.4.92`; a tag/package and deployment acceptance are still separate release evidence.
- `codex/p0-confirmation-integrity-phase1` and `codex/p0-payment-first-phase2` point to `b5b8fbf` and do not contain current `main` HEAD. Their docs/code are branch-owned and unreleased.
- Historical Clock/Postman/sandbox evidence proves only the dated observation. The official Clock API contract was refreshed on 2026-07-17, but account-specific acceptance remains pending.
- Repository tags and tests do not prove which release reached production or whether production schema, callbacks, cron, provider rights, backups, or E2E acceptance passed.

## Current significance

The dominant architectural direction is:

1. Local WordPress presentation/workflow plus interchangeable local/Clock provider boundaries.
2. Gateway/local-ledger payment truth separated from reservation and Clock folio state.
3. Fresh final provider revalidation with limited intermediate caching.
4. Payment-first Clock creation for online booking.
5. Manual review for financial/provider outcomes that cannot be proved safe and idempotent.

Current code has not fully achieved the security and atomicity implied by those directions. See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md), [DOMAIN_LIFECYCLES.md](DOMAIN_LIFECYCLES.md), and the temporary [REPOSITORY_CONSOLIDATION_PLAN.md](REPOSITORY_CONSOLIDATION_PLAN.md).
