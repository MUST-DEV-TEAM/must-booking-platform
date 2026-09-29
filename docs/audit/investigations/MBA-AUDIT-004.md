# MBA-AUDIT-004 — challenge of MBA-011

**Astra disposition (2026-09-27): COMPLETE.** Accepted the missing local checkout/payment binding as VERIFIED FINDING and narrowed MBA-011 to HIGH/NOW. Sol's proposed CRITICAL pre-live gate is preserved below as its recommendation, not the final severity: authenticating a synthetic payload does not establish an attacker-controlled Stripe event, deployed exploitability or monetary loss. The separate endpoint-topology risk remains conditional. No product correction was implemented.

Audit-only review, 2026-09-27. Scope: Stripe checkout credential/session creation through raw-body signature verification, normalized event, local charge, and schema binding. This is a proposed disposition for Astra, not acceptance or a product change. No live provider, database, deployment, or secret probe was made.

## Verdict

**VERIFIED FINDING (source/control flow):** The signed Stripe event is not bound to the tenant Stripe connection or the Checkout session created for the booking. Checkout resolves a property-assigned tenant secret and sends `mode: payment`, booking reference/metadata, and one line item in the requested amount/currency (`apps/api/src/payments/stripe-payment.provider.ts:38-84,215-227`). The public webhook controller supplies a placeholder context (`stripe-webhook.controller.ts:18-22,36-47`); verification discards it, requires the server's `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and verifies the raw body with that one signing secret (`stripe-payment.provider.ts:100-125`). The installed SDK's `stripe/cjs/Webhooks.js:10-31,73-83` verifies the payload HMAC with the supplied webhook secret; the API secret used to construct the SDK client is not consulted by that verification routine. A valid signature proves possession of this configured endpoint secret, not that the session came from the particular connection used at checkout. The source does not show an account lookup after verification.

**VERIFIED FINDING (source/control flow):** For completed/async-succeeded events, normalization checks only nonempty `tenantId`, `propertyId`, `bookingId` metadata and `session.id`, then retains event ID/type, session ID, metadata and `payment_status` (`stripe-payment.provider.ts:128-157`; `packages/domain-contracts/src/index.ts:347-355`). The controller processes only the two allowed event types with `paymentStatus === 'paid'` (`stripe-webhook.controller.ts:49-59`). Neither layer compares session ID to an issued local session, tenant/property/booking metadata to a connection or checkout record, `client_reference_id`, `mode`, `payment_intent`, `amount_total`, `currency`, event `livemode`, or event account. This is a missing local acceptance check, not a claim that Stripe itself produces inconsistent events.

**VERIFIED FINDING (source/control flow):** Stripe checkout returns `{id,url}` without a Stripe session insert. Both the single-booking and multi-room callers insert `payment_provider_sessions` only for PokPay (`local-pms.provider.ts:548-566`; `multi-room-booking.service.ts:199-217`). The table can hold provider, tenant, property, booking and external session ID, but has no connection/account, expected amount/currency, payment intent or environment columns (`apps/api/prisma/schema.prisma:637-650`). In contrast, PokPay joins its issued session, checks the booking payment method, re-reads the provider order, and compares ID/amount/currency/paid state (`apps/api/src/payments/pokpay-payment.service.ts:47-92`). The MBA-011 wording “Stripe sessions are not persisted as PokPay sessions are” is accurate; it should clarify that the existing shared table is simply not used by the Stripe paths.

The Stripe handler scopes the booking query by all three metadata IDs and locks the row, but does not check `booking.paymentMethod === STRIPE_CHECKOUT` or a session/connection/amount/currency binding (`stripe-webhook.service.ts:50-72,114-145`). It inserts a `PAID` charge for the **current local booking or order total and rate-plan currency**, not values read from the signed session (`:58-63,128-136`). An expired booking is likewise recorded as `LATE_AFTER_EXPIRY` at the local total and submitted for refund at that amount (`:73-113`). `continueAfterPayment` checks booking status and proceeds with fulfillment, without a provider check (`local-pms.provider.ts:790-817`). The ledger's `UNIQUE (tenant_id, external_payment_id)` and `ON CONFLICT ... DO NOTHING` prevent a repeat session ID from inserting twice within the same tenant (`schema.prisma:615-634`; `stripe-webhook.service.ts:128-139`); they do not bind the first event to the issued checkout, and the uniqueness key omits provider/account.

The canonical booking/payment overview currently says Stripe verifies against the connection and payment details (`docs/architecture/booking-and-payments.md:56`); that statement needs correction after this audit is adjudicated. No canonical document was edited in this bounded unit.

## Counterevidence and exposure limits

- Missing or tampered signatures are rejected. `main.ts:60` enables Nest's raw body, and the controller rejects an absent raw body (`stripe-webhook.controller.ts:36-46`). The focused provider spec asserts valid signature acceptance and missing/tampered rejection (`stripe-payment.provider.spec.ts:100-145`). An arbitrary unsigned internet request cannot exploit the metadata fields through this endpoint.
- `checkout.session.completed` with `payment_status` other than `paid` is acknowledged without a charge; `checkout.session.async_payment_succeeded` is processed only when `paid`. Other event types are ignored (`stripe-payment.provider.ts:128-135`; `stripe-webhook.controller.ts:49-59`). No claim of accepting a signed but unpaid session is supported.
- The booking must exist under the signed metadata's tenant and property and be `PAYMENT_PENDING` or `EXPIRED`; other states require a prior payment with the same external session ID or return a failure (`stripe-webhook.service.ts:58-72,73-125`). The booking lookup and database relations limit misrouting; they do not establish that this account/session paid this booking.
- Checkout and refund reject tenant credentials without an `sk_test_` prefix (`stripe-payment.provider.ts:42-49,160-173`); the connection tester also rejects them (`stripe-connection-tester.ts:18-27`). This constrains this application's newly created charges and refunds to test keys at present. Webhook verification only checks that the *platform* API secret is nonempty and the signing secret validates; it has no `livemode` gate (`stripe-payment.provider.ts:100-157`). A signed live-mode payload is therefore accepted by code, but actual live webhook routing/capture and deployed exposure were not established. `checkHealth`'s platform key use is diagnostic (`stripe-payment.provider.ts:23-36`), not proof of checkout account identity.
- The existing end-to-end Stripe test signs a synthetic paid session carrying ID/metadata/payment status but no amount, currency, payment intent, mode or livemode, then expects a charge for the booking total (`apps/api/test/local-pms-provider.e2e.spec.ts:1074-1133`). That supports the current local-ledger behavior, not real Stripe event/account behavior. This audit did not run the DB test.

**LIKELY FINDING (integration viability):** With separate tenant Stripe accounts and independently configured endpoint signing secrets, this single configured secret can verify only deliveries signed for that configured endpoint. Which account(s) actually send to `/webhooks/stripe`, how endpoints are provisioned, and whether a shared organizational/Connect arrangement is intended are **NEEDS VERIFICATION**. Avoid the categorical MBA-011 statement that independent accounts “cannot generally share one endpoint signing secret” until the approved account/webhook topology is documented and checked.

**NEEDS VERIFICATION (adverse payment outcome):** A mismatch capable of recording an underpaid or wrong-account charge requires a validly signed event with metadata pointing to a known pending booking, and session details inconsistent with its issued checkout. The source would accept such an event, but this review did not establish who can cause Stripe to emit it for the configured endpoint, whether any tenant controls that account's Checkout metadata, or whether a real payment was miscredited. Do not describe a public arbitrary-metadata bypass or deployed monetary loss as verified.

## Offline checks

`pnpm exec vitest run src/payments/stripe-payment.provider.spec.ts` from `apps/api`: **exit 0; 1 test file, 4 tests passed**. These are focused signature/refund/health unit tests, with mocked outbound calls; they do not test the missing binding.

The following PowerShell command was run from `apps/api`. It imported the real provider/controller and installed Stripe SDK, generated local test signatures, used fake dependencies, and did not boot Nest or call a provider/database/network. It set and restored only process-local fake Stripe environment values; no `.env` was loaded. The fake webhook handler records calls, so the probe does **not** demonstrate a database charge or real Stripe delivery.

```powershell
@'
import Stripe from 'stripe';
import { StripePaymentProvider } from './src/payments/stripe-payment.provider.ts';
import { StripeWebhookController } from './src/payments/stripe-webhook.controller.ts';

const priorKey = process.env.STRIPE_SECRET_KEY;
const priorSecret = process.env.STRIPE_WEBHOOK_SECRET;
process.env.STRIPE_SECRET_KEY = 'sk_test_offline_platform';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_offline_endpoint';
try {
  let credentialReads = 0;
  const provider = new StripePaymentProvider({
    activePaymentConnectionCredentials: async () => { credentialReads += 1; return { secretKey: 'sk_test_offline_tenant' }; },
  });
  const processed = [];
  const controller = new StripeWebhookController(provider, {
    processPaymentSucceeded: async (event) => { processed.push(event); return { ok: true, value: { duplicate: false } }; },
  });
  const base = {
    id: 'evt_offline_1', object: 'event', type: 'checkout.session.completed', livemode: true,
    data: { object: {
      id: 'cs_unbound_1', object: 'checkout.session', mode: 'subscription',
      payment_status: 'paid', amount_total: 1, currency: 'usd', payment_intent: 'pi_unbound_1',
      client_reference_id: 'other-reference', metadata: {
        tenantId: '11111111-1111-4111-8111-111111111111',
        propertyId: '22222222-2222-4222-8222-222222222222',
        bookingId: '33333333-3333-4333-8333-333333333333',
      },
    } },
  };
  for (const paymentStatus of ['paid', 'unpaid']) {
    const event = structuredClone(base);
    event.data.object.payment_status = paymentStatus;
    const payload = JSON.stringify(event);
    const signature = new Stripe('sk_test_unrelated_key').webhooks.generateTestHeaderString({
      payload, secret: 'whsec_offline_endpoint',
    });
    const verified = await provider.verifyWebhookEvent({
      tenantId: '00000000-0000-4000-8000-000000000000',
      propertyId: '00000000-0000-4000-8000-000000000000',
    }, Buffer.from(payload), signature);
    const response = await controller.receive(signature, { rawBody: Buffer.from(payload) });
    console.log(JSON.stringify({ paymentStatus, verified, response, processedCount: processed.length, credentialReads }));
  }
} finally {
  if (priorKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = priorKey;
  if (priorSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = priorSecret;
}
'@ | node --import=tsx --input-type=module
```

Result: exit 0. The `paid` payload normalized to `{id:'evt_offline_1',type:'checkout.session.completed',externalPaymentId:'cs_unbound_1',tenantId,propertyId,bookingId,paymentStatus:'paid'}` and produced `{received:true}`, `processedCount:1`, `credentialReads:0`. The identically signed `unpaid` payload produced `{received:true}`, `processedCount:1`, `credentialReads:0`. This is a local acceptance-boundary counterexample only: `mode: subscription`, `livemode: true`, one cent/USD, unrelated client reference and payment intent were deliberately supplied; it says nothing about a Stripe-generated event's validity or a committed booking.

## Suggested MBA-011 edit and next evidence

Retain **CRITICAL/NOW as a pre-live design and repair gate**, qualified by present test-mode checkout enforcement and unverified deployed exposure. Mark the missing session/connection/amount/currency/mode/environment binding **VERIFIED FINDING** at source/control-flow level. Mark independent-account delivery failure **LIKELY FINDING** conditional on endpoint topology; mark actual underpayment, cross-tenant misuse and real-money loss **NEEDS VERIFICATION**. Replace the register's categorical shared-secret claim with the narrower configured-secret/topology statement above. Keep MBA-001's transaction rollback as a separate issue.

**RECOMMENDATION:** Define the owner-approved Stripe account/webhook model first. Persist issued Stripe session ID with tenant/property/booking, immutable connection/account identity, expected amount/currency and environment before exposing the redirect; correlate each signed event to that row, require Stripe booking method and paid state, compare session and event details including mode/reference/payment intent as appropriate, and define recovery for callbacks arriving before commit. Use an opaque route or another trustworthy source to choose the correct signing secret before reading metadata as routing authority. Design idempotency over both event ID and session/payment identity, with handling for legitimate async events and multiple issued sessions. This is design guidance, not an implementation decision or a claim that every Stripe field is always present.

Next evidence: a redacted configuration map of deployed Stripe account(s), webhook endpoint(s), signing-secret ownership and enabled event types; owner-approved account model; then isolated DB/controller tests for paid/unpaid/async, wrong session/booking method/amount/currency/mode/environment, replay and expired flows, followed by approved Stripe sandbox checks of actual event shapes and delivery. No provider calls or secrets are authorized by this audit unit.

## Review/checkpoint boundary

The worker saved this report before a usage-limit interruption prevented its final follow-up. Its exact focused test command, count and offline probe are retained above. Astra inspected `apps/api/vitest.config.ts`: it configures timeouts and does not register setup/global-setup hooks. Astra did not rerun the unit tests or probe and does not claim independent runtime reproduction. This review accepts the bounded source/acceptance gap, not any externally generated event or committed financial consequence.
