(function () {
    'use strict';
    var c = window.mustHotelBookingCalendar || {};
    if (!window.flatpickr) {
        initializePartyComposer();
        return;
    }
    var checkinField = document.querySelector('#must-booking-checkin');
    var checkoutField = document.querySelector('#must-booking-checkout');
    var selectedRoomAvailabilityState = 'idle';
    function selectedRoomAvailabilityBlocksSubmit() {
        return selectedRoomAvailabilityState === 'checking' || selectedRoomAvailabilityState === 'unavailable';
    }
    function parsePartyValue(input, fallback, minimum) {
        var parsed = parseInt(String(input && input.value ? input.value : fallback), 10);
        if (!Number.isFinite(parsed) || parsed < minimum) {
            return fallback;
        }
        return parsed;
    }
    function getPartyCapacityMessage(guests, roomCount, maxGuests, singleRoomOnly) {
        var partyStrings = c.partyStrings || {};
        if (guests > maxGuests) {
            return String(partyStrings.propertyCapacity || 'This property accepts up to %d guests in one booking.')
                .replace('%d', String(maxGuests));
        }
        if (singleRoomOnly && roomCount > 1) {
            return String(partyStrings.singleRoomOnly || 'This booking flow can confirm one room at a time. Please choose 1 room.');
        }
        return '';
    }
    function syncPartyControls(adultsSelect, childrenSelect, adultsInput, childrenInput, guestsInput, totalOutput, capacityMessage, roomCountSelect, maxGuests, singleRoomOnly, submitButton) {
        var adults = parsePartyValue(adultsSelect, 1, 1);
        var children = parsePartyValue(childrenSelect, 0, 0);
        var guests = adults + children;
        var roomCount = parsePartyValue(roomCountSelect, 0, 0);
        var error = getPartyCapacityMessage(guests, roomCount, maxGuests, singleRoomOnly);

        if (adultsInput) adultsInput.value = String(adults);
        if (childrenInput) childrenInput.value = String(children);
        if (guestsInput) guestsInput.value = String(guests);
        if (totalOutput) {
            totalOutput.textContent = String(guests);
            totalOutput.setAttribute(
                'aria-label',
                String((c.partyStrings || {}).totalGuests || 'Total guests: %d').replace('%d', String(guests))
            );
        }
        [adultsSelect, childrenSelect, roomCountSelect].forEach(function (control) {
            if (!control) return;
            if (error) {
                control.setAttribute('aria-invalid', 'true');
            } else {
                control.removeAttribute('aria-invalid');
            }
        });
        if (capacityMessage) {
            capacityMessage.textContent = error;
            capacityMessage.hidden = error === '';
        }
        if (submitButton) {
            var blockedByRoomAvailability = selectedRoomAvailabilityBlocksSubmit();
            submitButton.disabled = error !== '' || blockedByRoomAvailability;
            submitButton.setAttribute('aria-disabled', error !== '' || blockedByRoomAvailability ? 'true' : 'false');
        }
        return { adults: adults, children: children, guests: guests, error: error };
    }
    function initializePartyComposer() {
        var form = document.querySelector('#must-booking-search-form');
        if (!form) return;
        var adultsSelect = document.querySelector('#must-booking-adults-select');
        var childrenSelect = document.querySelector('#must-booking-children-select');
        var adultsInput = document.querySelector('#must-booking-adults');
        var childrenInput = document.querySelector('#must-booking-children');
        var guestsInput = document.querySelector('#must-booking-guests');
        var totalOutput = document.querySelector('#must-booking-guests-total');
        var capacityMessage = document.querySelector('#must-booking-party-capacity-message');
        var roomCountSelect = document.querySelector('#must-booking-room-count-select');
        var accommodationTypeSelect = document.querySelector('#must-booking-accommodation-type');
        var submitButton = form.querySelector('.must-booking-check-availability');
        if (!adultsSelect || !childrenSelect) return;
        var maxGuests = parsePartyValue({ value: form.getAttribute('data-max-guests') }, 1, 1);
        var singleRoomOnly = form.getAttribute('data-single-room-only') === 'true';
        var sync = function () {
            return syncPartyControls(
                adultsSelect,
                childrenSelect,
                adultsInput,
                childrenInput,
                guestsInput,
                totalOutput,
                capacityMessage,
                roomCountSelect,
                maxGuests,
                singleRoomOnly,
                submitButton
            );
        };
        [adultsSelect, childrenSelect, roomCountSelect].forEach(function (control) {
            if (control) control.addEventListener('change', function () {
                sync();
                scheduleSelectedRoomAvailabilityCheck();
                refreshRoomTypeAvailability();
            });
        });
        if (accommodationTypeSelect) {
            accommodationTypeSelect.addEventListener('change', function () {
                refreshRoomTypeAvailability();
            });
        }
        form.addEventListener('submit', function (event) {
            if (sync().error !== '') event.preventDefault();
        });
        sync();
    }
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
            var startYear = todayYear;
            var endYear = parseInt(maxDateStr.slice(0, 4), 10);
            for (var y = startYear; y <= endYear; y++) {
                var yearOption = document.createElement('option');
                yearOption.value = String(y);
                yearOption.textContent = String(y);
                yearSelect.appendChild(yearOption);
            }
        }
    }
    /*
     * "Now" in the hotel's own timezone, not the visitor's browser clock: a
     * guest abroad must see the same "today" and same-day cutoff the hotel
     * applies. Falls back to the browser clock for an unusable timezone value
     * (e.g. a "UTC+2" offset string, which Intl does not accept).
     */
    function hotelNow() {
        var local = new Date();
        var fallback = { date: [local.getFullYear(), String(local.getMonth() + 1).padStart(2, '0'), String(local.getDate()).padStart(2, '0')].join('-'), minutes: local.getHours() * 60 + local.getMinutes() };
        if (!c.timezone || !window.Intl || !Intl.DateTimeFormat) return fallback;
        try {
            var parts = {};
            new Intl.DateTimeFormat('en-CA', { timeZone: c.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
                .formatToParts(local).forEach(function (part) { parts[part.type] = part.value; });
            return { date: parts.year + '-' + parts.month + '-' + parts.day, minutes: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10) };
        } catch (e) {
            return fallback;
        }
    }
    var hotelClock = hotelNow();
    var todayDate = new Date(parseInt(hotelClock.date.slice(0, 4), 10), parseInt(hotelClock.date.slice(5, 7), 10) - 1, parseInt(hotelClock.date.slice(8, 10), 10));
    var todayYear = todayDate.getFullYear(), todayMonth = todayDate.getMonth();
    function refreshMonthOptions(monthSelect, yearSelect) {
        if (!monthSelect || !yearSelect) return;
        var isCurrentYear = Number(yearSelect.value) === todayYear;
        var isLastYear = Number(yearSelect.value) === parseInt(maxDateStr.slice(0, 4), 10);
        var lastMonth = parseInt(maxDateStr.slice(5, 7), 10) - 1;
        Array.prototype.forEach.call(monthSelect.options, function (opt) {
            opt.disabled = (isCurrentYear && Number(opt.value) < todayMonth) || (isLastYear && Number(opt.value) > lastMonth);
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
            refreshAvailability(picker);
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
    // Local calendar date, not UTC: toISOString() shifts to UTC and is a day
    // behind local "today" for timezones ahead of UTC (e.g. the property's
    // own Europe/Tirane) during those hours, which would wrongly let guests
    // pick, or wrongly block, "today" as a stay date.
    var todayStr = hotelClock.date;
    var maximumNights = Math.max(1, parseInt(c.maximumNights, 10) || 30);
    var bookingWindowDays = Math.max(1, parseInt(c.bookingWindowDays, 10) || 365);
    var maxDateStr = addDaysToDateStr(todayStr, bookingWindowDays);
    // Same-day booking: blocked outright, or once the hotel's cutoff time has passed.
    var cutoffMatch = /^(\d{1,2}):(\d{2})/.exec(String(c.sameDayCutoff || ''));
    var sameDayClosed = c.sameDayAllowed === false || (!!cutoffMatch && hotelClock.minutes >= parseInt(cutoffMatch[1], 10) * 60 + parseInt(cutoffMatch[2], 10));
    var earliestStr = sameDayClosed ? addDaysToDateStr(todayStr, 1) : todayStr;
    var unavailableDates = {};
    // date -> the API's day record (status, closedToArrival, closedToDeparture, minStay).
    var dayInfo = {};
    var roomAvailability = c.roomAvailability || null;
    var roomTypeAvailability = c.roomTypeAvailability || null;
    /*
     * A fixed physical room (set once a specific room is already chosen)
     * always wins: it keeps checking that exact room's own availability.
     * Otherwise, once the guest has picked a room type from the initial
     * form's dropdown, the calendar checks that room type's live occupancy-
     * aware Clock availability instead, using the same AJAX credentials.
     */
    function resolveCalendarAvailabilitySource() {
        if (roomAvailability) return roomAvailability;
        if (!roomTypeAvailability) return null;
        var roomTypeSelect = document.querySelector('#must-booking-accommodation-type');
        var roomTypeId = roomTypeSelect && roomTypeSelect.value ? roomTypeSelect.value : '';
        if (!roomTypeId) return null;
        var adultsInput = document.querySelector('#must-booking-adults');
        var childrenInput = document.querySelector('#must-booking-children');
        var roomCountInput = document.querySelector('#must-booking-room-count-select');
        var roomCount = roomCountInput ? parseInt(roomCountInput.value, 10) : 0;
        return {
            ajaxUrl: roomTypeAvailability.ajaxUrl,
            nonce: roomTypeAvailability.nonce,
            roomTypeId: roomTypeId,
            adults: adultsInput && adultsInput.value ? adultsInput.value : '1',
            children: childrenInput && childrenInput.value ? childrenInput.value : '0',
            // "Auto" (0) and 1 both mean a single room; only 2+ changes the answer.
            rooms: roomCount > 1 ? String(roomCount) : ''
        };
    }
    var loadedMonths = {};
    // Per-month outcome of the availability request: 'ok' or 'failed'. A month
    // that is not 'ok' is treated as NOT bookable (fail closed) - never as open.
    var monthStatus = {};
    function monthIsVerified(dateStr) {
        return !resolveCalendarAvailabilitySource() || monthStatus[dateStr.slice(0, 7)] === 'ok';
    }
    // A specific reason from the server (e.g. the room type cannot be sold online) replaces the generic text.
    var calendarLoadMessage = '';
    function setCalendarLoadError(show) {
        var messagesNode = document.querySelector('#must-booking-live-messages');
        if (!messagesNode) return;
        var existing = messagesNode.querySelector('[data-must-calendar-load-error]');
        if (existing) existing.remove();
        if (show && c.availabilityLoadError) {
            var paragraph = document.createElement('p');
            paragraph.setAttribute('data-must-calendar-load-error', 'true');
            paragraph.textContent = calendarLoadMessage || c.availabilityLoadError;
            messagesNode.appendChild(paragraph);
        }
        messagesNode.hidden = messagesNode.children.length === 0;
    }
    var availabilityCheckTimer = null;
    var availabilityCheckSequence = 0;
    var selectedRoomAvailabilityInitialized = false;
    function setSelectedRoomAvailabilityState(state, message) {
        selectedRoomAvailabilityState = state;
        var messagesNode = document.querySelector('#must-booking-live-messages');
        if (messagesNode) {
            var previousMessage = messagesNode.querySelector('[data-must-clock-availability]');
            if (previousMessage) previousMessage.remove();
            if (message) {
                var paragraph = document.createElement('p');
                paragraph.setAttribute('data-must-clock-availability', 'true');
                paragraph.textContent = message;
                messagesNode.appendChild(paragraph);
            }
            messagesNode.hidden = messagesNode.children.length === 0;
        }
        var form = document.querySelector('#must-booking-search-form');
        var submitButton = form && form.querySelector('.must-booking-check-availability');
        if (submitButton) {
            var partyError = form.querySelector('[aria-invalid="true"]');
            submitButton.disabled = selectedRoomAvailabilityBlocksSubmit() || !!partyError;
            submitButton.setAttribute('aria-disabled', submitButton.disabled ? 'true' : 'false');
        }
    }
    function isCompleteSelectedRoomDateRange(checkin, checkout) {
        return /^\d{4}-\d{2}-\d{2}$/.test(checkin) &&
            /^\d{4}-\d{2}-\d{2}$/.test(checkout) && checkout > checkin;
    }
    function initializeSelectedRoomAvailability() {
        if (selectedRoomAvailabilityInitialized || !roomAvailability || !roomAvailability.availabilityAction) return;
        var form = document.querySelector('#must-booking-search-form');
        if (!form) return;
        selectedRoomAvailabilityInitialized = true;
        form.addEventListener('submit', function (event) {
            if (selectedRoomAvailabilityBlocksSubmit()) event.preventDefault();
        });
    }
    function scheduleSelectedRoomAvailabilityCheck() {
        if (!roomAvailability || !roomAvailability.availabilityAction) return;
        if (availabilityCheckTimer !== null) window.clearTimeout(availabilityCheckTimer);
        var sequence = ++availabilityCheckSequence;
        var checkin = checkinField && checkinField.value ? checkinField.value : '';
        var checkout = checkoutField && checkoutField.value ? checkoutField.value : '';
        if (!isCompleteSelectedRoomDateRange(checkin, checkout)) {
            setSelectedRoomAvailabilityState('idle', '');
            return;
        }
        setSelectedRoomAvailabilityState('checking', 'Checking selected room availability…');
        var requestBody = new URLSearchParams({
            action: roomAvailability.availabilityAction,
            nonce: roomAvailability.nonce,
            checkin: checkin,
            checkout: checkout,
            adults: document.querySelector('#must-booking-adults') ? document.querySelector('#must-booking-adults').value : '1',
            children: document.querySelector('#must-booking-children') ? document.querySelector('#must-booking-children').value : '0'
        });
        availabilityCheckTimer = window.setTimeout(function () {
            window.fetch(roomAvailability.ajaxUrl, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: requestBody.toString()
            }).then(function (response) {
                if (!response.ok) throw new Error('Unable to confirm room availability.');
                return response.json();
            }).then(function (response) {
                if (sequence !== availabilityCheckSequence) return;
                var data = response && response.success && response.data ? response.data : null;
                if (data && data.availability_status === 'ok' && data.is_available === false) {
                    setSelectedRoomAvailabilityState('unavailable', 'The selected room is no longer available for these dates. Please choose another.');
                    return;
                }
                setSelectedRoomAvailabilityState('available', data && data.availability_status === 'provider_unconfirmed'
                    ? 'Availability could not be confirmed. We’ll check again before payment.'
                    : '');
            }).catch(function () {
                if (sequence !== availabilityCheckSequence) return;
                setSelectedRoomAvailabilityState('available', 'Availability could not be confirmed. We’ll check again before payment.');
            });
        }, 500);
    }
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
        var source = resolveCalendarAvailabilitySource();
        if (!source) return Promise.resolve();
        var month = monthKey(date);
        var cacheKey = (source.roomTypeId ? source.roomTypeId + ':' + source.adults + ':' + source.children + ':' + (source.rooms || '1') : '') + ':' + month;
        if (loadedMonths[cacheKey]) return loadedMonths[cacheKey];
        var requestFields = { action: 'must_booking_room_calendar', nonce: source.nonce, month: month };
        if (source.roomTypeId) {
            requestFields.room_type_id = source.roomTypeId;
            requestFields.adults = source.adults;
            requestFields.children = source.children;
            if (source.rooms) requestFields.rooms = source.rooms;
        }
        var requestBody = new URLSearchParams(requestFields);
        loadedMonths[cacheKey] = window.fetch(source.ajaxUrl, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: requestBody.toString()
        }).then(function (response) {
            if (response.status === 409) {
                return response.json().then(function (body) {
                    calendarLoadMessage = (body && body.data && body.data.message) || '';
                    throw new Error('Room type is not bookable online.');
                });
            }
            if (!response.ok) throw new Error('Unable to load room availability.');
            return response.json();
        }).then(function (response) {
            if (!response || !response.success || !response.data || !Array.isArray(response.data.days)) throw new Error('Invalid availability response.');
            response.data.days.forEach(function (day) {
                if (day && day.date) dayInfo[day.date] = day;
                if (day && day.date && day.isAvailable === false) unavailableDates[day.date] = true;
            });
            monthStatus[month] = 'ok';
            calendarLoadMessage = '';
            var anyFailed = Object.keys(monthStatus).some(function (key) { return monthStatus[key] === 'failed'; });
            setCalendarLoadError(anyFailed);
        }).catch(function () {
            monthStatus[month] = 'failed';
            delete loadedMonths[cacheKey];
            setCalendarLoadError(true);
        });
        return loadedMonths[cacheKey];
    }
    function roomDateIsUnavailable(date) {
        return unavailableDates[dateKey(date)] === true || (monthStatus[monthKey(date)] === 'failed' && !!resolveCalendarAvailabilitySource());
    }
    // Unavailable, or in a month whose availability is not confirmed yet.
    function roomDateIsBlocked(date) {
        return roomDateIsUnavailable(date) || !monthIsVerified(dateKey(date));
    }
    var minimumNights = Math.max(1, parseInt(c.minimumNights, 10) || 1);
    // The minimum stay for a given arrival date: the property-wide minimum, raised
    // by any stricter per-date minimum stay Clock reports for that arrival.
    function minNightsFor(checkinStr) {
        var info = dayInfo[checkinStr];
        return Math.max(minimumNights, info && info.minStay ? info.minStay : 0);
    }
    function dateIsClosedToDeparture(dateStr) {
        return !!(dayInfo[dateStr] && dayInfo[dateStr].closedToDeparture === true);
    }
    function addDaysToDateStr(dateStr, days) {
        var date = new Date(dateStr + 'T00:00:00');
        date.setDate(date.getDate() + days);
        return dateKey(date);
    }
    /*
     * The furthest checkout reachable from `checkinStr` without ever sleeping
     * an unavailable night: walks forward night by night from check-in,
     * stopping at (and returning) the night before the first unavailable
     * date, or at `horizonStr` if every night up to it is free. A checkout on
     * the unavailable date itself is still valid — the guest never occupies
     * that night, only arrives to leave. Returns null when not even the
     * minimum-night stay fits before hitting a gap.
     */
    function latestValidCheckoutDate(checkinStr, nightsMinimum, horizonStr) {
        var minimum = Math.max(1, nightsMinimum || 1);
        var stayLimit = addDaysToDateStr(checkinStr, maximumNights);
        var horizon = horizonStr || (stayLimit < maxDateStr ? stayLimit : maxDateStr);
        var cursor = checkinStr;
        var nightsCounted = 0;
        while (cursor < horizon) {
            // A month not verified yet ends the reachable stay here: the nights
            // before this date are confirmed free, nothing beyond is assumed.
            if (unavailableDates[cursor] === true || !monthIsVerified(cursor)) {
                return nightsCounted >= minimum ? cursor : null;
            }
            cursor = addDaysToDateStr(cursor, 1);
            nightsCounted++;
        }
        return nightsCounted >= minimum ? horizon : null;
    }
    /*
     * Whether picking `checkinStr` as check-in can ever satisfy the minimum
     * stay — i.e. whether `nightsMinimum` consecutive available nights follow
     * it. A check-in date that can never reach the minimum must be disabled
     * outright, not merely left to fail after the guest already picked it.
     */
    function checkinCanStartValidStay(checkinStr, nightsMinimum) {
        var minimum = Math.max(1, nightsMinimum || 1);
        var cursor = checkinStr;
        for (var i = 0; i < minimum; i++) {
            if (unavailableDates[cursor] === true || !monthIsVerified(cursor)) return false;
            cursor = addDaysToDateStr(cursor, 1);
        }
        return true;
    }
    function checkinDateBlockedByMinimumStay(date) {
        // While a check-in is pending the same date list also decides check-outs,
        // and arrival rules do not apply to those.
        if (pendingRangeCheckin) return false;
        var key = dateKey(date);
        if (dayInfo[key] && dayInfo[key].closedToArrival === true) return true;
        return !checkinCanStartValidStay(key, minNightsFor(key));
    }
    /*
     * The single-calendar range picker's own currently-picked checkin, while
     * the guest is choosing checkout — tracked here instead of via flatpickr's
     * minDate/maxDate. Moving minDate/maxDate past the just-picked checkin
     * would work for constraining the calendar's *display*, but flatpickr's
     * own minDate/maxDate setters immediately drop any already-selected date
     * that no longer satisfies the new bounds (confirmed against flatpickr's
     * source: the option setter re-filters selectedDates through the same
     * validity check disable/minDate/maxDate use) - so checkin itself would
     * be silently unselected the moment its own minimum-stay window was
     * applied, and the range could never complete. Tracking it separately and
     * enforcing the constraint only through `disable` avoids that entirely.
     */
    var pendingRangeCheckin = '';
    function rangeDateIsDisabled(date) {
        if (!pendingRangeCheckin) return false;
        var current = dateKey(date);
        var stayMinimum = minNightsFor(pendingRangeCheckin);
        var earliestCheckout = addDaysToDateStr(pendingRangeCheckin, stayMinimum);
        if (current < earliestCheckout) return true;
        var latestCheckout = latestValidCheckoutDate(pendingRangeCheckin, stayMinimum);
        if (!latestCheckout) return true;
        if (current > latestCheckout) return true;
        return dateIsClosedToDeparture(current);
    }
    /*
     * One rule for the single-calendar range picker. Choosing the check-in: the
     * date must itself be open and able to start a valid stay. Choosing the
     * check-out: only the stay window matters, which deliberately includes the
     * first unavailable date after the last free night - a guest may leave on a
     * day that is closed or sold out, since they never sleep that night.
     */
    function rangeModeDateIsDisabled(date) {
        if (pendingRangeCheckin) return rangeDateIsDisabled(date);
        return roomDateIsBlocked(date) || checkinDateBlockedByMinimumStay(date);
    }
    // Two-calendar layout: the check-out calendar, same "leave on the closed day" rule.
    function checkoutCalendarDateIsDisabled(date) {
        var key = dateKey(date);
        var checkin = checkinField ? checkinField.value : '';
        if (roomDateIsBlocked(date)) {
            if (!checkin || unavailableDates[key] !== true) return true;
            return latestValidCheckoutDate(checkin, minNightsFor(checkin)) !== key;
        }
        return dateIsClosedToDeparture(key);
    }
    /*
     * flatpickr's own 'flatpickr-disabled' class fires for several reasons
     * that must not all look the same to the guest: a genuinely unavailable
     * night, an adjacent-month padding day, a date unreachable only because
     * an unavailable night sits between it and the current selection, AND
     * a date that fails the pending-checkin checkout window above. A past
     * date is always really unavailable to the guest (it can never be
     * booked, independent of any Clock/local data) and gets the same
     * treatment as genuinely unavailable data. Everything else renders as an
     * ordinary, if currently unselectable, day.
     */
    function markReallyUnavailableDay(dayElement) {
        if (!dayElement) return;
        var isPadding = dayElement.classList.contains('prevMonthDay') || dayElement.classList.contains('nextMonthDay');
        var isPast = dayElement.dateObj && dateKey(dayElement.dateObj) < earliestStr;
        // Past dates stay plainly faded; only genuinely sold-out dates get the slash.
        // A day the guest can still pick as check-out (the day a closed stretch starts)
        // is not shown as blocked.
        var isSelectable = !dayElement.classList.contains('flatpickr-disabled');
        var isReallyUnavailable = !isPadding && !isSelectable && dayElement.dateObj && !isPast && roomDateIsUnavailable(dayElement.dateObj);
        var info = dayElement.dateObj ? dayInfo[dateKey(dayElement.dateObj)] : null;
        var isClosed = !!isReallyUnavailable && !!info && info.status === 'closed';
        dayElement.classList.toggle('must-booking-day-unavailable', !!isReallyUnavailable && !isClosed);
        dayElement.classList.toggle('must-booking-day-closed', isClosed);
    }
    function refreshAvailability(picker) {
        if (!picker || !resolveCalendarAvailabilitySource()) return;
        // The viewed month plus the next one: a stay that starts late in a
        // month has to be checked against the following month's nights too.
        Promise.all([
            loadAvailabilityMonth(new Date(picker.currentYear, picker.currentMonth, 1)),
            loadAvailabilityMonth(new Date(picker.currentYear, picker.currentMonth + 1, 1))
        ]).then(function () { picker.redraw(); });
    }
    // Loads every month a stay starting at `checkinStr` could reach.
    function ensureStayMonthsLoaded(checkinStr) {
        var source = resolveCalendarAvailabilitySource();
        if (!source) return Promise.resolve();
        var lastStr = addDaysToDateStr(checkinStr, maximumNights);
        if (lastStr > maxDateStr) lastStr = maxDateStr;
        var cursor = new Date(parseInt(checkinStr.slice(0, 4), 10), parseInt(checkinStr.slice(5, 7), 10) - 1, 1);
        var loads = [];
        while (dateKey(cursor).slice(0, 7) <= lastStr.slice(0, 7)) {
            loads.push(loadAvailabilityMonth(cursor));
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        }
        return Promise.all(loads);
    }
    function canShowMonthAfter(picker) {
        var next = new Date(picker.currentYear, picker.currentMonth + 1, 1);
        return dateKey(next) <= maxDateStr;
    }
    /*
     * Marks the picked checkin/checkout days so their CSS (already defined
     * for 'flatpickr-disabled.must-booking-day-start'/'-end') gives them a
     * distinct selected look instead of the plain disabled look they also
     * carry once picked (checkin becomes unselectable once chosen; checkout
     * likewise once the range completes). Mirrors booking-page.js's
     * updateRangeHighlights for the accommodation-page calendar.
     */
    function updateCalendarSelectionMarkers(picker, checkinStr, checkoutStr) {
        if (!picker || !picker.calendarContainer) return;
        var days = picker.calendarContainer.querySelectorAll('.flatpickr-day');
        Array.prototype.forEach.call(days, function (dayElement) {
            dayElement.classList.toggle('must-booking-day-start', false);
            dayElement.classList.toggle('must-booking-day-end', false);
            dayElement.classList.toggle('must-booking-day-in-range', false);
            if (!dayElement.dateObj) return;
            var current = dateKey(dayElement.dateObj);
            if (checkinStr && current === checkinStr) dayElement.classList.toggle('must-booking-day-start', true);
            if (checkoutStr && current === checkoutStr) dayElement.classList.toggle('must-booking-day-end', true);
            if (checkinStr && checkoutStr && current > checkinStr && current < checkoutStr)
                dayElement.classList.toggle('must-booking-day-in-range', true);
        });
    }
    var activePickers = [];
    /*
     * Changing the accommodation type, adults, or children while no fixed
     * physical room is set means the guest is now asking a different
     * occupancy-aware Clock question — previously loaded months belong to
     * the old answer and must not linger as stale greyed-out dates.
     */
    function refreshRoomTypeAvailability() {
        if (roomAvailability) return;
        unavailableDates = {};
        dayInfo = {};
        loadedMonths = {};
        monthStatus = {};
        calendarLoadMessage = '';
        setCalendarLoadError(false);
        activePickers.forEach(function (picker) { refreshAvailability(picker); });
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
                inline: true, dateFormat: 'Y-m-d', minDate: earliestStr, maxDate: maxDateStr,
                disable: [checkoutCalendarDateIsDisabled],
                defaultDate: checkoutField && checkoutField.value ? checkoutField.value : undefined,
                onChange: function (selectedDates, dateStr, instance) { if (checkoutField) checkoutField.value = dateStr; updateArrivalDeparture(checkinField ? checkinField.value : '', dateStr); updateCalendarSelectionMarkers(instance, '', dateStr); scheduleSelectedRoomAvailabilityCheck(); },
                onMonthChange: function (a, b, instance) { syncMonthYear(checkoutMonth, checkoutYear, instance); refreshAvailability(instance); updateCalendarSelectionMarkers(instance, '', checkoutField ? checkoutField.value : ''); },
                onYearChange: function (a, b, instance) { syncMonthYear(checkoutMonth, checkoutYear, instance); refreshAvailability(instance); updateCalendarSelectionMarkers(instance, '', checkoutField ? checkoutField.value : ''); },
                onDayCreate: function (selectedDates, dateStr, instance, dayElement) { markReallyUnavailableDay(dayElement); }
            });
            checkoutPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(checkoutMonth, checkoutYear, checkoutPicker);
            wireMonthYear(checkoutMonth, checkoutYear, checkoutPicker);
            activePickers.push(checkoutPicker);
            refreshAvailability(checkoutPicker);
        }
        if (checkinHost) {
            var checkinPicker = window.flatpickr(checkinHost, {
                inline: true, dateFormat: 'Y-m-d', minDate: earliestStr, maxDate: maxDateStr,
                disable: [roomDateIsBlocked, checkinDateBlockedByMinimumStay],
                defaultDate: checkinField && checkinField.value ? checkinField.value : undefined,
                onChange: function (selectedDates, dateStr, instance) {
                    if (checkinField) checkinField.value = dateStr;
                    updateArrivalDeparture(dateStr, checkoutField ? checkoutField.value : '');
                    updateCalendarSelectionMarkers(instance, dateStr, '');
                    if (checkoutPicker && !selectedDates[0]) {
                        // Check-in cleared: the check-out calendar is no longer bounded by it.
                        checkoutPicker.set('minDate', earliestStr);
                        checkoutPicker.set('maxDate', maxDateStr);
                    }
                    if (checkoutPicker && selectedDates[0]) {
                        checkoutPicker.set('minDate', addDaysToDateStr(dateStr, minNightsFor(dateStr)));
                        var latestCheckout = latestValidCheckoutDate(dateStr, minNightsFor(dateStr));
                        checkoutPicker.set('maxDate', latestCheckout || maxDateStr);
                        ensureStayMonthsLoaded(dateStr).then(function () {
                            var verifiedLatest = latestValidCheckoutDate(dateStr, minNightsFor(dateStr));
                            checkoutPicker.set('maxDate', verifiedLatest || maxDateStr);
                            checkoutPicker.redraw();
                        });
                        // A previously chosen check-out that no longer fits the new check-in is dropped.
                        var keptCheckout = checkoutField ? checkoutField.value : '';
                        var latestAllowed = latestCheckout || maxDateStr;
                        if (keptCheckout && (keptCheckout < addDaysToDateStr(dateStr, minNightsFor(dateStr)) || keptCheckout > latestAllowed)) {
                            checkoutPicker.clear(false);
                            if (checkoutField) checkoutField.value = '';
                            updateArrivalDeparture(dateStr, '');
                        }
                    }
                    scheduleSelectedRoomAvailabilityCheck();
                },
                onMonthChange: function (a, b, instance) { syncMonthYear(checkinMonth, checkinYear, instance); updatePrevVisibility(instance, prevButton); refreshAvailability(instance); updateCalendarSelectionMarkers(instance, checkinField ? checkinField.value : '', ''); },
                onYearChange: function (a, b, instance) { syncMonthYear(checkinMonth, checkinYear, instance); updatePrevVisibility(instance, prevButton); refreshAvailability(instance); updateCalendarSelectionMarkers(instance, checkinField ? checkinField.value : '', ''); },
                onDayCreate: function (selectedDates, dateStr, instance, dayElement) { markReallyUnavailableDay(dayElement); }
            });
            checkinPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            // Clicking the selected check-in again only unselects it (same as the one-calendar layout).
            checkinPicker.calendarContainer.addEventListener('click', function (event) {
                var dayTarget = event.target && event.target.closest ? event.target.closest('.flatpickr-day') : null;
                if (!dayTarget || !dayTarget.dateObj || !checkinField || !checkinField.value || dateKey(dayTarget.dateObj) !== checkinField.value) return;
                event.stopPropagation();
                event.preventDefault();
                var viewedYear = checkinPicker.currentYear, viewedMonth = checkinPicker.currentMonth;
                checkinPicker.clear();
                if (checkinPicker.currentYear !== viewedYear || checkinPicker.currentMonth !== viewedMonth) checkinPicker.jumpToDate(new Date(viewedYear, viewedMonth, 1), true);
                updateCalendarSelectionMarkers(checkinPicker, '', '');
            }, true);
            syncMonthYear(checkinMonth, checkinYear, checkinPicker);
            wireMonthYear(checkinMonth, checkinYear, checkinPicker);
            activePickers.push(checkinPicker);
            refreshAvailability(checkinPicker);
            var prevButton = document.querySelector('#must-booking-cal-prev');
            var nextInlineButton = document.querySelector('#must-booking-cal-next-inline');
            var nextButton = document.querySelector('#must-booking-cal-next');
            updatePrevVisibility(checkinPicker, prevButton);
            if (prevButton) prevButton.onclick = function () { checkinPicker.changeMonth(-1); };
            if (nextInlineButton) nextInlineButton.onclick = function () { if (canShowMonthAfter(checkinPicker)) checkinPicker.changeMonth(1); };
            if (nextButton) nextButton.onclick = function () { if (checkoutPicker && canShowMonthAfter(checkoutPicker)) checkoutPicker.changeMonth(1); };
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
                minDate: earliestStr, maxDate: maxDateStr,
                disable: [rangeModeDateIsDisabled],
                defaultDate: (checkinField && checkinField.value && checkoutField && checkoutField.value) ? [checkinField.value, checkoutField.value] : undefined,
                onChange: function (selectedDates, dateStr, instance) {
                    if (selectedDates.length < 2) {
                        // Exactly one date picked so far (check-in): constrain
                        // the *next* click to a real stay — at least the
                        // minimum nights, and never past the first gap in
                        // availability, so the guest cannot complete a
                        // same-day or unavailable-night selection at all.
                        // Tracked separately from flatpickr's own minDate/
                        // maxDate (see pendingRangeCheckin) rather than moved
                        // there, since flatpickr drops the just-picked checkin
                        // itself the instant minDate/maxDate excludes it.
                        pendingRangeCheckin = selectedDates.length === 1 ? instance.formatDate(selectedDates[0], 'Y-m-d') : '';
                        instance.redraw();
                        // redraw() rebuilds the day cells, so mark the pending check-in afterwards.
                        updateCalendarSelectionMarkers(instance, pendingRangeCheckin, '');
                        if (pendingRangeCheckin) {
                            var pendingAtPick = pendingRangeCheckin;
                            ensureStayMonthsLoaded(pendingAtPick).then(function () {
                                if (pendingRangeCheckin !== pendingAtPick) return;
                                instance.redraw();
                                updateCalendarSelectionMarkers(instance, pendingRangeCheckin, '');
                            });
                        }
                        scheduleSelectedRoomAvailabilityCheck();
                        return;
                    }
                    var fmt = function (d) { return instance.formatDate(d, 'Y-m-d'); };
                    var start = fmt(selectedDates[0]), end = fmt(selectedDates[1]);
                    if (checkinField) checkinField.value = start;
                    if (checkoutField) checkoutField.value = end;
                    updateArrivalDeparture(start, end);
                    // Range complete — clear the pending-checkin constraint so
                    // a fresh check-in click (starting a new range) is not
                    // still bounded by the just-completed stay's window.
                    pendingRangeCheckin = '';
                    instance.redraw();
                    updateCalendarSelectionMarkers(instance, start, end);
                    scheduleSelectedRoomAvailabilityCheck();
                },
                onMonthChange: function (a, b, instance) { syncMonthYear(monthSelect, yearSelect, instance); updatePrevVisibility(instance, singlePrev); refreshAvailability(instance); updateCalendarSelectionMarkers(instance, checkinField ? checkinField.value : '', checkoutField ? checkoutField.value : ''); },
                onYearChange: function (a, b, instance) { syncMonthYear(monthSelect, yearSelect, instance); updatePrevVisibility(instance, singlePrev); refreshAvailability(instance); updateCalendarSelectionMarkers(instance, checkinField ? checkinField.value : '', checkoutField ? checkoutField.value : ''); },
                onDayCreate: function (selectedDates, dateStr, instance, dayElement) { markReallyUnavailableDay(dayElement); }
            });
            /*
             * Clicking the just-picked check-in again (before a check-out is
             * chosen) only unselects it. Flatpickr ignores clicks on the
             * pending check-in because the range rules disable it, so this
             * listens in the capture phase and clears the selection itself.
             */
            picker.calendarContainer.addEventListener('click', function (event) {
                var dayTarget = event.target && event.target.closest ? event.target.closest('.flatpickr-day') : null;
                if (!dayTarget || !dayTarget.dateObj || !pendingRangeCheckin || picker.selectedDates.length !== 1) return;
                if (dateKey(dayTarget.dateObj) !== pendingRangeCheckin) return;
                event.stopPropagation();
                event.preventDefault();
                // clear() jumps the view back to the current month; keep the guest where they are.
                var viewedYear = picker.currentYear, viewedMonth = picker.currentMonth;
                picker.clear();
                if (picker.currentYear !== viewedYear || picker.currentMonth !== viewedMonth) picker.jumpToDate(new Date(viewedYear, viewedMonth, 1), true);
            }, true);
            picker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            syncMonthYear(monthSelect, yearSelect, picker);
            wireMonthYear(monthSelect, yearSelect, picker);
            activePickers.push(picker);
            refreshAvailability(picker);
            var singlePrev = document.querySelector('#must-booking-cal-prev');
            var singleNext = document.querySelector('#must-booking-cal-next-inline') || document.querySelector('#must-booking-cal-next');
            updatePrevVisibility(picker, singlePrev);
            if (singlePrev) singlePrev.onclick = function () { picker.changeMonth(-1); };
            if (singleNext) singleNext.onclick = function () { if (canShowMonthAfter(picker)) picker.changeMonth(1); };
        }
    }
    initializeSelectedRoomAvailability();
    scheduleSelectedRoomAvailabilityCheck();
    }
    initializePartyComposer();
    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);
}());
