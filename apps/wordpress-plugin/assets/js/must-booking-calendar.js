(function () {
    'use strict';
    var c = window.mustHotelBookingCalendar || {};
    if (!window.flatpickr) return;
    var checkinField = document.querySelector('#must-booking-checkin');
    var checkoutField = document.querySelector('#must-booking-checkout');
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function populateMonthYear(monthSelect, yearSelect) {
        if (monthSelect && !monthSelect.options.length) {
            monthNames.forEach(function (name, index) {
                var option = document.createElement('option');
                option.value = String(index);
                option.textContent = name;
                monthSelect.appendChild(option);
            });
        }
        if (yearSelect && !yearSelect.options.length) {
            var startYear = new Date().getFullYear();
            for (var y = startYear; y <= startYear + 2; y++) {
                var yearOption = document.createElement('option');
                yearOption.value = String(y);
                yearOption.textContent = String(y);
                yearSelect.appendChild(yearOption);
            }
        }
    }
    var todayDate = new Date(), todayYear = todayDate.getFullYear(), todayMonth = todayDate.getMonth();
    function refreshMonthOptions(monthSelect, yearSelect) {
        if (!monthSelect || !yearSelect) return;
        var isCurrentYear = Number(yearSelect.value) === todayYear;
        Array.prototype.forEach.call(monthSelect.options, function (opt) {
            opt.disabled = isCurrentYear && Number(opt.value) < todayMonth;
        });
    }
    function updatePrevVisibility(picker, prevButton) {
        if (!prevButton) return;
        var atStart = picker.currentYear === todayYear && picker.currentMonth === todayMonth;
        prevButton.style.display = atStart ? 'none' : '';
    }
    function syncMonthYear(monthSelect, yearSelect, picker) {
        if (monthSelect) monthSelect.value = String(picker.currentMonth);
        if (yearSelect) yearSelect.value = String(picker.currentYear);
        refreshMonthOptions(monthSelect, yearSelect);
    }
    function wireMonthYear(monthSelect, yearSelect, picker) {
        var onPick = function () {
            if (!monthSelect || !yearSelect) return;
            refreshMonthOptions(monthSelect, yearSelect);
            picker.jumpToDate(new Date(Number(yearSelect.value), Number(monthSelect.value), 1));
        };
        if (monthSelect) monthSelect.addEventListener('change', onPick);
        if (yearSelect) yearSelect.addEventListener('change', onPick);
    }
    function updateArrivalDeparture(startsOn, endsOn) {
        var parts = {
            arrivalDay: document.querySelector('#must-booking-arrival-day'),
            arrivalMonth: document.querySelector('#must-booking-arrival-month'),
            departureDay: document.querySelector('#must-booking-departure-day'),
            departureMonth: document.querySelector('#must-booking-departure-month')
        };
        if (startsOn && parts.arrivalDay && parts.arrivalMonth) {
            var arrival = new Date(startsOn + 'T00:00:00');
            parts.arrivalDay.textContent = String(arrival.getDate()).padStart(2, '0');
            parts.arrivalMonth.textContent = monthNames[arrival.getMonth()];
        }
        if (endsOn && parts.departureDay && parts.departureMonth) {
            var departure = new Date(endsOn + 'T00:00:00');
            parts.departureDay.textContent = String(departure.getDate()).padStart(2, '0');
            parts.departureMonth.textContent = monthNames[departure.getMonth()];
        }
    }
    var todayStr = new Date().toISOString().slice(0, 10);
    var unavailableDates = {};
    var roomAvailability = c.roomAvailability || null;
    var loadedMonths = {};
    function dateKey(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }
    function monthKey(date) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    }
    function loadAvailabilityMonth(date) {
        if (!roomAvailability) return Promise.resolve();
        var month = monthKey(date);
        if (loadedMonths[month]) return loadedMonths[month];
        var requestBody = new URLSearchParams({
            action: 'must_booking_room_calendar',
            nonce: roomAvailability.nonce,
            month: month
        });
        loadedMonths[month] = window.fetch(roomAvailability.ajaxUrl, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: requestBody.toString()
        }).then(function (response) {
            if (!response.ok) throw new Error('Unable to load room availability.');
            return response.json();
        }).then(function (response) {
            if (!response || !response.success || !response.data || !Array.isArray(response.data.days)) return;
            response.data.days.forEach(function (day) {
                if (day && day.date && day.isAvailable === false) unavailableDates[day.date] = true;
            });
        }).catch(function () {
            delete loadedMonths[month];
        });
        return loadedMonths[month];
    }
    function roomDateIsUnavailable(date) { return unavailableDates[dateKey(date)] === true; }
    function refreshAvailability(picker) {
        if (!roomAvailability || !picker) return;
        loadAvailabilityMonth(new Date(picker.currentYear, picker.currentMonth, 1)).then(function () { picker.redraw(); });
    }
    function initializeCalendars() {
    if (c.calendarLayout === 'two_calendars') {
        var checkinHost = document.querySelector('#must-booking-checkin-calendar');
        var checkoutHost = document.querySelector('#must-booking-checkout-calendar');
        var checkinMonth = document.querySelector('#must-booking-checkin-month'), checkinYear = document.querySelector('#must-booking-checkin-year');
        var checkoutMonth = document.querySelector('#must-booking-checkout-month'), checkoutYear = document.querySelector('#must-booking-checkout-year');
        populateMonthYear(checkinMonth, checkinYear);
        populateMonthYear(checkoutMonth, checkoutYear);
        var checkoutPicker = null;
        if (checkoutHost) {
            checkoutPicker = window.flatpickr(checkoutHost, {
                inline: true, dateFormat: 'Y-m-d', minDate: todayStr,
                disable: roomAvailability ? [roomDateIsUnavailable] : [],
                defaultDate: checkoutField && checkoutField.value ? checkoutField.value : undefined,
                onChange: function (selectedDates, dateStr) { if (checkoutField) checkoutField.value = dateStr; updateArrivalDeparture(checkinField ? checkinField.value : '', dateStr); },
                onMonthChange: function (a, b, instance) { syncMonthYear(checkoutMonth, checkoutYear, instance); refreshAvailability(instance); },
                onYearChange: function (a, b, instance) { syncMonthYear(checkoutMonth, checkoutYear, instance); refreshAvailability(instance); }
            });
            checkoutPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(checkoutMonth, checkoutYear, checkoutPicker);
            wireMonthYear(checkoutMonth, checkoutYear, checkoutPicker);
            refreshAvailability(checkoutPicker);
        }
        if (checkinHost) {
            var checkinPicker = window.flatpickr(checkinHost, {
                inline: true, dateFormat: 'Y-m-d', minDate: todayStr,
                disable: roomAvailability ? [roomDateIsUnavailable] : [],
                defaultDate: checkinField && checkinField.value ? checkinField.value : undefined,
                onChange: function (selectedDates, dateStr) {
                    if (checkinField) checkinField.value = dateStr;
                    updateArrivalDeparture(dateStr, checkoutField ? checkoutField.value : '');
                    if (checkoutPicker && selectedDates[0]) {
                        var minCheckout = new Date(selectedDates[0].getTime() + 86400000);
                        checkoutPicker.set('minDate', minCheckout);
                    }
                },
                onMonthChange: function (a, b, instance) { syncMonthYear(checkinMonth, checkinYear, instance); updatePrevVisibility(instance, prevButton); refreshAvailability(instance); },
                onYearChange: function (a, b, instance) { syncMonthYear(checkinMonth, checkinYear, instance); updatePrevVisibility(instance, prevButton); refreshAvailability(instance); }
            });
            checkinPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(checkinMonth, checkinYear, checkinPicker);
            wireMonthYear(checkinMonth, checkinYear, checkinPicker);
            refreshAvailability(checkinPicker);
            var prevButton = document.querySelector('#must-booking-cal-prev');
            var nextInlineButton = document.querySelector('#must-booking-cal-next-inline');
            var nextButton = document.querySelector('#must-booking-cal-next');
            updatePrevVisibility(checkinPicker, prevButton);
            if (prevButton) prevButton.onclick = function () { checkinPicker.changeMonth(-1); };
            if (nextInlineButton) nextInlineButton.onclick = function () { checkinPicker.changeMonth(1); };
            if (nextButton) nextButton.onclick = function () { if (checkoutPicker) checkoutPicker.changeMonth(1); };
        }
    } else {
        var calendarHost = document.querySelector('#must-booking-checkin-calendar');
        var monthSelect = document.querySelector('#must-booking-checkin-month'), yearSelect = document.querySelector('#must-booking-checkin-year');
        populateMonthYear(monthSelect, yearSelect);
        if (calendarHost) {
            var picker = window.flatpickr(calendarHost, {
                inline: true,
                mode: 'range',
                dateFormat: 'Y-m-d',
                minDate: todayStr,
                disable: roomAvailability ? [roomDateIsUnavailable] : [],
                defaultDate: (checkinField && checkinField.value && checkoutField && checkoutField.value) ? [checkinField.value, checkoutField.value] : undefined,
                onChange: function (selectedDates, dateStr, instance) {
                    if (selectedDates.length < 2) return;
                    var fmt = function (d) { return instance.formatDate(d, 'Y-m-d'); };
                    var start = fmt(selectedDates[0]), end = fmt(selectedDates[1]);
                    if (checkinField) checkinField.value = start;
                    if (checkoutField) checkoutField.value = end;
                    updateArrivalDeparture(start, end);
                },
                onMonthChange: function (a, b, instance) { syncMonthYear(monthSelect, yearSelect, instance); updatePrevVisibility(instance, singlePrev); refreshAvailability(instance); },
                onYearChange: function (a, b, instance) { syncMonthYear(monthSelect, yearSelect, instance); updatePrevVisibility(instance, singlePrev); refreshAvailability(instance); }
            });
            picker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(monthSelect, yearSelect, picker);
            wireMonthYear(monthSelect, yearSelect, picker);
            refreshAvailability(picker);
            var singlePrev = document.querySelector('#must-booking-cal-prev');
            var singleNext = document.querySelector('#must-booking-cal-next-inline') || document.querySelector('#must-booking-cal-next');
            updatePrevVisibility(picker, singlePrev);
            if (singlePrev) singlePrev.onclick = function () { picker.changeMonth(-1); };
            if (singleNext) singleNext.onclick = function () { picker.changeMonth(1); };
        }
    }
    }
    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);
}());
