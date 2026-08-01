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
                defaultDate: checkoutField && checkoutField.value ? checkoutField.value : undefined,
                onChange: function (selectedDates, dateStr) { if (checkoutField) checkoutField.value = dateStr; updateArrivalDeparture(checkinField ? checkinField.value : '', dateStr); },
                onMonthChange: function (a, b, instance) { syncMonthYear(checkoutMonth, checkoutYear, instance); },
                onYearChange: function (a, b, instance) { syncMonthYear(checkoutMonth, checkoutYear, instance); }
            });
            checkoutPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(checkoutMonth, checkoutYear, checkoutPicker);
            wireMonthYear(checkoutMonth, checkoutYear, checkoutPicker);
        }
        if (checkinHost) {
            var checkinPicker = window.flatpickr(checkinHost, {
                inline: true, dateFormat: 'Y-m-d', minDate: todayStr,
                defaultDate: checkinField && checkinField.value ? checkinField.value : undefined,
                onChange: function (selectedDates, dateStr) {
                    if (checkinField) checkinField.value = dateStr;
                    updateArrivalDeparture(dateStr, checkoutField ? checkoutField.value : '');
                    if (checkoutPicker && selectedDates[0]) {
                        var minCheckout = new Date(selectedDates[0].getTime() + 86400000);
                        checkoutPicker.set('minDate', minCheckout);
                    }
                },
                onMonthChange: function (a, b, instance) { syncMonthYear(checkinMonth, checkinYear, instance); updatePrevVisibility(instance, prevButton); },
                onYearChange: function (a, b, instance) { syncMonthYear(checkinMonth, checkinYear, instance); updatePrevVisibility(instance, prevButton); }
            });
            checkinPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(checkinMonth, checkinYear, checkinPicker);
            wireMonthYear(checkinMonth, checkinYear, checkinPicker);
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
                defaultDate: (checkinField && checkinField.value && checkoutField && checkoutField.value) ? [checkinField.value, checkoutField.value] : undefined,
                onChange: function (selectedDates, dateStr, instance) {
                    if (selectedDates.length < 2) return;
                    var fmt = function (d) { return instance.formatDate(d, 'Y-m-d'); };
                    var start = fmt(selectedDates[0]), end = fmt(selectedDates[1]);
                    if (checkinField) checkinField.value = start;
                    if (checkoutField) checkoutField.value = end;
                    updateArrivalDeparture(start, end);
                },
                onMonthChange: function (a, b, instance) { syncMonthYear(monthSelect, yearSelect, instance); updatePrevVisibility(instance, singlePrev); },
                onYearChange: function (a, b, instance) { syncMonthYear(monthSelect, yearSelect, instance); updatePrevVisibility(instance, singlePrev); }
            });
            picker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(monthSelect, yearSelect, picker);
            wireMonthYear(monthSelect, yearSelect, picker);
            var singlePrev = document.querySelector('#must-booking-cal-prev');
            var singleNext = document.querySelector('#must-booking-cal-next-inline') || document.querySelector('#must-booking-cal-next');
            updatePrevVisibility(picker, singlePrev);
            if (singlePrev) singlePrev.onclick = function () { picker.changeMonth(-1); };
            if (singleNext) singleNext.onclick = function () { picker.changeMonth(1); };
        }
    }
}());
