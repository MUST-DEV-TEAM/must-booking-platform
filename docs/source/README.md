# Original reference material

Status: **REFERENCE MATERIAL**, preserved unchanged.

[clock-pms-integration.pdf](clock-pms-integration.pdf) is the original nine-page Albanian technical brief, with 39 sections and appendices. It specifies intended architecture, provider contracts, production requirements and deliverables. It is not evidence that those requirements have been implemented, and is not itself the complete vendor API specification.

For current behavior start at [Clock architecture](../integrations/clock/architecture.md). For endpoint evidence use the [endpoint matrix](../integrations/clock/endpoint-matrix.md). Section 39's labels remain: CONFIRMED_BY_DOCS, CONFIRMED_IN_SANDBOX, CONFIRMED_BY_CLOCK_SUPPORT, ASSUMPTION and NOT_SUPPORTED. Preserve evidence dates and verify official vendor contracts during an authorized integration task; do not promote an assumption solely because code uses it.

Key distinctions: PMS API versus Base API versus Message Channels; direct OTA/Booking.com connectivity is a separate workstream. The source brief's full metrics, normalization, reconciliation and security deliverables exceed the current implementation.
