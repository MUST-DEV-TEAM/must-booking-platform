- 
- Checkout Modern
- API Reference
# API Reference

Complete reference of all Paysera Checkout integration endpoints.

Copy Page Content

## Interactive API Reference​

For detailed endpoint documentation with request/response examples, see the Endpoint Reference section under API Integration:

- Create Order - Create a payment order

- Create Payment Link - Generate a payment URL

- Get Payment Methods - Query available methods

- Register Split Beneficiary - Register a split-payment recipient

- List Split Beneficiaries - List the project's registered beneficiaries

- Delete Split Beneficiary - Remove a registered beneficiary

- Get Split Policy - Read the project's split-policy template

- Report Integration Partner - Attribute the project to your platform

## OpenAPI Specification​

Download the complete API specification:

Download OpenAPI Spec (YAML)

Use with Postman, Insomnia, or Swagger Editor for interactive exploration.

## Base URL​

```
https://api.paysera.com
```

## Authentication​

All endpoints require OAuth2 Bearer token authentication:

```
Authorization: Bearer YOUR_ACCESS_TOKEN
```

See Authentication for details on obtaining tokens.

## Orders API​

Base path: /merchant-order/integration/v1

### Create Order​

Creates a new payment order.

```
POST /merchant-order/integration/v1/orders
```

Request Body:

Field | Type | Required | Description | 
project_id | string (UUID) | No | Your merchant project ID. Defaults to the project from your JWT token. | 
redirect_urls.success_url | string | No | URL to redirect on successful payment | 
redirect_urls.failure_url | string | No | URL to redirect on failed payment | 
redirect_urls.callback_url | string | No | Backend URL to receive webhook notifications | 
purchase.reference | string | Yes | Your unique order reference in the merchant system | 
purchase.amount | integer | Yes* | Amount in minor units (e.g., 14999 for €149.99). *Omit it when purchase.payer_sets_amount is true | 
purchase.currency | string | Yes | ISO 4217 currency code | 
purchase.payer_sets_amount | boolean | No | true lets the payer enter the amount (default false). See Let the payer set the amount | 
purchase.minimum_amount / purchase.maximum_amount | integer | No | Payer-set limits in minor units; only with payer_sets_amount: true | 
purchase.suggested_amount | integer | No | Amount prefilled for the payer; only with payer_sets_amount: true | 
purchase.amount_buttons | array<integer> | No | Three or four one-tap amounts; only with payer_sets_amount: true | 
tips_enabled | boolean | No | Offer the payer a tip on top of the fixed amount (default false). See Tips | 
source | string | No | Where the order originated (URL or identifier). Defaults to Integration. | 
metadata | object | No | Additional key-value pairs (each key/value max 255 chars). An integration partner reports itself with tpi_id; see Report integration partner. | 
merchant_data | object | No | Merchant data key-value pairs (each key/value max 255 chars) | 
splits | array | No | Per-order split entries — variadic slot fills and/or payer tips, referencing registered beneficiaries by beneficiary_id or declaring them inline. See Split payments. | 
split_overrides | object | No | Per-order restatement of the whole split policy (requires per-order overrides enabled). See Per-order rule overrides. | 

Response: 201 Created

Field | Type | Description | 
order_id | string (UUID) | Unique order identifier | 
project_id | string (UUID) | Project identifier associated with the order | 
created_at | integer | Creation Unix timestamp (UTC) | 
source | string | Source indicating where the order originated | 
merchant_data | object | Merchant data key-value pairs (if provided in request) | 
purchase.reference | string | Your order reference | 
purchase.amount | integer | null | Amount in minor units; null on a payer-set order | 
purchase.currency | string | Currency code | 
purchase.payer_sets_amount | boolean | Whether the payer enters the amount | 
purchase.minimum_amount / purchase.maximum_amount | integer | null | Payer-set limits as sent; null when not set | 
purchase.suggested_amount | integer | null | Suggested amount as sent | 
purchase.amount_buttons | array<integer> | Amount buttons as sent; [] when none | 
tips_enabled | boolean | Whether the order offers a tip | 

## Payment Links API​

Base path: /checkout-payment-link/integration/v1

### Create Payment Link​

Creates a payment link for an existing order.

```
POST /checkout-payment-link/integration/v1/payment-links
```

Request Body:

Field | Type | Required | Description | 
order_id | string (UUID) | Yes | The associated order ID | 
name | string | Yes | Descriptive name for the payment link (max 255 chars) | 
purchase.amount | integer | Yes* | Amount in minor currency units (e.g., cents). *Omit it for a payer-set order; the link takes the amount rules from the order | 
purchase.suggested_amount / purchase.amount_buttons | integer / array<integer> | No | Payer-set orders only: override the order's suggested amount and buttons for this link. See Payer-set amount links | 
experience.language | string | Yes | UI language, 2-letter ISO 639-1 code (e.g., en, lt) | 
experience.payment_flow | string | No | Payment flow type. Defaults to paysera_checkout. direct_payment requires payment_details.key and payment_details.country_code; without country_code the link opens the Paysera checkout page instead. | 
lifetime | integer | No | Link validity in seconds. Default 259200 (3 days). 0 = never expires. | 
payment_details.key | string | Yes, with direct_payment | Payment method key (e.g., card-payment). Required with direct_payment: sets the method the payer is redirected to; omitting it returns 400 validation_payment_method_required. Deprecated with paysera_checkout: still accepted as a hint that lists the method right after Paysera, ahead of the project's display order. The order in which payment methods appear on the payment page is configured per project in the merchant portal (Payment Methods). | 
payment_details.purpose | string | No | Payment purpose description (max 255 chars). Used verbatim as the payer-facing payment purpose, truncated to 140 chars; omit it to get the generated default. See Payment purpose | 
payment_details.country_code | string | For direct_payment | Country code, ISO 3166-1 alpha-2 (e.g., LT). With direct_payment it selects the country of the payment method's bank. A direct_payment link without it is still accepted (no validation error) and opens the Paysera checkout page instead | 
payer_information.name | string | No | Payer name (max 150 chars) | 
payer_information.email | string | No | Payer email | 
metadata | object | No | Additional key-value metadata | 

Response: 201 Created

Field | Type | Description | 
link_id | string (UUID) | Unique payment link ID | 
order_id | string (UUID) | Associated order ID | 
payment_URL | string | Payment URL to redirect the customer to | 
experience.language | string | Selected language | 
experience.payment_flow | string | Payment flow type | 
payment_details.key | string | Payment method key (if specified) | 
payment_details.purpose | string | The purpose you sent, echoed back — null if you omitted it. See Payment purpose | 
payment_details.country_code | string | Country code (if specified) | 
payer_information.name | string | Payer name (if specified) | 
payer_information.email | string | Payer email (if specified) | 
purchase.amount | integer | null | Amount in minor units; null on a payer-set link until the payer enters one | 
purchase.payer_sets_amount | boolean | Whether the payer enters the amount | 
purchase.minimum_amount / purchase.maximum_amount / purchase.suggested_amount | integer | null | Payer-set limits and suggested amount the link applies | 
purchase.amount_buttons | array<integer> | Amount buttons the link shows; [] when none | 
created_at | integer | Creation Unix timestamp (UTC) | 
expired_at | integer | Expiration Unix timestamp (UTC) | 

note
The response field payment_URL uses mixed case as documented.

## Payment Methods API​

Base path: /checkout-project/integration/v1

### Get Available Payment Methods​

Retrieves available payment methods for your project.

```
GET /checkout-project/integration/v1/methods
```

Query Parameters:

Parameter | Type | Required | Description | 
amount | integer | No | Filter by transaction amount (minor units) | 
currency | string | No | Filter by currency (ISO 4217) | 
payer_country | string | No | Payer country (ISO 3166-1 alpha-2). A method that has payer countries is listed only when this country is enabled for it and the amount fits this country's limits; available_countries then holds only this country. | 

note
Filtering by limits only applies when both amount and currency are provided. payer_country is separate and optional: without it, each method lists every country whose limits accept the amount. Each method returns its limits as min_amount / max_amount.

Response: 200 OK

```
{  "items": [    {      "key": "swedbank",      "title": "Swedbank",      "description": "Pay via Swedbank online banking.",      "type": "pis",      "flow": "redirect",      "available_countries": ["EE", "LT", "LV"],      "available_currencies": {        "EUR": { "main": true }      },      "display_order": null,      "display_order_group": null,      "min_amount": { "amount": 1, "currency": "EUR" },      "max_amount": { "amount": 1500000, "currency": "EUR" }    }  ]}
```

Field | Type | Description | 
items[].key | string | null | Unique identifier for the payment method | 
items[].title | string | Display name of the payment method | 
items[].description | string | null | Detailed description of the payment method | 
items[].type | string | Method type: pis, card, wallet, banklink or bnpl. Today's catalogue uses only pis, card and bnpl. | 
items[].flow | string | Flow: redirect, decoupled or direct. Every method currently uses redirect. | 
items[].available_countries | array<string> | ISO 3166-1 alpha-2 country codes. An empty array means no payer-country restriction. | 
items[].available_currencies | object | Map of currency code → { main: boolean } | 
items[].logo_url | string | null | URL of the icon variant of the logo, a 48 px disc | 
items[].logo_wide_url | string | null | URL of the wide variant, the wordmark for wide slots | 
items[].display_order | integer | null | Position in the default ordering; null means unranked | 
items[].display_order_group | integer | null | Display group the method belongs to | 
items[].min_amount / items[].max_amount | object | null | The method's limits as { amount, currency } in minor units, for payer_country when given; null when there is no limit. See Get payment methods | 

## Common Response Codes​

Code | Description | 
200 | Success | 
201 | Created | 
400 | Bad Request - Invalid parameters | 
401 | Unauthorized - Invalid or expired token | 
403 | Forbidden - Insufficient permissions | 
404 | Not Found - Resource doesn't exist | 
409 | Conflict - Resource already exists | 
422 | Unprocessable Entity - Validation error | 
429 | Too Many Requests - Rate limit exceeded | 
500 | Internal Server Error | 

## Error Response Format​

Simple error response:

```
{  "error": "error_code",  "error_description": "Human-readable description"}
```

Validation error response (per-field details):

```
{  "error": "invalid_properties",  "error_description": "Validation failed",  "error_properties": {    "purchase.amount": ["Amount should be greater than 0"],    "purchase.currency": ["Currency is required"]  }}
```

## Related Documentation​

- Payment Orders Guide - Detailed order creation guide

- Payment Links Guide - Detailed payment link guide

- Error Codes - Complete error reference

- Payment Statuses - Status reference