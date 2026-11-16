# Reply to Clock: endpoint list (draft, 2026-11-16)

Draft for the owner to send. Clock asked for the full list of endpoints the integration uses so they can compare it with their permission profile for future activations. The list below was built from the code that runs in production on 2026-11-16 (`apps/api/src/integrations/clock`), not from memory.

---

**Subject:** Endpoints used by the MUST integration, for the standard permission profile

Hello,

Thank you for updating the API users. We re-tested Empire (14688) and Luxury (15668) today: the rights you added work, and both accounts now have the same set of rights.

One more thing about our test account 16307: Clock now answers every request with "The trial period of this account has expired." Could you extend or renew the trial, or tell us how to get a new demo account? We need it to test the cancel flow.

Below is the full list of endpoints our integration uses. "Now" means the code calls it today. "Next" means it is built or planned and we asked for the right ahead of use.

**Reading (now)**

| API | Request | What we use it for |
| --- | --- | --- |
| pms_api | GET /room_types, /rooms | Importing room types and rooms |
| pms_api | GET /rates/, /rates/:id | Rates and the rate choice |
| pms_api | GET /rates_availability | Availability calendar and search |
| pms_api | GET /products | The price of a stay |
| pms_api | GET /guests/search, /guests, /guests/:id | Matching returning guests |
| pms_api | GET /bookings/, /bookings/:id | Reading and syncing reservations |
| pms_api | GET /bookings/:id/folios/ | Finding a booking's folios |
| base_api | GET /folios/:id | Reading a folio's balance and state |
| base_api | GET /folios/:id/credit_items | Reconciling payments |

**Writing (now)**

| API | Request | What we use it for |
| --- | --- | --- |
| pms_api | POST /bookings/ | Creating a reservation |
| pms_api | PUT /bookings/:id | Changing or cancelling a reservation |
| pms_api | POST /bookings/:id/folios/ | Creating the deposit folio for an online card payment |
| base_api | POST /folios/:id/credit_items | Recording a payment or a refund on the folio |
| base_api | DELETE /folios/:id | Voiding the room folio when a booking is cancelled free of charge |

**Live updates (now)**

| API | Request | What we use it for |
| --- | --- | --- |
| base_api | GET and POST /webhook_subscription | Creating and reading the live-updates subscription once per hotel, when it is activated (done by our team by hand, not by a background job) |

**Next (right asked for ahead of use)**

| API | Request | What for |
| --- | --- | --- |
| pms_api | GET /rate_plans/, /rate_plans/:id | Real rate plans instead of our own hidden ones |
| pms_api | GET /rate_packages/ | Package rates |
| pms_api | DELETE /bookings/:id/booking_guests/:id | Removing a guest from a booking |
| base_api | GET /charges, /charge_templates | Showing and posting extra charges |
| base_api | GET /document_types, /payment_sub_types | Reading document and payment types |

We are constantly updating our system according to our clients' demands, so we may need to add more permissions in the future. We will always ask in advance, and with a clear reason for each right, as we did this time. Because of that, we would like the standard profile to be easy to extend for all our accounts at once.

Best regards,

---

## Notes for the owner (not part of the email)

- "Now" rows were checked against the code on 2026-11-16. The webhook subscription is the exception: no code calls it, it is a manual step from the runbook, so the row says so.
- The "Next" rows are not called by production code yet; they are rights we asked for. Say so if Clock asks, because it is true.
- Read-only check run 2026-11-16 on Empire and Luxury: every read right Clock added is live (charge templates, document types, payment sub types, rate plans, webhook subscription show). Both accounts have the same 57 rights missing, all of them rights we do not use. The two write rights, `pms_api_booking_guests_destroy` and `pms_api_booking_folios_create`, cannot be checked with a safe read, so they are confirmed only by Clock's email. The first real cancel or deposit on Luxury will prove them.
- Test account 16307: the trial expired. This is why every call answers 403.
