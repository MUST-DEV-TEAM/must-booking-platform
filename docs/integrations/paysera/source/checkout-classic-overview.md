- 
- Checkout Classic Overview
# Checkout Classic Overview

Paysera Checkout Classic enables merchants to accept payments on their websites and applications using a redirect-based payment flow.

Copy Page Content
Try our Checkout Demo

## How It Works​

The Checkout API uses a redirect-based payment flow:

- Generate Payment Link - Your application creates a payment request with order details (amount, currency, customer information) and generates a signed payment link

- Redirect to Paysera - The customer is redirected to the Paysera payment website using the generated link, which securely stores all payment information

- Customer Completes Payment - The customer selects their preferred payment method (card, bank transfer, e-wallet) and completes the transaction on Paysera's secure payment page

- Return to Merchant - After payment completion (successful or cancelled), the customer is automatically redirected back to a URL you specified during setup

- Payment Confirmation - Paysera sends a callback notification to your server with the payment result, allowing you to update order status and fulfill the purchase

This flow ensures that sensitive payment data never passes through your servers, maintaining PCI compliance while providing a seamless payment experience.

## Key Features​

- Accept payments via cards, bank transfers, and PIS. You can find all available Checkout payment methods here

- Support for multiple currencies and countries

- Automatic payment confirmations via callbacks

- Periodic payments support

## Next Steps​

- Follow the Obtaining Credentials guide to set up your integration

- Explore Checkout API documentation

- Check FAQ for common questions

- Check Examples for implementation guidance

## Support​

Need help with complex integrations?

Contact: tech_support@paysera.com