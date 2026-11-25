# Booking several rooms in one order (for Astro websites)

For the people who build a hotel website in Astro. All hotel websites are Astro now (the WordPress plugin is gone); the website only talks to the MUST API, it never works out prices or availability by itself.

Status (2026-11-25): the staff dashboard can already book several rooms in one order. The guest side below works in the API, but the **website cart is not built yet** and must not go live before gap G-105 is closed (see "What is still missing").

## What the guest sees (the agreed flow)

1. The guest chooses the dates and the party once (adults, children and their ages).
2. The guest adds room types to a **selection** (a cart). Every room shows its own price and its own cancellation rule. A room type can be added more than once if the hotel has several.
3. The cart shows each room's price and **one total**. The hotel's limit on rooms per booking is shown (`group.maxRooms` in the hotel profile); past the limit the cart offers the group request form instead.
4. The guest enters one main contact. Names for the other rooms are optional.
5. The guest pays **once** for the whole order (card) or chooses pay at the hotel.
6. The confirmation shows one order reference and each room with its own reference.

## The API steps

All calls use the same guest session (cookie or header) and the same `Idempotency-Key` rules as a single booking; see [public-guest-api.md](../architecture/public-guest-api.md).

1. **Prices for the room list**: `POST /quotes/display-prices` as for one room (use `roomCount` for the number of rooms).
2. **One quote per room in the cart**: `POST /quotes` once per room, **all with the same guest session**. Each quote has its own party (`adults`, `children`, `childrenAges`), optional `clockRateId` (Clock hotels) and `promoCode`. The quote token lives 15 minutes; if it ran out, ask for the quotes again before booking.
3. **Book the order**: `POST /bookings/orders` with a new `Idempotency-Key`:

```json
{
  "startsOn": "2027-06-01",
  "endsOn": "2027-06-03",
  "paymentMethod": "stripe",
  "guest": { "firstName": "", "lastName": "", "email": "", "phone": null },
  "rooms": [
    { "roomTypeId": "...", "ratePlanId": "...", "total": { "amount": "190.00", "currency": "EUR" },
      "adults": 2, "children": 0, "quoteToken": "<room 1 quote>" },
    { "roomTypeId": "...", "ratePlanId": "...", "total": { "amount": "220.00", "currency": "EUR" },
      "adults": 2, "children": 1, "childrenAges": [7], "quoteToken": "<room 2 quote>",
      "guest": { "firstName": "Optional", "lastName": "Sleeper" } }
  ]
}
```

   Answer: `{"ok":true,"value":{"orderReference":"must-order-...","bookings":[{"id","externalReference","status","total"}],"checkoutUrl":"..."}}`. `checkoutUrl` exists only for card payment: send the guest there once for the whole order. Rooms are held **all or none**: if one room is gone, nothing is booked and the error says so.
4. **After payment** the guest returns to the site; read the order with `GET /public/bookings/:bookingId` (the first room carries the payment).

## Cancelling

- **Whole order**: `DELETE /public/bookings/:bookingId` on any room cancels the whole order (each room by its own rule; the refund is the sum of the rooms whose rule is free).
- **One room only** (new): the manage page (`POST .../bookings/:bookingId/manage`) accepts `"scope": "room"` to cancel just that room by its own policy. Only that room is released and only its price is refunded from the order's single payment. The manage preview (`GET .../manage`) now returns `inOrder` and `roomCancellation: {automaticAllowed, refundAmount}` so the site can offer the choice. On a Clock hotel the guest sends a cancellation request for staff instead (`automaticAllowed` is false).

## What is still missing (gap G-105)

The guest order does not yet carry what one booking carries: bank transfer as a payment method, the accepted terms and privacy versions, the return address after card payment, the guest form fields (country, address, arrival time, special requests, company, marketing consent) and the hotel's required-field checks. Until the API takes these, the website cart would skip legal and payment steps a single booking has, so it stays unbuilt.

## For the Astro cart (when G-105 is done)

- Source of truth for money: the API only. Never add prices in the browser.
- Build the cart as components under the site's existing booking pages (Luxury is the reference site); edit the site repos only through pull requests, and nothing goes live without the owner's go.
- Acceptance tests: two rooms same type, two different types, one room sold out (whole order refused, nothing held), quote expired (re-quote), coupon on the order, card payment return, cancel one room, cancel whole order.
