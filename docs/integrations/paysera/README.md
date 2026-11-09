# Paysera integration sources

Saved 2026-11-09 for [Milestone 36](../../roadmap/milestones/36-multiple-payment-methods.md). These are copies of Paysera's public developer documentation (plain text taken from the pages), kept so the design does not depend on the site staying the same. They are reference only; nothing here is built.

- Portal: https://developers.paysera.com
- Paysera Albania: https://www.paysera.al/v2/en-AL/payment-gateway-checkout

| File in `source/` | From |
| --- | --- |
| `paysera-developer-reference.txt` | https://developers.paysera.com/assets/files/llms-full-9b3114ab3fa7fa70f7dc80468501435c.txt |
| `checkout-getting-started.md`, `checkout-api-integration.md`, `checkout-api-reference.md`, `checkout-sdk.md`, `checkout-modern-quickstart.md` | https://developers.paysera.com/guides/checkout-modern/ (Checkout Modern, OAuth2) |
| `checkout-classic-overview.md`, `checkout-classic-first-payment.md` | https://developers.paysera.com/guides/checkout-classic (Checkout Classic, project id and password, signed links) |

Key fact: Checkout Modern lists Lithuania, Latvia, Estonia, Bulgaria, Kosovo and North Macedonia only; Albania is not listed. Confirm with Paysera Albania which version applies.
