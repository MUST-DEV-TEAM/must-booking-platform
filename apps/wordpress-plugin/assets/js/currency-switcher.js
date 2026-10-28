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
                node.removeAttribute('data-converted');
                node.textContent = node.getAttribute('data-original');
                return;
            }
            // The converted amount is for reading only; what the guest really pays stays visible beside it.
            node.textContent = '≈ ' + format(amount * rates.rates[current], current) +
                ' (' + node.getAttribute('data-original') + ')';
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
            var label = switcher.querySelector('.must-currency-current');
            if (label) {
                label.textContent = current;
            }
            Array.prototype.forEach.call(switcher.querySelectorAll('.must-currency-option'), function (option) {
                option.setAttribute('aria-selected', option.getAttribute('data-value') === current ? 'true' : 'false');
            });
        });
    }

    function setOpen(switcher, open) {
        var trigger = switcher.querySelector('.must-currency-trigger');
        switcher.classList.toggle('is-open', open);
        if (trigger) {
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        var active = switcher.querySelector('.must-currency-option.is-active');
        if (active) {
            active.classList.remove('is-active');
        }
        // Keep the panel inside the screen on very narrow phones.
        var menu = switcher.querySelector('.must-currency-menu');
        if (menu) {
            menu.style.right = '';
            if (open) {
                var left = menu.getBoundingClientRect().left;
                if (left < 8) {
                    menu.style.right = (left - 8) + 'px';
                }
            }
        }
    }

    function choose(value) {
        current = value;
        write(current);
        render();
    }

    switchers.forEach(function (switcher) {
        var trigger = switcher.querySelector('.must-currency-trigger');
        var menu = switcher.querySelector('.must-currency-menu');
        if (!trigger || !menu) {
            return;
        }


        trigger.addEventListener('click', function () {
            setOpen(switcher, !switcher.classList.contains('is-open'));
        });

        menu.addEventListener('click', function (event) {
            var option = event.target.closest('.must-currency-option');
            if (!option || !menu.contains(option)) return;
            choose(option.getAttribute('data-value'));
            setOpen(switcher, false);
            trigger.focus();
        });

        switcher.addEventListener('keydown', function (event) {
            var open = switcher.classList.contains('is-open');
            if (event.key === 'Escape' && open) {
                setOpen(switcher, false);
                trigger.focus();
                return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            if (!open) {
                if (event.target === trigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault();
                    setOpen(switcher, true);
                }
                return;
            }
            var options = Array.prototype.slice.call(menu.querySelectorAll('.must-currency-option'));
            var index = options.findIndex(function (option) { return option.classList.contains('is-active'); });
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                var next = event.key === 'ArrowDown' ? index + 1 : index - 1;
                if (index === -1) {
                    next = event.key === 'ArrowDown' ? 0 : options.length - 1;
                }
                next = (next + options.length) % options.length;
                options.forEach(function (option) { option.classList.remove('is-active'); });
                options[next].classList.add('is-active');
                options[next].scrollIntoView({ block: 'nearest' });
            } else if (index !== -1 && event.target !== trigger) {
                event.preventDefault();
                options[index].click();
            } else if (index !== -1) {
                event.preventDefault();
                options[index].click();
            }
        });
    });

    document.addEventListener('click', function (event) {
        switchers.forEach(function (switcher) {
            if (!switcher.contains(event.target)) {
                setOpen(switcher, false);
            }
        });
    });

    render();

    var url = window.mustCurrencyConfig.ajaxUrl +
        '?action=must_hotel_booking_exchange_rates&currencies=' + encodeURIComponent(currencies.join(','));
    window.fetch(url, { credentials: 'same-origin' })
        .then(function (response) { return response.json(); })
        .then(function (payload) {
            if (payload && payload.success && payload.data && payload.data.rates) {
                rates = payload.data;
                if (Array.isArray(rates.displayCurrencies)) {
                    currencies = [rates.base].concat(rates.displayCurrencies).filter(function (code, index, all) { return all.indexOf(code) === index; });
                    if (currencies.indexOf(current) === -1) current = rates.base;
                    switchers.forEach(function (switcher) {
                        var menu = switcher.querySelector('.must-currency-menu');
                        var template = menu && menu.querySelector('.must-currency-option');
                        if (!template) return;
                        var model = template.cloneNode(true);
                        menu.textContent = '';
                        currencies.forEach(function (code) {
                            var option = model.cloneNode(true);
                            option.setAttribute('data-value', code);
                            option.classList.remove('is-active');
                            option.querySelector('.must-currency-code').textContent = code;
                            option.querySelector('.must-currency-name').textContent = (window.mustCurrencyConfig.currencyNames || {})[code] || code;
                            menu.appendChild(option);
                        });
                    });
                }
                render();
            }
        })
        .catch(function () { /* without rates the real prices simply stay as they are */ });
}());
