(function () {
    'use strict';

    var config = window.mustHotelBookingAdminQuickBooking || null;

    if (!config || !config.ajaxUrl || !config.previewAction) {
        return;
    }

    var forms = document.querySelectorAll('.must-quick-booking-form');

    if (!forms.length) {
        return;
    }

    var debounce = function (fn, wait) {
        var timerId = null;

        return function () {
            var args = arguments;
            clearTimeout(timerId);
            timerId = setTimeout(function () {
                fn.apply(null, args);
            }, wait);
        };
    };

    var setStatus = function (statusElement, text, level) {
        if (!statusElement) {
            return;
        }

        statusElement.textContent = text;
        statusElement.classList.remove('is-info', 'is-success', 'is-error');
        statusElement.classList.add(level);
    };

    var setPrice = function (priceElement, text) {
        if (!priceElement) {
            return;
        }

        priceElement.textContent = text;
    };

    forms.forEach(function (form) {
        var roomField = form.querySelector('[name="room_id"]');
        var checkinField = form.querySelector('[name="checkin"]');
        var checkoutField = form.querySelector('[name="checkout"]');
        var guestsField = form.querySelector('[name="guests"]');
        var statusElement = form.querySelector('.must-quick-booking-status');
        var priceElement = form.querySelector('.must-quick-booking-price-value');
        var submitButton = form.querySelector('button[type="submit"]');

        if (!roomField || !checkinField || !checkoutField || !guestsField) {
            return;
        }

        var requestPreview = function () {
            var roomId = roomField.value.trim();
            var checkin = checkinField.value.trim();
            var checkout = checkoutField.value.trim();
            var guests = guestsField.value.trim();

            if (!roomId || !checkin || !checkout || !guests) {
                setStatus(statusElement, config.strings.incomplete, 'is-info');
                setPrice(priceElement, config.strings.priceUnavailable || '-');

                if (submitButton) {
                    submitButton.disabled = true;
                }

                return;
            }

            setStatus(statusElement, config.strings.checking, 'is-info');

            if (submitButton) {
                submitButton.disabled = true;
            }

            var body = new URLSearchParams();
            body.set('action', config.previewAction);
            body.set('nonce', config.previewNonce);
            body.set('room_id', roomId);
            body.set('checkin', checkin);
            body.set('checkout', checkout);
            body.set('guests', guests);

            fetch(config.ajaxUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                },
                credentials: 'same-origin',
                body: body.toString()
            })
                .then(function (response) {
                    return response.json();
                })
                .then(function (payload) {
                    if (!payload || !payload.success || !payload.data) {
                        throw new Error('Invalid response payload');
                    }

                    var data = payload.data;
                    var message = data.message || '';

                    if (!data.available) {
                        setStatus(statusElement, message || config.strings.unavailable, 'is-error');
                        setPrice(priceElement, config.strings.priceUnavailable || '-');

                        if (submitButton) {
                            submitButton.disabled = true;
                        }

                        return;
                    }

                    var priceText = data.formatted_total_price || config.strings.priceUnavailable || '-';

                    if (data.currency) {
                        priceText += ' ' + data.currency;
                    }

                    setStatus(statusElement, message || config.strings.available, 'is-success');
                    setPrice(priceElement, priceText.trim());

                    if (submitButton) {
                        submitButton.disabled = false;
                    }
                })
                .catch(function () {
                    setStatus(statusElement, config.strings.requestFailed, 'is-error');
                    setPrice(priceElement, config.strings.priceUnavailable || '-');

                    if (submitButton) {
                        submitButton.disabled = true;
                    }
                });
        };

        var debouncedPreview = debounce(requestPreview, 250);
        roomField.addEventListener('change', debouncedPreview);
        checkinField.addEventListener('change', debouncedPreview);
        checkoutField.addEventListener('change', debouncedPreview);
        guestsField.addEventListener('change', debouncedPreview);
        guestsField.addEventListener('input', debouncedPreview);

        requestPreview();
    });
})();
