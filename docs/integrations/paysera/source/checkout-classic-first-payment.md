- 
- Checkout Classic
- Making Your First Payment
# Making Your First Payment

This guide will walk you through the process of implementing your first payment using the Paysera Checkout API. Before proceeding, make sure you have completed the Obtaining Credentials steps and have your project_id and project_password ready.

Copy Page Content

## Understanding Your Integration Options​

Paysera offers three different integration methods to suit your technical environment and business needs. Your choice depends on the platform you're using and the level of customization you require.

### The Three Methods​

- Paysera Plugins - Pre-built plugins for popular e-commerce platforms

- PHP Library Integration - Official PHP SDK for custom applications

- Custom Integration - Direct API integration for any language

Important
All three methods accomplish the same goal: generating a secure payment link that you can send to your customers. However, they differ significantly in ease of implementation versus functionality and customizability.

## What You'll Be Building​

In this guide, you'll learn how to generate a payment link that can be sent to your customers. This link directs them to a secure Paysera payment page where they can complete their purchase using their preferred payment method.

### Example Payment Link​

Here's what a complete payment link looks like:

https://www.paysera.com/pay/?data=cHJvamVjdGlkPSU3QllvdXIrUG9yamVjdCtJRCU3RCZvcmRlcmlkPSU3Qm9yZGVyK251bWJlciU3RCZhY2NlcHR1cmw9JTdCYWNjZXB0VVJMJTdEJmNhbmNlbHVybD0lN0JjYW5jZWxVUkwlN0QmY2FsbGJhY2s9JTdCY2FsbGJhY2tVUkwlN0QmdmVyc2lvbj0xLjg%3D&sign=70787dd83d7f839a89d21921540342a7

#### Understanding the URL Structure​

The payment link consists of three main parts:

- 
Base URL - https://www.paysera.com/pay/

- The Paysera payment gateway endpoint

- Always the same for all payments

- 
data parameter - Base64 encoded payment information

- Contains all payment details (project ID, order ID, amount, currency, URLs)

- Encoded to safely transmit data in the URL

- When decoded, contains JSON with your payment parameters

- 
sign parameter - MD5 signature for security

- Cryptographic signature created from data + your project password

- Ensures the payment request hasn't been tampered with

- Validates that the request came from your system

## Choosing the Right Method​

### Paysera Plugins​

Best for: E-commerce platforms like WooCommerce, PrestaShop, Magento, or OpenCart

✅ Advantages:

- Quickest implementation

- No coding required

- Simple configuration

- Pre-tested and reliable

- Automatic updates

❌ Limitations:

- Limited to supported platforms

- Less customization options

- Fixed payment flows

- Plugin-specific constraints

Difficulty: ⭐ Easiest - No technical knowledge required

Learn more about Paysera Plugins →

### PHP Library Integration​

Best for: Custom PHP applications and websites

✅ Advantages:

- Balanced ease of use and flexibility

- Automatic request signing

- Built-in security handling

- Type safety and IDE support

- Regular updates from Paysera

❌ Limitations:

- Requires PHP 7.4+

- Limited to PHP environments

- Some learning curve required

Difficulty: ⭐⭐ Moderate - Requires PHP knowledge

Learn more about PHP Library Integration →

### Custom Integration​

Best for: Any programming language, unique requirements, full control

✅ Advantages:

- Works with any programming language

- Complete control over implementation

- Maximum customization

- No external dependencies

- Direct API access

❌ Limitations:

- Most complex to implement

- Manual security handling

- Request signing required

- More code to maintain

- Higher risk of errors

Difficulty: ⭐⭐⭐ Complex - Requires understanding of security, signing, and callbacks

Learn more about Custom Integration →