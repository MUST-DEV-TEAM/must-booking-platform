- 
- Checkout Modern
- PHP SDK Overview
# PHP SDK

The official PHP SDK for Paysera Checkout v3: payment initiation, callback verification, refunds, project eligibility, and localization — behind a single SdkFacade entry point.

Copy Page Content

The SDK is open source under LGPL-3.0-or-later and published on Packagist.

 |  | 
Package | paysera/lib-checkout-integration-sdk | 
Source | github.com/paysera/lib-checkout-integration-sdk | 
Quick start | Repository README | 
License | LGPL-3.0-or-later | 
Changelog | CHANGELOG.md | 

## Features​

- Single entry point - All functionality behind SdkFacade and its facades

- Automatic token management - Issues, stores, decodes and refreshes OAuth2 tokens

- JWT validation - Verifies token signatures against the Paysera JWKS endpoint

- Callback verification - HMAC signature verification with typed callback objects

- Refunds - Initiate refunds and read refund statuses

- Project eligibility - Single call that reports whether a store may collect payments

- Localization - Namespace-based translations shared between the SDK and your plugin

- PSR-based - PSR-3 logger, PSR-6 cache, PSR-18 HTTP client, PSR-20 clock

## Requirements​

- PHP 7.4, 8.0, 8.1, 8.2, 8.3 or 8.4

- Composer

- ext-curl and ext-json

## Getting Credentials​

The SDK needs a client_id / client_secret pair from a Paysera project. Create a project and generate credentials as described in Obtaining Credentials, and use Test Mode to run payments end to end before going live.

## Quick Start​

### Installation​

```
composer require paysera/lib-checkout-integration-sdk
```

### Basic Usage​

```
<?phpuse Paysera\CheckoutSdk\SdkFacadeBuilder;use Paysera\CheckoutSdk\Entity\PaymentApiCredentials;use Paysera\CheckoutSdk\Entity\Metadata;use Paysera\CheckoutSdk\Entity\PaymentOrderSource;use Paysera\CheckoutSdk\Entity\PaymentOrder\Purchase;use Paysera\CheckoutSdk\Entity\PaymentOrder\RedirectUrls;// Build the SDK$sdkFacade = (new SdkFacadeBuilder())->build();// Authenticate$apiCredentials = new PaymentApiCredentials(    'your-client-id',    'your-client-secret');$sdkFacade->getAuthorizationFacade()->authorize($apiCredentials);// Create a payment$paymentsFacade = $sdkFacade->getPaymentsFacade();$orderRequest = $paymentsFacade->buildPaymentOrderCreateRequestFromValues(    new Purchase('ORDER-001', 2500, 'EUR'),  // 25.00 EUR in cents    new Metadata(        'https://your-site.paysera.test',    // referer (mandatory)        'custom',                            // platform        '1.0.0',                             // platform_version        'my-integration',                    // plugin_name        '1.0.0'                              // plugin_version    ),    new RedirectUrls(        'https://your-site.paysera.test/success',        'https://your-site.paysera.test/failure',        'https://your-site.paysera.test/webhook'    ),    PaymentOrderSource::CHECKOUT_PAGE);$linkRequest = $paymentsFacade->buildPaymentLinkCreateRequest([    'name' => 'Order #001',    'lifetime' => 3600,    'metadata' => [        'referer' => 'https://your-site.paysera.test',    ],    'purchase' => [        'amount' => 2500,    ],]);$response = $paymentsFacade->initiatePayment($orderRequest, $linkRequest);// Redirect to payment pageheader('Location: ' . $response->getPaymentUrl());
```

## SDK Architecture​

The SDK is organized around facades that group related functionality:

Facade | Accessor | Purpose | 
Authorization | getAuthorizationFacade() | OAuth2 authentication, token storage and decoding | 
Payments | getPaymentsFacade() | Orders, payment links, payment methods | 
Callbacks | getCallbacksFacade() | Webhook verification and processing | 
Refunds | getRefundsFacade() | Refund initiation and statuses | 
Project Eligibility | getProjectEligibilityFacade() | Whether the store may collect payments | 
Merchant Area | getMerchantAreaFacade() | Project-specific Merchant Area deeplinks | 
Translations | getTranslationsFacade() | Localized strings for SDK and plugin namespaces | 
Infrastructure | getInfrastructureFacade() | Logger, HTTP client, support contacts | 

### Facade Access​

```
$sdkFacade = (new SdkFacadeBuilder())->build();$authFacade = $sdkFacade->getAuthorizationFacade();$paymentsFacade = $sdkFacade->getPaymentsFacade();$callbacksFacade = $sdkFacade->getCallbacksFacade();$refundsFacade = $sdkFacade->getRefundsFacade();
```

## Configuration​

### With Token Persistence​

```
$sdkFacade = (new SdkFacadeBuilder())    ->setPaymentApiAuthTokenRepository($myTokenRepository)    ->setPaymentApiCredentialsRepository($myCredentialsRepository)    ->build();
```

### With Custom Logger​

```
use Psr\Log\LoggerInterface;$sdkFacade = (new SdkFacadeBuilder())    ->setLogger($myLogger)  // PSR-3 compatible logger    ->build();
```

Production checklist
Inject a persistent PSR-6 cache pool via setCacheItemPool() and set finite timeouts on the PSR-18 HTTP client. The default in-memory cache re-fetches the JWKS key set on every request in PHP-FPM deployments. See Installation.

## Error Handling​

The SDK throws typed exceptions:

```
use Paysera\CheckoutSdk\Exception\IntegrationException;use Paysera\CheckoutSdk\Exception\ValidationException;try {    $response = $paymentsFacade->initiatePayment($orderRequest, $linkRequest);} catch (ValidationException $e) {    // Invalid request data    echo "Validation error: " . $e->getMessage();} catch (IntegrationException $e) {    // API or network error    echo "Integration error: " . $e->getMessage();}
```

## Documentation​

- Installation - Installation and configuration

- Authorization - Authentication setup

- Payments - Creating payments

- Callbacks - Webhook handling

Features not covered by these pages are documented in the repository:

- Project Eligibility

- Merchant Area Deeplinks

- Translations

- Payment Method Logos

## Source Code​

The SDK is open source and available on GitHub at
github.com/paysera/lib-checkout-integration-sdk,
together with the full source, the
changelog
and the contribution guidelines.

Report security issues privately as described in
SECURITY.md —
please do not open public issues for security findings.