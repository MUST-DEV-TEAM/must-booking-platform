- 
- Checkout Modern
- API Integration
# API Integration Guide

Direct REST API integration for developers who prefer maximum control.

Copy Page Content

This guide covers direct API integration with Paysera Checkout for developers who prefer maximum control or are integrating from languages other than PHP.

## Overview​

Checkout provides a RESTful API for all payment operations. The main APIs are:

API | Base Path | Purpose | 
Orders | /merchant-order/integration/v1/ | Create and manage payment orders | 
Payment Links | /checkout-payment-link/integration/v1/ | Generate shareable payment URLs | 
Payment Methods | /checkout-project/integration/v1/ | Query available payment options | 
Payments | /payment-executor/integration/v1/ | Read payment records | 
Refunds | /payment-executor/integration/v1/ | Initiate and track refunds | 
Activity | /checkout-event-collection/integration/v1/ | Event log for orders and payments | 

## OpenAPI Specification​

Download the complete API specification for use with your favorite API tools:

Download OpenAPI Spec (YAML)

Import this file into tools like:

- Postman - for API testing and exploration

- Insomnia - for REST client testing

- Swagger Editor - for viewing and editing

## Base URL​

```
https://api.paysera.com
```

## Authentication​

All API requests require OAuth2 Bearer token authentication:

```
curl -X POST https://api.paysera.com/auth/realms/Paysera/protocol/openid-connect/token \  -H "Content-Type: application/x-www-form-urlencoded" \  -d "grant_type=client_credentials" \  -d "client_id=YOUR_CLIENT_ID" \  -d "client_secret=YOUR_CLIENT_SECRET"
```

Use the returned access_token in subsequent requests:

```
curl -X GET https://api.paysera.com/checkout-project/integration/v1/methods \  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

See Authentication for detailed setup.

## Request Format​

- All requests use JSON format

- Include Content-Type: application/json header for POST/PUT requests

- All field names are snake_case

- All timestamps are Unix epoch (seconds, UTC)

Amount Format
Amounts are in minor currency units (e.g., cents for EUR). Type differs per endpoint:

- Create order (POST /orders) — request amount is an integer, e.g., "amount": 1000 for €10.00.

- Create payment link (POST /payment-links) — request amount is an integer, e.g., "amount": 1000 for €10.00.

- All responses return amount as an integer.

## Response Format​

Responses are snake_case JSON with Unix timestamps. Field names differ per endpoint — see the API Reference for the full schema. Example (order create response):

```
{  "project_id": "c35593b8-6b65-4cae-9d8e-39af32578ba7",  "order_id": "a6f2b8e3-5e5f-47d9-b13f-87ed2db2938a",  "source": "Integration",  "created_at": 1736433000,  "purchase": {    "reference": "ORDER-001",    "amount": 1000,    "currency": "EUR"  }}
```

Timestamps
All timestamps are Unix epoch (seconds since 1970-01-01), not ISO 8601.

## Error Handling​

Errors return appropriate HTTP status codes with a JSON body:

```
{  "error": "invalid_properties",  "error_description": "Validation failed",  "error_properties": {    "purchase.amount": ["Amount should be greater than 0"]  }}
```

Simple errors omit error_properties and carry just error + error_description. Common status codes:

Code | Meaning | 
200 | Success | 
201 | Created | 
400 | Bad Request — invalid parameters / validation failed (see error_properties) | 
401 | Unauthorized — invalid or expired token | 
403 | Forbidden — insufficient permissions | 
404 | Not Found | 
409 | Conflict — resource state prevents the operation (e.g. cancelling a link with a payment in progress) | 
422 | Unprocessable — resource exists but is not in an eligible state (e.g. order not editable, payment not refundable) | 
429 | Too Many Requests — rate limit exceeded (see Retry-After header) | 
500 | Internal Server Error | 

## Rate Limits​

All integration API endpoints are rate limited to 50 requests per minute per client IP address.

When the limit is exceeded, the API returns HTTP 429 Too Many Requests. Every response includes rate limit headers:

Header | Description | 
X-RateLimit-Limit | Total requests allowed in the current time window | 
X-RateLimit-Remaining | Requests remaining in the current time window | 
X-RateLimit-Reset | Seconds until the rate limit window resets | 

## Integration Guides​

- Payment Orders - Creating and managing orders

- Payment Links - Generating and managing payment URLs

- Payments - Reading payment records

- Refunds - Initiating and tracking refunds

- Activity - Event log for orders and payments

- Webhooks - Handling payment notifications

## Quick Start Example​

Here's a minimal example to create a payment:

```
# 1. Get access tokenTOKEN=$(curl -s -X POST https://api.paysera.com/auth/realms/Paysera/protocol/openid-connect/token \  -H "Content-Type: application/x-www-form-urlencoded" \  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET" \  | jq -r '.access_token')# 2. Create order (amount in minor units: 1000 = €10.00)ORDER_ID=$(curl -s -X POST https://api.paysera.com/merchant-order/integration/v1/orders \  -H "Authorization: Bearer $TOKEN" \  -H "Content-Type: application/json" \  -d '{    "redirect_urls": {      "success_url": "https://example.com/success",      "failure_url": "https://example.com/failure",      "callback_url": "https://example.com/webhook"    },    "purchase": {      "reference": "ORDER-001",      "amount": 1000,      "currency": "EUR"    }  }' | jq -r '.order_id')# 3. Create payment linkPAYMENT_URL=$(curl -s -X POST https://api.paysera.com/checkout-payment-link/integration/v1/payment-links \  -H "Authorization: Bearer $TOKEN" \  -H "Content-Type: application/json" \  -d "{    \"order_id\": \"$ORDER_ID\",    \"name\": \"Order #001\",    \"lifetime\": 3600,    \"experience\": { \"language\": \"en\" },    \"purchase\": { \"amount\": 1000 }  }" | jq -r '.payment_URL')echo "Payment URL: $PAYMENT_URL"
```