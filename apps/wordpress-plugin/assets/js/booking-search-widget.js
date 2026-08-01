(function () {
    'use strict';

    var config = window.mustHotelBookingWidgetConfig || {};

    function isValidYmd(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    }

    function formatYmd(date) {
        var year = String(date.getFullYear());
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');

        return year + '-' + month + '-' + day;
    }

    function getTodayYmd() {
        if (isValidYmd(config.today)) {
            return String(config.today);
        }

        return formatYmd(new Date());
    }

    function addDays(ymdDate, days) {
        if (!isValidYmd(ymdDate)) {
            return ymdDate;
        }

        var date = new Date(ymdDate + 'T00:00:00');

        if (Number.isNaN(date.getTime())) {
            return ymdDate;
        }

        date.setDate(date.getDate() + Number(days || 0));
        return formatYmd(date);
    }

    function getMaxDateYmd(todayYmd) {
        if (isValidYmd(config.maxDate)) {
            return String(config.maxDate);
        }

        var windowDays = parseInt(String(config.bookingWindowDays || '365'), 10);

        if (!Number.isFinite(windowDays) || windowDays < 1) {
            windowDays = 365;
        }

        return addDays(todayYmd, windowDays);
    }

    function sanitizeGuestsValue(input, allowEmpty) {
        if (!input) {
            return;
        }

        var maxGuests = parseInt(String(config.maxGuests || '5'), 10);

        if (!Number.isFinite(maxGuests) || maxGuests < 1) {
            maxGuests = 5;
        }

        var digitsOnly = String(input.value || '').replace(/[^\d]/g, '');

        if (digitsOnly === '' && allowEmpty) {
            input.value = '';
            return;
        }

        if (digitsOnly === '') {
            digitsOnly = '1';
        }

        var numeric = parseInt(digitsOnly, 10);

        if (!Number.isFinite(numeric) || numeric < 1) {
            numeric = 1;
        }

        if (numeric > maxGuests) {
            numeric = maxGuests;
        }

        input.value = String(numeric);
    }

    function attachNumericGuestsGuard(input) {
        if (!input || input.dataset.mustGuestsGuard === '1') {
            return;
        }

        input.dataset.mustGuestsGuard = '1';
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('pattern', '[0-9]*');
        input.setAttribute('max', String(parseInt(String(config.maxGuests || '5'), 10) || 5));

        input.addEventListener('keydown', function (event) {
            var blockedKeys = ['e', 'E', '+', '-', '.', ',', ' '];

            if (blockedKeys.indexOf(event.key) !== -1) {
                event.preventDefault();
            }
        });

        input.addEventListener('input', function () {
            sanitizeGuestsValue(input, true);
        });

        input.addEventListener('blur', function () {
            sanitizeGuestsValue(input, true);
        });
    }

    function buildFlatpickrCommonOptions(todayYmd, maxDateYmd) {
        return {
            dateFormat: String(config.queryDateFormat || 'Y-m-d'),
            altInput: true,
            altFormat: String(config.displayDateFormat || 'd/m/Y'),
            allowInput: false,
            clickOpens: true,
            position: 'above left',
            monthSelectorType: 'dropdown',
            disableMobile: true,
            minDate: todayYmd,
            maxDate: maxDateYmd,
            onReady: function (selectedDates, dateStr, instance) {
                if (!instance || !instance.altInput) {
                    return;
                }

                var placeholder = instance.input && instance.input.getAttribute('placeholder')
                    ? instance.input.getAttribute('placeholder')
                    : '';

                if (placeholder) {
                    instance.altInput.setAttribute('placeholder', placeholder);
                }
            }
        };
    }

    function getLinkedRoomListId(form) {
        if (!form || !form.closest) {
            return '';
        }

        var widgetNode = form.closest('.must-hotel-booking-widget-booking-search');

        if (!widgetNode) {
            return '';
        }

        return String(widgetNode.getAttribute('data-linked-room-list-id') || '').trim();
    }

    function getSearchConnectionKey(form) {
        if (!form || !form.closest) {
            return '';
        }

        var widgetNode = form.closest('.must-hotel-booking-widget-booking-search');

        if (!widgetNode) {
            return '';
        }

        return String(widgetNode.getAttribute('data-connection-key') || '').trim();
    }

    function getLinkedRoomCategoryByWidgetId(scope, widgetId) {
        if (!widgetId) {
            return '';
        }

        var roomsWidgets = scope.querySelectorAll('.must-hotel-booking-rooms-list-widget[data-room-list-widget-id]');
        var matchedCategory = '';

        roomsWidgets.forEach(function (widgetNode) {
            if (matchedCategory !== '') {
                return;
            }

            var currentWidgetId = String(widgetNode.getAttribute('data-room-list-widget-id') || '').trim();

            if (currentWidgetId !== widgetId) {
                return;
            }

            matchedCategory = String(widgetNode.getAttribute('data-room-category') || '').trim();
        });

        if (matchedCategory === '' || matchedCategory === 'all') {
            return '';
        }

        return matchedCategory;
    }

    function getLinkedRoomCategory(form) {
        var scope = form && form.ownerDocument ? form.ownerDocument : document;
        var linkedRoomListId = getLinkedRoomListId(form);

        if (linkedRoomListId !== '') {
            var linkedCategory = getLinkedRoomCategoryByWidgetId(scope, linkedRoomListId);

            if (linkedCategory !== '') {
                return linkedCategory;
            }
        }

        var connectionKey = getSearchConnectionKey(form);

        if (connectionKey === '') {
            return '';
        }

        var roomsWidgets = scope.querySelectorAll('.must-hotel-booking-rooms-list-widget[data-connection-key]');
        var matchedCategory = '';

        roomsWidgets.forEach(function (widgetNode) {
            if (matchedCategory !== '') {
                return;
            }

            var widgetConnectionKey = String(widgetNode.getAttribute('data-connection-key') || '').trim();

            if (widgetConnectionKey !== connectionKey) {
                return;
            }

            matchedCategory = String(widgetNode.getAttribute('data-room-category') || '').trim();
        });

        if (matchedCategory === '' || matchedCategory === 'all') {
            return '';
        }

        return matchedCategory;
    }

    function syncLinkedAccommodationTypeInput(form) {
        if (!form) {
            return;
        }

        var linkedCategory = getLinkedRoomCategory(form);
        var hiddenInput = form.querySelector('.must-hotel-booking-linked-accommodation-type');

        if (linkedCategory === '') {
            if (hiddenInput) {
                hiddenInput.disabled = true;
                hiddenInput.value = '';
            }

            return;
        }

        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = 'accommodation_type';
            hiddenInput.className = 'must-hotel-booking-linked-accommodation-type';
            form.appendChild(hiddenInput);
        }

        hiddenInput.disabled = false;
        hiddenInput.value = linkedCategory;
    }

    function initializeBookingSearch(scope) {
        var container = scope || document;
        var forms = container.querySelectorAll('.must-hotel-booking-booking-search');

        forms.forEach(function (form) {
            if (form.dataset.mustHotelBookingReady === '1') {
                return;
            }

            form.dataset.mustHotelBookingReady = '1';

            var bookingMode = String(form.getAttribute('data-must-hotel-booking-mode') || 'plugin_checkout');
            var isWbeInline = bookingMode === 'clock_wbe_inline';
            var checkinInput = form.querySelector('.must-hotel-booking-checkin');
            var checkoutInput = form.querySelector('.must-hotel-booking-checkout');
            var guestsInput = form.querySelector('.must-hotel-booking-field-guests input');

            attachNumericGuestsGuard(guestsInput);
            sanitizeGuestsValue(guestsInput, true);

            if (!isWbeInline) {
                syncLinkedAccommodationTypeInput(form);

                form.addEventListener('submit', function () {
                    syncLinkedAccommodationTypeInput(form);
                    sanitizeGuestsValue(guestsInput, false);
                });
            } else if (guestsInput) {
                form.addEventListener('submit', function () {
                    sanitizeGuestsValue(guestsInput, true);
                });
            }

            if (typeof window.flatpickr !== 'function' || !checkinInput || !checkoutInput) {
                return;
            }

            var todayYmd = getTodayYmd();
            var maxDateYmd = getMaxDateYmd(todayYmd);
            var commonOptions = buildFlatpickrCommonOptions(todayYmd, maxDateYmd);
            var checkoutMinDateDefault = addDays(todayYmd, 1);
            var checkoutPicker = window.flatpickr(checkoutInput, Object.assign({}, commonOptions, {
                minDate: checkoutMinDateDefault
            }));

            window.flatpickr(checkinInput, Object.assign({}, commonOptions, {
                onChange: function (selectedDates, checkinValue) {
                    if (!checkoutPicker) {
                        return;
                    }

                    if (!selectedDates || selectedDates.length === 0 || !isValidYmd(checkinValue)) {
                        checkoutPicker.set('minDate', checkoutMinDateDefault);
                        return;
                    }

                    var minCheckout = addDays(checkinValue, 1);
                    checkoutPicker.set('minDate', minCheckout);

                    if (isValidYmd(checkoutInput.value) && checkoutInput.value < minCheckout) {
                        checkoutPicker.clear();
                    }

                    checkoutPicker.open();
                }
            }));

            if (isValidYmd(checkinInput.value)) {
                checkoutPicker.set('minDate', addDays(checkinInput.value, 1));
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initializeBookingSearch(document);
        });
    } else {
        initializeBookingSearch(document);
    }

    if (window.elementorFrontend && window.elementorFrontend.hooks) {
        window.elementorFrontend.hooks.addAction(
            'frontend/element_ready/must_hotel_booking_booking_search.default',
            function ($scope) {
                if ($scope && $scope[0]) {
                    initializeBookingSearch($scope[0]);
                }
            }
        );
    }
})();
