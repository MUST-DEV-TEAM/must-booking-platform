# ADR-0040: Restaurant deposit pricing by service and area

Status: Accepted by the owner on 2026-11-03.

Restaurant reservation deposits use fixed amounts per guest or per booking. The rule precedence is an exact service/area pair, the service default, then the restaurant default. A matched rule can require a minimum party size and defines its cancellation cutoff. No estimated meal total is required.

Amounts use the restaurant currency and exact decimal storage. Each reservation captures its chosen area, service, pricing inputs, deposit and cancellation terms. Subsequent configuration edits do not change accepted terms. A manager can override a quoted deposit only with a recorded reason. Paid deposits are shown to staff for deduction from the dining bill.

Restaurant payments reuse the guest payment provider session binding and the existing payment poll/expiry sweep. Restaurant receipts have their own append-only ledger so hotel revenue projections and platform subscription billing cannot include them accidentally. Provider calls remain in the existing adapter. The initial restaurant checkout supports only a linked hotel's staging PokPay connection.

A checkout intent is durable before contacting the provider. An uncertain create is not repeated. Only an authoritative amount/currency-matched payment confirms a live hold. Expired or cancelled bookings never regain a table because of a late payment; the receipt requires refund review instead.

Existing hotel session bindings retain their hotel booking references. Application rollback leaves additive structures and financial evidence intact; removing restaurant bindings requires an owner-approved migration, never deletion of receipts.
