# MBA-AUDIT-008 — charge and order allocation challenge

**Astra disposition (2026-09-27): COMPLETE.** Accepted HIGH/NOW MBA-014 for reachable manual-installment reversal, sibling whole-order recording and non-first-child order-cancellation refund selection. The two offline service cases use fake SQL projections; the missed-refund case is source-traced, with no committed database or provider result. Corrected the recommendation to preserve pending/unknown refund reservations: blocking another attempt while an outcome is unresolved is not itself a defect. No product correction was implemented.

2026-09-27. Audit-only challenge of [MBA-014](../FINDINGS.md#mba-014--refunds-and-manual-group-payments-lack-charge-level-and-order-level-allocation), with the narrow pending-refund implication from [unit 007](MBA-AUDIT-007.md). Owner-authorized exception to the active milestone table; no product change. Paths below are relative to `C:/Users/devim/Desktop/Must-Booking/`: `R` = `apps/api/src/payments/payment-refund.service.ts`, `M` = `apps/api/src/payments/manual-payment.service.ts`, `MC` = `apps/api/src/payments/manual-payment.controller.ts`, `O` = `apps/api/src/booking/multi-room-booking.service.ts`, `L` = `apps/api/src/booking/local-pms.provider.ts`, `S` = `apps/api/prisma/schema.prisma`. Read repository instructions, docs router, roadmap, ADR index/ADR-0018, booking/payments architecture, audit status/handoff/queue and only the MBA-014 finding plus unit 007. Existing dirty worktree was preserved.

## Adjudication

**MBA-014 remains a VERIFIED FINDING, HIGH/NOW for local allocation/control-flow; actual external money movement NEEDS VERIFICATION.** The original two-installment example is reachable through ordinary staff API use on a positive-total, `PAY_AT_HOTEL` confirmed booking: `MC:67-86` accepts a positive amount and staff method; `M:45-82` allows a partial amount unless status is `PAYMENT_PENDING`, and `M:83-125` records the charge. `O:126-185` and `O:362-398` establish that an enabled pay-at-hotel multi-room order reaches confirmed children without a gateway charge; the single-booking path has the same selected method rule (`L:1840-1881`). The retained `local-pms-provider.e2e.spec.ts:2223-2239` actually exercises a partial pay-at-hotel manual charge. It does not exercise two installments or the defect below.

For a single booking priced EUR 100, two ordinary staff calls with different idempotency keys can record EUR 40 followed by EUR 60: `M:55-73,83-102,160-169` sums previous successful charges for that booking and allows the balance. `R:453-467` selects the latest eligible charge, here EUR 60; `R:470-481` sums *all* refund rows for the booking, without a charge ID. The first no-amount manual refund computes EUR 60, and a second call finds the same latest charge and computes zero remaining (`R:270-306`), returning `REFUND_NOT_AVAILABLE` despite the older EUR 40 charge. A prior EUR 40 refund against an older charge would instead reduce this latest-charge balance to EUR 20. The provider target is the selected charge's `externalPaymentId` (`R:169-177`); it cannot infer the missing allocation. Manual charges/refunds use `succeeded`/`REFUNDED`; gateway charges use `PAID` (`M:160-167`, `R:270-274`). `refundPaidChargeForBooking` on automatic single cancellation selects only `PAID` (`R:108-120`), so the two-manual-charge case is a staff refund problem, not an automatic-cancellation reproduction.

**Group settlement is a second VERIFIED local gap.** `O:126-159` gives every child the same `order_reference`; `O:199-215` anchors a gateway checkout to the first child for the sum of room totals. `M:136-150` computes the full order sum for *any* selected child and locks only `b`, that selected row. `M:162-168` then sums successful charges only for `booking_id =` that child; there is no order-wide aggregation or parent/order lock. The endpoint takes any child booking ID and requires staff `bookings.manage` (`MC:67-86`). For a local-only, enabled pay-at-hotel two-room order of EUR 50 + EUR 50, a call on child A with omitted amount records EUR 100, and a call on child B with a new key records another EUR 100. After an online order's EUR 100 gateway charge on child A, the confirmed child B similarly appears unpaid to this API and permits a EUR 100 manual record; the service does not restrict that booking's original `payment_method`. These are duplicate *local settlement records* upon staff assertion of collection. The manual endpoint itself does not charge an external card, so the probe does not prove duplicate cash collection or bank settlement. Same-child calls are serialized by `FOR UPDATE OF b` and checked against that child's paid sum (`M:136-169`); idempotency protects replay of the same key (`M:178-220`), but neither prevents distinct-key sibling calls.

**The same missing canonical order anchor causes a further VERIFIED missed-refund path.** `L:1025-1028` routes a cancellation for any order child to `cancelMultiRoomOrder` with the *requested row* as `anchor`; `L:1141-1163` loads/locks all children. After eligible children are cancelled, it sums their refundable totals (`L:1235-1251`) but calls `refundPaidChargeForBookingAmount` with `anchor.id` (`L:1253-1261`). Online checkout placed its one aggregate charge on the first child (`O:199-215`). If a staff or authorized guest request names a different child of a local-only fully paid and free-cancellable order, `R:126-135` finds no `PAID` charge on that requested child and returns `{ok:true,value:null}`. `L:1262-1267` consequently records neither a refund failure nor a confirmation; the cancellation path can still return the cancelled child (`L:1270-1277`). This is a source-proven omitted refund attempt, conditional on the order's cancellation/state/session gates (`L:1173-1199`) and successful transaction. Existing `multi-room-booking.e2e.spec.ts:664-689` cancels via the **first** child and demonstrates the happy-path anchor refund only; no sibling-initiated cancellation test was found in that bounded file. Actual provider balance and guest payout were not observed.

**Unit 007 implication, kept separate:** `R:175-187` records a `REFUNDED` row when a provider returns `Result.ok` even with pending status, as [unit 007](MBA-AUDIT-007.md) proved. `R:470-481` sums that row with settled refunds, so the local ledger cannot distinguish a completed refund from an amount still pending or of unknown outcome. Its amount does need to remain reserved against another refund attempt until authoritative settlement or failure/cancellation is known; temporarily blocking another refund is not independently a defect. The defect here is the absent per-charge/order allocation, compounded by unit 007's lost refund state and reconciliation path. No provider settlement or lifecycle/transport claim is reaudited here.

## Constraints and counterevidence

`S:528-582` has per-booking amounts and a shared order reference/index, with no order/parent payment aggregate. `S:615-634` stores positive `NUMERIC(12,2)` payments with tenant/property/booking FK, tenant/external-ID uniqueness and a booking/created-at index, but no original-charge or order-allocation FK. The original payments migration enforces `amount > 0` and ISO-shaped currency (`apps/api/prisma/migrations/20260730090000_payments_ledger/migration.sql:9-35`); the order migration adds a positive room number check and index (`apps/api/prisma/migrations/20260814120000_multi_room_booking_order/migration.sql:7-21`). These constraints preserve important local integrity but do not cap summed child payments to an order total or connect refund rows to charges. `R:550-560` and `M:223-233` use bigint minor-unit arithmetic over decimal strings; this investigation makes no floating-point-precision allegation. The refund code caps a *requested* amount to its computed remaining balance (`R:291-305`), and automatic group refund checks its requested total against remaining (`R:135-149`); these guards do not choose an older charge or discover the first child from a sibling ID.

Payment method and status narrow the examples. `PAYMENT_PENDING` requires one manual payment to settle the selected booking's computed full balance (`M:75-82`) and then fans out group fulfillment (`M:112-124`, `L:790-799,874-929`); the ordinary two-installment example instead uses an already confirmed pay-at-hotel booking. Group creation requires at least two rooms and a single currency (`O:238-275`); nonzero pay-at-hotel requires the property's enablement (`O:362-398`). Gateway checkout normally writes its one charge on child one, while a pay-at-hotel order has no initial gateway charge. These paths are not evidence that an arbitrary external guest or anonymous caller can record payments.

## Offline real-function probe

From `apps/api`, ran `node --import=tsx -e $probe` with the following PowerShell literal here-string. The first draft failed before execution (exit 1, `SyntaxError: missing ) after argument list`) because PowerShell's native argument passing stripped a nested double-quoted JS fragment. This corrected script exited 0. Its fake SQL returns two preexisting charge rows ordered newest first and supplies an order-total projection for each confirmed sibling; it invokes real `manualRefund` and `record` methods. No database, provider, Redis, app boot or environment file was accessed.

```powershell
$probe = @'
const { PaymentRefundService } = require('./src/payments/payment-refund.service.ts');
const { ManualPaymentService } = require('./src/payments/manual-payment.service.ts');
const ctx={tenantId:'11111111-1111-4111-8111-111111111111',propertyId:'22222222-2222-4222-8222-222222222222'};
const a='33333333-3333-4333-8333-333333333333', b='44444444-4444-4444-8444-444444444444';
const audit={recordInTransaction:async()=>{}};
const refunds=[];
const refundTx={
  $queryRaw:async (parts,...values)=>{
    const sql=parts.join('?');
    if(sql.includes('INSERT INTO integration_operations')) return [{requestHash:'mock'}];
    if(sql.includes('SELECT id FROM bookings')) return [{id:a}];
    if(sql.includes('FROM payments') && sql.includes('CHARGE')) return [
      {id:'charge-2',provider:'manual',externalPaymentId:'manual:charge:2',amount:'60.00',currency:'EUR',status:'succeeded'},
      {id:'charge-1',provider:'manual',externalPaymentId:'manual:charge:1',amount:'40.00',currency:'EUR',status:'succeeded'}
    ];
    if(sql.includes('FROM payments') && sql.includes('REFUND')) return [{amount:refunds.reduce((n,x)=>n+x,0).toFixed(2)}];
    if(sql.includes('INSERT INTO payments')) { refunds.push(Number(values.find(v=>typeof v==='string' && /^\d+\.\d{2}$/.test(v)))); return [{id:'refund-'+refunds.length}]; }
    if(sql.includes('FROM bookings b')) return [];
    throw Error('unhandled refund SQL '+sql);
  },
  $executeRaw:async()=>1
};
const refundService=new PaymentRefundService({withTenantTransaction:async(_ctx,fn)=>fn(refundTx)},audit,{}, {}, {recordInTransaction:async()=>{}}, {}, {});
refundService.syncManualRefundToClock=async()=>{};
const refundCommand=(key)=>({bookingId:a,idempotencyKey:key,actorUserId:b});
(async()=>{
  const first=await refundService.manualRefund(ctx,refundCommand('refund-one'));
  const second=await refundService.manualRefund(ctx,refundCommand('refund-two'));
  const recorded=[];
  const paymentTx={
    $queryRaw:async(parts,...values)=>{
      const sql=parts.join('?');
      if(sql.includes('INSERT INTO integration_operations')) return [{requestHash:'mock'}];
      if(sql.includes('FROM bookings b')) return [{id:values.find(v=>v===a||v===b),totalAmount:'100.00',currency:'EUR',status:'CONFIRMED'}];
      if(sql.includes('FROM payments')) { const id=values.find(v=>v===a||v===b); return [{amount:recorded.filter(x=>x.id===id).reduce((n,x)=>n+x.amount,0).toFixed(2)}]; }
      if(sql.includes('INSERT INTO payments')) { const id=values.find(v=>v===a||v===b); const amount=values.find(v=>typeof v==='string' && /^\d+\.\d{2}$/.test(v)); recorded.push({id,amount:Number(amount)}); return [{id:'payment-'+recorded.length}]; }
      throw Error('unhandled payment SQL '+sql);
    },
    $executeRaw:async()=>1
  };
  const paymentService=new ManualPaymentService({withTenantTransaction:async(_ctx,fn)=>fn(paymentTx)},audit,{});
  const pay=(id,key)=>paymentService.record(ctx,{bookingId:id,idempotencyKey:key,method:'cash',actorUserId:b});
  const paidA=await pay(a,'pay-a'),paidB=await pay(b,'pay-b');
  process.stdout.write(JSON.stringify({refund:{first:first.ok?first.value.amount.amount:first.error.code,second:second.ok?second.value.amount.amount:second.error.code,refunded:refunds},order:{a:paidA.ok?paidA.value.amount.amount:paidA.error.code,b:paidB.ok?paidB.value.amount.amount:paidB.error.code,recorded}}));
})().catch(e=>{process.stderr.write(String(e));process.exitCode=1});
'@; node --import=tsx -e $probe
```

Output: `{"refund":{"first":"60.00","second":"REFUND_NOT_AVAILABLE","refunded":[60]},"order":{"a":"100.00","b":"100.00","recorded":[{"id":"33333333-3333-4333-8333-333333333333","amount":100},{"id":"44444444-4444-4444-8444-444444444444","amount":100}]}}`.

The probe confirms service selection/arithmetic and accepted sibling calls only under its supplied query results. It does **not** run PostgreSQL locking, RLS, constraints, commit/rollback, HTTP authorization, provider refund, Clock mirroring or real currency settlement. The nearest retained e2e tests cover a single partial manual payment (`local-pms-provider.e2e.spec.ts:2223-2239`), successful first-child order refund (`multi-room-booking.e2e.spec.ts:664-689`) and single-charge manual refund (`local-pms-provider.e2e.spec.ts:2329-2352`), not the two-installment or sibling cases. No broad suite was run because no product code changed.

## Narrow recommendation and remaining proof

Define the owner's rules for applying charges to child/order balances, for refunds against each original charge, and for cash/POS reversals. Then add an explicit scoped allocation (or equivalent immutable link) and one order-level settlement guard/lock; resolve the actual charge-owning first child before any order cancellation refund. Preserve existing tenant/property foreign keys, positive `NUMERIC` amounts and provider ID deduplication. Track settled refund totals separately from pending/unknown refund reservations; keep the latter deducted from available capacity and release them only after authoritative failure or cancellation. Unit 007 owns the broader state/reconciliation remedy. A controlled Postgres integration test with fake payment/Clock providers should cover two partial manual charges/refunds, sequential and concurrent sibling settlement, and cancellation initiated through child two, including commit/review behavior. Provider and production outcomes remain unverified and require separately authorized evidence.
