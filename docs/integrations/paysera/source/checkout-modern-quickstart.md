- 
- Checkout Modern
- Quickstart
# Quickstart

Get your first payment working in 5 minutes with this step-by-step guide.

Copy Page Content

Get your first payment working in 5 minutes.

## Before You Start​

Checkout Modern is available to all merchants
Checkout Modern — the OAuth2-based Paysera Checkout API used in this quickstart — is available to all merchants, so no activation request is needed. Two limitations still apply: it currently supports Lithuania, Latvia, Estonia, Bulgaria, Kosovo and North Macedonia only, and it does not yet support some custom integrations, or projects created for a hosted platform that has no Checkout Modern plugin.

### New merchants

Once you have ordered the payment collection service, Checkout appears in the main menu of the Paysera Merchant Portal, and you can create your first project there.

### Existing merchants

Create a new project directly in Checkout Modern, or contact Paysera Support and ask them to copy your existing Checkout Classic project over to Checkout Modern.

Using Checkout Classic?
If you are integrating against the legacy Project ID + Project Password API, see the Checkout Classic documentation instead.

Amount Format
All amounts use minor currency units (cents): 1000 = €10.00

## Step 1: Get Your Credentials​

Obtain your credentials from the Paysera merchant dashboard:

- Client ID: Your OAuth2 client identifier

- Client Secret: Your OAuth2 client secret

## Step 2: Create a Payment​

1. Get an access token

```
curl -X POST https://api.paysera.com/auth/realms/Paysera/protocol/openid-connect/token \  -H "Content-Type: application/x-www-form-urlencoded" \  -d "grant_type=client_credentials" \  -d "client_id=your-client-id" \  -d "client_secret=your-client-secret"
```

Response:

```
{  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",  "token_type": "Bearer",  "expires_in": 3600}
```

2. Create a payment order

```
curl -X POST https://api.paysera.com/merchant-order/integration/v1/orders \  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \  -H "Content-Type: application/json" \  -d '{    "redirect_urls": {      "success_url": "https://your-site.paysera.net/success",      "failure_url": "https://your-site.paysera.net/failure",      "callback_url": "https://your-site.paysera.net/webhook"    },    "purchase": {      "reference": "ORDER-001",      "amount": 1000,      "currency": "EUR"    }  }'
```

Response:

```
{  "project_id": "c35593b8-6b65-4cae-9d8e-39af32578ba7",  "order_id": "a6f2b8e3-5e5f-47d9-b13f-87ed2db2938a",  "created_at": 1736433270,  "source": "Integration",  "purchase": {    "reference": "ORDER-001",    "amount": 1000,    "currency": "EUR"  }}
```

3. Create a payment link

```
curl -X POST https://api.paysera.com/checkout-payment-link/integration/v1/payment-links \  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \  -H "Content-Type: application/json" \  -d '{    "order_id": "ORDER_ID_FROM_PREVIOUS_STEP",    "name": "Order #001",    "lifetime": 3600,    "experience": {      "language": "en"    },    "purchase": {      "amount": 1000    }  }'
```

lifetime is optional — it defaults to 259200 (3 days) if omitted; here it's set to 3600 (1 hour). Use 0 for a link that never expires (required for orders with splits).

Response:

```
{  "link_id": "c8d9e0f1-2a3b-4c5d-6e7f-8a9b0c1d2e3f",  "order_id": "a6f2b8e3-5e5f-47d9-b13f-87ed2db2938a",  "payment_URL": "https://api.paysera.com/checkout-payment-link/payment-collection/v1/payment-links/abc123def456GhiJkl_mNOpQrStUvWxYz0123456",  "purchase": {    "amount": 1000  },  "expired_at": 1736436870,  "created_at": 1736433270}
```

4. Redirect customer

Use the payment_URL from the response to redirect the customer to the payment page.

## Step 3: Handle the Callback​

When the payment completes, Paysera sends a POST request to your callback URL:

```
<?php// Verify webhook signature$payload = file_get_contents('php://input');$signature = $_SERVER['HTTP_X_PAYSERA_SIGNATURE'] ?? '';$secret = getenv('PAYSERA_CLIENT_SECRET');$expectedSignature = hash_hmac('sha256', $payload, $secret);if (!hash_equals($expectedSignature, $signature)) {    http_response_code(401);    exit('Invalid signature');}// Process the webhook$data = json_decode($payload, true);$status = $data['order']['status'] ?? null;$reference = $data['order']['merchant_order_id'] ?? null;if ($status === 'paid') {    // Payment successful - update your order    fulfillOrder($reference);}http_response_code(200);echo 'OK';
```

## Order Statuses​

Status | Description | 
pending_payment | Order created, awaiting payment | 
paid | Order fully paid - fulfill the order | 
canceled | Order was canceled | 
closed | Order closed | 

See Payment Statuses Reference for complete documentation.

## Next Steps​

- Learn about Authentication in detail

- Understand Environment configuration

- Follow the complete Your First Payment tutorial

- Review Payment Statuses for all status values