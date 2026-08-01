(function () {
    'use strict';

    var config = window.MustPortalQuickBooking || {};
    var strings = config.strings || {};

    function isValidDateString(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    }

    function normalizeDateValue(value) {
        var raw = String(value || '').trim();
        var match;

        if (isValidDateString(raw)) {
            return raw;
        }

        match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

        if (match) {
            return match[3] + '-' + String(match[1]).padStart(2, '0') + '-' + String(match[2]).padStart(2, '0');
        }

        return '';
    }

    function formatDate(date) {
        return String(date.getFullYear()) + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
    }

    function addDays(dateString, days) {
        if (!isValidDateString(dateString)) {
            return '';
        }

        var date = new Date(dateString + 'T00:00:00');

        if (Number.isNaN(date.getTime())) {
            return '';
        }

        date.setDate(date.getDate() + Number(days || 0));

        return formatDate(date);
    }

    function setStatus(statusEl, message, state) {
        if (!statusEl) {
            return;
        }

        statusEl.textContent = String(message || '');
        statusEl.dataset.state = String(state || '');
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, function (char) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            }[char] || char;
        });
    }

    function initDatePicker(input) {
        if (!input || typeof window.flatpickr !== 'function') {
            return;
        }

        window.flatpickr(input, {
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'm/d/Y',
            minDate: isValidDateString(config.today) ? String(config.today) : formatDate(new Date())
        });
    }

    function initQuickBookingSubmitForm(form) {
        var checkinInput = form.querySelector('[data-must-portal-checkin]');
        var checkoutInput = form.querySelector('[data-must-portal-checkout]');
        var roomInput = form.querySelector('[data-must-portal-modal-room-id]');
        var statusEl = form.querySelector('[data-must-portal-modal-status]');

        form.addEventListener('submit', function (event) {
            var checkin = normalizeDateValue(checkinInput ? checkinInput.value : '');
            var checkout = normalizeDateValue(checkoutInput ? checkoutInput.value : '');
            var roomId = roomInput ? parseInt(roomInput.value || '0', 10) : 0;

            if (checkinInput) {
                checkinInput.value = checkin;
            }

            if (checkoutInput) {
                checkoutInput.value = checkout;
            }

            if (!roomId) {
                event.preventDefault();
                setStatus(statusEl, 'Please select a room before continuing.', 'error');
                return;
            }

            if (!isValidDateString(checkin) || !isValidDateString(checkout) || checkout <= checkin) {
                event.preventDefault();
                setStatus(statusEl, strings.invalidDates || 'Please provide valid check-in and check-out dates.', 'error');
            }
        });
    }

    function initQuickBookingApp(app) {
        var roomTypeFilter = app.querySelector('[data-must-portal-room-type-filter]');
        var checkinInput = app.querySelector('[data-must-portal-search-checkin]');
        var checkoutInput = app.querySelector('[data-must-portal-search-checkout]');
        var guestsInput = app.querySelector('[data-must-portal-search-guests]');
        var searchButton = app.querySelector('[data-must-portal-search-button]');
        var resultsBody = app.querySelector('[data-must-portal-room-results]');
        var statusEl = app.querySelector('[data-must-portal-search-status]');
        var modal = app.querySelector('[data-must-portal-booking-modal]');
        var modalRoomLabel = app.querySelector('[data-must-portal-modal-room-label]');
        var modalRoomInput = app.querySelector('[data-must-portal-modal-room-id]');
        var modalCheckinInput = app.querySelector('[data-must-portal-modal-checkin]');
        var modalCheckoutInput = app.querySelector('[data-must-portal-modal-checkout]');
        var modalGuestsInput = app.querySelector('[data-must-portal-modal-guests]');
        var availableNonce = app.getAttribute('data-available-nonce') || '';
        var currentRequest = null;

        initDatePicker(checkinInput);
        initDatePicker(checkoutInput);

        function getSearchContext() {
            var checkin = normalizeDateValue(checkinInput ? checkinInput.value : '');
            var checkout = normalizeDateValue(checkoutInput ? checkoutInput.value : '');
            var guests = guestsInput ? parseInt(guestsInput.value || '1', 10) : 1;
            var roomTypeId = roomTypeFilter ? parseInt(roomTypeFilter.value || '0', 10) : 0;

            return {
                roomTypeId: Number.isFinite(roomTypeId) ? roomTypeId : 0,
                checkin: checkin,
                checkout: checkout,
                guests: Number.isFinite(guests) && guests > 0 ? guests : 1
            };
        }

        function renderEmpty(message) {
            if (!resultsBody) {
                return;
            }

            resultsBody.innerHTML = '<tr><td colspan="5">' + escapeHtml(message) + '</td></tr>';
        }

        function renderRooms(rooms, context) {
            if (!resultsBody) {
                return;
            }

            if (!Array.isArray(rooms) || !rooms.length) {
                renderEmpty('No available rooms found for the selected filters.');
                return;
            }

            resultsBody.innerHTML = rooms.map(function (room) {
                var id = parseInt(room.id || '0', 10);
                var name = room.name || ('#' + id);
                var roomType = room.room_type_name || room.category_label || room.type || '';
                var maxGuests = room.max_guests || '';
                var total = room.formatted_total || '';

                return '<tr>' +
                    '<td><strong>' + escapeHtml(name) + '</strong></td>' +
                    '<td>' + escapeHtml(roomType) + '</td>' +
                    '<td>' + escapeHtml(maxGuests) + '</td>' +
                    '<td>' + escapeHtml(total) + '</td>' +
                    '<td><button type="button" class="must-portal-secondary-button" data-must-portal-book-room="' + escapeHtml(id) + '"' +
                    ' data-room-label="' + escapeHtml(name) + '"' +
                    ' data-room-type="' + escapeHtml(roomType) + '"' +
                    '>Book</button></td>' +
                    '</tr>';
            }).join('');

            resultsBody.querySelectorAll('[data-must-portal-book-room]').forEach(function (button) {
                button.addEventListener('click', function () {
                    var roomId = parseInt(button.getAttribute('data-must-portal-book-room') || '0', 10);
                    var label = button.getAttribute('data-room-label') || '';
                    var type = button.getAttribute('data-room-type') || '';

                    if (!roomId || !modal) {
                        return;
                    }

                    if (modalRoomInput) {
                        modalRoomInput.value = String(roomId);
                    }

                    if (modalCheckinInput) {
                        modalCheckinInput.value = context.checkin;
                    }

                    if (modalCheckoutInput) {
                        modalCheckoutInput.value = context.checkout;
                    }

                    if (modalGuestsInput) {
                        modalGuestsInput.value = String(context.guests);
                    }

                    if (modalRoomLabel) {
                        modalRoomLabel.textContent = label + (type ? ' · ' + type : '') + ' · ' + context.checkin + ' → ' + context.checkout + ' · ' + context.guests + ' guest(s)';
                    }

                    modal.hidden = false;
                    document.documentElement.classList.add('must-portal-modal-open');
                });
            });
        }

        function searchRooms() {
            var context = getSearchContext();

            if (!isValidDateString(context.checkin) || !isValidDateString(context.checkout) || context.checkout <= context.checkin) {
                setStatus(statusEl, strings.invalidDates || 'Please provide valid check-in and check-out dates.', 'error');
                renderEmpty('Fix the dates and search again.');
                return;
            }

            if (currentRequest && typeof currentRequest.abort === 'function') {
                currentRequest.abort();
            }

            setStatus(statusEl, 'Loading available rooms...', 'loading');
            renderEmpty('Loading...');

            if (searchButton) {
                searchButton.disabled = true;
            }

            var body = new URLSearchParams();
            body.set('action', 'must_portal_quick_booking_available_rooms');
            body.set('nonce', availableNonce);
            body.set('room_type_id', String(context.roomTypeId));
            body.set('checkin', context.checkin);
            body.set('checkout', context.checkout);
            body.set('guests', String(context.guests));

            currentRequest = new AbortController();

            fetch(config.ajaxUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                },
                body: body.toString(),
                signal: currentRequest.signal
            })
                .then(function (response) {
                    return response.json();
                })
                .then(function (payload) {
                    if (!payload || !payload.success) {
                        throw new Error(payload && payload.data && payload.data.message ? payload.data.message : 'Unable to load available rooms.');
                    }

                    renderRooms(payload.data.rooms || [], context);
                    setStatus(statusEl, 'Available rooms loaded.', 'success');
                })
                .catch(function (error) {
                    if (error && error.name === 'AbortError') {
                        return;
                    }

                    renderEmpty(error && error.message ? error.message : 'Unable to load available rooms.');
                    setStatus(statusEl, error && error.message ? error.message : 'Unable to load available rooms.', 'error');
                })
                .finally(function () {
                    currentRequest = null;

                    if (searchButton) {
                        searchButton.disabled = false;
                    }
                });
        }

        if (searchButton) {
            searchButton.addEventListener('click', searchRooms);
        }

        app.querySelectorAll('[data-must-portal-modal-close]').forEach(function (button) {
            button.addEventListener('click', function () {
                if (modal) {
                    modal.hidden = true;
                }

                document.documentElement.classList.remove('must-portal-modal-open');
            });
        });

        searchRooms();
    }

    document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-must-portal-quick-booking-app]').forEach(initQuickBookingApp);
    document.querySelectorAll('.must-portal-quick-booking-form').forEach(initQuickBookingSubmitForm);

    if (document.querySelector('[data-must-portal-success-modal]')) {
        document.documentElement.classList.add('must-portal-modal-open');
    }

    document.querySelectorAll('[data-must-portal-success-close]').forEach(function (button) {
        button.addEventListener('click', function () {
            var modal = button.closest('[data-must-portal-success-modal]');
            var cleanUrl = button.getAttribute('data-clean-url') || '';

            if (modal) {
                modal.hidden = true;
            }

            document.documentElement.classList.remove('must-portal-modal-open');

            if (cleanUrl && window.history && window.history.replaceState) {
                window.history.replaceState({}, document.title, cleanUrl);
            }
        });
    });
});
})();