# ADR-0036: Reviewed room and stay amendments

Status: Accepted owner direction, 2026-10-23.

The owner approved a preview of the revised stay, price difference and any change to cancellation terms, followed by explicit staff confirmation. Payment collection and refunds are separate actions; a room/date edit must not silently move money. Existing agreed cancellation terms remain immutable. A changed arrival without a separately agreed revision remains staff-reviewed for cancellation; current hotel defaults must not silently replace the original agreement.

A room reassignment within the booked room type preserves rate, total, payments and cancellation terms. Verify availability at confirmation, use booking/provider versions, scope all effects to tenant/property and retain an idempotent operation and audit evidence. External uncertainty requires review/read-back, never a blind repeat of a provider write. Cross-type changes and Clock financial repricing require verified rate/folio behavior; an indicative quote is not proof that provider charges changed. Unverified provider capabilities must be labelled and must not be enabled as production behavior.

The owner subsequently authorized one dedicated sandbox fixture and its explicit reactivation for final service verification. Same-type assignment preserved its total; date-only PUT recalculated the original public rate and matched the guarded preview. Supported date amendments therefore require that original public rate and verified read-back; unsupported rates/charges remain reviewable. This evidence narrows the implementation boundary and does not waive the production verification rule.


Owner follow-up, 2026-10-23: extend the reviewed stay editor with a room-type choice and one check-in/check-out calendar. Search the new type's eligible public rates, compare the revised total and verified balance, and show any amount due or guest credit. Money actions remain separate. The implementation prepares this path behind a property allowlist; cross-type writes must remain disabled until their provider behavior is verified. Existing staging/production credentials and cancellation requests must not be silently migrated or approved by this work.
