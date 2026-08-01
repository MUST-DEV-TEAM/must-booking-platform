document.addEventListener('DOMContentLoaded', function () {
    var paymentInputs = Array.prototype.slice.call(
        document.querySelectorAll('.must-confirmation-payment-option input[type="radio"][name="payment_method"]')
    );
    var ctaText = document.querySelector('.must-confirmation-submit span');

    if (paymentInputs.length && ctaText) {
        var syncCtaLabel = function () {
            var selectedInput = paymentInputs.find(function (input) {
                return input.checked;
            });

            if (!selectedInput) {
                return;
            }

            var ctaLabel = selectedInput.getAttribute('data-cta-label');

            if (ctaLabel) {
                ctaText.textContent = ctaLabel;
            }
        };

        paymentInputs.forEach(function (input) {
            input.addEventListener('change', syncCtaLabel);
        });

        syncCtaLabel();
    }

    var config = window.mustHotelBookingPokPay || null;
    var container = document.getElementById('pok-payment-container');

    if (!config || !container) {
        return;
    }

    var statusEl = document.querySelector('[data-pokpay-status]');
    var messages = config.messages || {};
    var setStatus = function (message) {
        if (statusEl) {
            statusEl.textContent = message || '';
        }
    };
    var logError = function (error) {
        if (!config.errorUrl || !window.fetch) {
            return;
        }

        window.fetch(config.errorUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': String(config.nonce || '')
            },
            body: JSON.stringify({
                order_id: config.orderId || '',
                message: error && error.message ? String(error.message) : '',
                code: error && error.code ? String(error.code) : ''
            })
        }).catch(function () {});
    };
    var finalizePayment = function () {
        if (!window.fetch || !config.finalizeUrl) {
            setStatus(messages.failed || 'Payment failed. Please try again.');
            return;
        }

        setStatus(messages.processing || 'Confirming your payment...');

        window.fetch(config.finalizeUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': String(config.nonce || '')
            },
            body: JSON.stringify({
                order_id: config.orderId || ''
            })
        })
            .then(function (response) {
                return response.json().then(function (payload) {
                    return {
                        ok: response.ok,
                        payload: payload || {}
                    };
                });
            })
            .then(function (result) {
                var payload = result.payload || {};

                if (result.ok && payload.success && payload.redirect_url) {
                    window.location.href = payload.redirect_url;
                    return;
                }

                if (result.ok && payload.state === 'pending') {
                    setStatus(payload.message || messages.pending || 'Payment is still finalizing.');
                    return;
                }

                setStatus(payload.message || messages.failed || 'Payment failed. Please try again.');
            })
            .catch(function () {
                setStatus(messages.failed || 'Payment failed. Please try again.');
            });
    };

    setStatus(messages.loading || 'Loading secure checkout...');

    if (!window.PokPayment || typeof window.PokPayment.renderForm !== 'function') {
        setStatus(messages.unavailable || 'PokPay checkout could not load. Please refresh and try again.');
        return;
    }

    try {
        window.PokPayment.renderForm(
            'pok-payment-container',
            String(config.orderId || ''),
            finalizePayment,
            function (error) {
                logError(error || {});
                setStatus(messages.failed || 'Payment failed. Please try again.');
            },
            {
                env: config.env || 'staging',
                locale: config.locale || 'en',
                initialState: config.initialState || {}
            }
        );
    } catch (error) {
        logError(error || {});
        setStatus(messages.unavailable || 'PokPay checkout could not load. Please refresh and try again.');
    }
});
