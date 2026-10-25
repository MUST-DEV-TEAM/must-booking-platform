/* Currency switcher: shows prices in another currency, display only. */
(function () {
    'use strict';

    var STORAGE_KEY = 'mustCurrency';
    var switchers = Array.prototype.slice.call(document.querySelectorAll('.must-currency-switcher'));
    if (!switchers.length || !window.mustCurrencyConfig) {
        return;
    }

    function read() {
        try {
            return window.localStorage.getItem(STORAGE_KEY) || '';
        } catch (error) {
            return '';
        }
    }

    function write(code) {
        try {
            window.localStorage.setItem(STORAGE_KEY, code);
        } catch (error) {
            /* storage can be blocked; the choice then lasts for this page only */
        }
    }

    var first = switchers[0];
    var currencies = (first.getAttribute('data-currencies') || '').split(',').filter(Boolean);
    var fallback = first.getAttribute('data-default') || currencies[0];
    var note = first.getAttribute('data-note') || '';
    var rates = null;
    var current = read();
    if (currencies.indexOf(current) === -1) {
        current = fallback;
    }

    function format(amount, code) {
        try {
            return new Intl.NumberFormat(document.documentElement.lang || undefined, {
                style: 'currency',
                currency: code,
                maximumFractionDigits: amount >= 100 ? 0 : 2
            }).format(amount);
        } catch (error) {
            return amount.toFixed(2) + ' ' + code;
        }
    }

    function render() {
        var prices = document.querySelectorAll('.must-price[data-amount]');
        Array.prototype.forEach.call(prices, function (node) {
            if (!node.hasAttribute('data-original')) {
                node.setAttribute('data-original', node.textContent);
            }
            var hotelCurrency = node.getAttribute('data-currency');
            var amount = parseFloat(node.getAttribute('data-amount'));
            if (!rates || current === hotelCurrency || !isFinite(amount)) {
                node.textContent = node.getAttribute('data-original');
                node.removeAttribute('data-converted');
                return;
            }
            // Rates are expressed from the hotel currency; a price in another currency is left alone.
            if (rates.base !== hotelCurrency || !rates.rates[current]) {
                node.textContent = node.getAttribute('data-original');
                return;
            }
            node.textContent = '≈ ' + format(amount * rates.rates[current], current);
            node.setAttribute('data-converted', 'true');
        });
        var anyConverted = document.querySelector('.must-price[data-converted]');
        var existing = document.querySelector('.must-currency-note');
        if (anyConverted && note) {
            if (!existing) {
                existing = document.createElement('p');
                existing.className = 'must-currency-note';
                var target = document.querySelector('.must-hotel-booking-page-checkout, .must-hotel-booking-page-accommodation, main');
                if (target) {
                    target.insertBefore(existing, target.firstChild);
                }
            }
            if (existing) {
                existing.textContent = note;
            }
        } else if (existing) {
            existing.parentNode.removeChild(existing);
        }
        switchers.forEach(function (switcher) {
            var select = switcher.querySelector('select');
            if (select && select.value !== current) {
                select.value = current;
            }
        });
    }

    switchers.forEach(function (switcher) {
        var select = switcher.querySelector('select');
        if (!select) {
            return;
        }
        select.value = current;
        select.addEventListener('change', function () {
            current = select.value;
            write(current);
            render();
        });
    });

    var url = window.mustCurrencyConfig.ajaxUrl +
        '?action=must_hotel_booking_exchange_rates&currencies=' + encodeURIComponent(currencies.join(','));
    window.fetch(url, { credentials: 'same-origin' })
        .then(function (response) { return response.json(); })
        .then(function (payload) {
            if (payload && payload.success && payload.data && payload.data.rates) {
                rates = payload.data;
                render();
            }
        })
        .catch(function () { /* without rates the real prices simply stay as they are */ });
}());
