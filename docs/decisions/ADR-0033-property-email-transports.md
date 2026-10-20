# ADR-0033: property email transports and uncertain acceptance

Status: accepted owner requirements, 2026-10-19; implementation in progress under corrective Prompt A, E4.

## Context

The owner explicitly authorized per-hotel default MUST, own-domain Resend and custom SMTP sending, encrypted credentials, verification, rate limits and guest fallback. A timeout does not prove a mail server rejected a message. Retrying SMTP after unknown acceptance could duplicate guest mail.

## Decision

- Keep business mail commands and their immutable content separate from transport configuration. A prepared-message transport interface supports default MUST, Resend and SMTP; account/security mail stays on the default transport. No vendor calls in booking/payment logic.
- A forced-RLS tenant/property profile stores non-secret configuration and scope-bound encrypted credentials. API responses expose credential presence only. Replace credentials rather than reading them back. Changing the SMTP endpoint requires replacement credentials and new From verification.
- SMTP accepts only a public DNS hostname, with every resolved address checked before each connection. Pin one checked address and retain the original TLS server name. Require certificate validation and TLS 1.2 or newer, immediate TLS on 465 or mandatory STARTTLS on 587/2525. No plaintext, insecure overrides, proxy options, file/URL content access or protocol logging.
- Resend From must match the provider-verified domain. SMTP From requires a scoped, expiring mailbox challenge delivered through MUST. Connection checks do not imply From verification or delivery.
- Transport attempts need exclusive durable ownership. Once a non-idempotent SMTP DATA outcome is unknown, stop automatic retries/fallback and surface the uncertainty. Fallback is eligible only after proven non-acceptance, using its own stable logical key and an audit event. Default guest transactional fallback is on; hard suppression and per-property caps always apply. Never reroute a potentially accepted attempt to another provider account after configuration changes.
- Recipient resolution is separate from templates. Deduplicate To/CC/BCC with To taking precedence, then CC, then BCC. A fixed guest token cannot be removed from required guest topics. Staff roles/groups resolve against current scoped assignments and mute rules; external addresses are explicit. Do not expose BCC in rendered guest content. Owner clarification 2026-10-20: staff/external To/CC/BCC receive the separate staff version; guest messages and private booking/cancellation links remain separate. Existing private lists retain their behavior until explicit header choices are saved.
- Provider and SMTP checks require an explicit verified, capability-authorized hotel action. Verification uses mocked DNS/transports locally; no live provider probes are authorized by implementation or tests.

## Consequences

Existing queued domain content is not regenerated. Unsupported transports remain absent from the chooser until fully wired and verified. OAuth is a later gap. SMTP cannot offer exactly-once delivery: explicit uncertain outcomes and human review take precedence over silent duplicate sending. The canonical implementation contract and verification live in the M24 notifications/emails/audit plan.

## References

- [Nodemailer SMTP options](https://nodemailer.com/smtp): IP host with original TLS server name, mandatory STARTTLS, logging and content access controls.
- [Resend domain retrieval](https://resend.com/docs/api-reference/domains/get-domain): provider domain and DNS evidence.
