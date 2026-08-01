(function () {
    'use strict';
    var config = window.mustHotelBookingBookingPage || null;
    if (!config) {
        return;
    }
    var state = {
        availabilityRequestToken: 0,
        disabledDatesRequestToken: 0,
        refreshTimer: null,
        checkinPicker: null,
        checkoutPicker: null,
        currentStep: 1,
        previewCheckout: '',
        lastAvailabilityMessage: '',
        lastAvailabilityStatus: '',
        disabledCheckinDates: [],
        disabledCheckoutDates: []
    };
    var monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
    ];
    function isValidDateString(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    }
    function formatDate(date) {
        var year = String(date.getFullYear());
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
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
    function parseDateString(value) {
        if (!isValidDateString(value)) {
            return null;
        }
        var date = new Date(value + 'T00:00:00');
        if (Number.isNaN(date.getTime())) {
            return null;
        }
        return date;
    }
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    function formatTemplate(template, value) {
        var output = String(template || '');
        if (output.indexOf('%d') !== -1) {
            return output.replace('%d', String(value));
        }
        if (output.indexOf('%s') !== -1) {
            return output.replace('%s', String(value));
        }
        return output + ' ' + String(value);
    }
    function formatTwoValueTemplate(template, firstValue, secondValue) {
        var output = String(template || '');
        if (output.indexOf('%1$s') !== -1 || output.indexOf('%2$d') !== -1 || output.indexOf('%2$s') !== -1) {
            return output
                .replace('%1$s', String(firstValue))
                .replace('%2$d', String(secondValue))
                .replace('%2$s', String(secondValue));
        }
        return String(firstValue) + ' / ' + String(secondValue);
    }
    function formatThreeValueTemplate(template, firstValue, secondValue, thirdValue) {
        var output = String(template || '');
        if (
            output.indexOf('%1$s') !== -1 ||
            output.indexOf('%2$d') !== -1 ||
            output.indexOf('%2$s') !== -1 ||
            output.indexOf('%3$s') !== -1
        ) {
            return output
                .replace('%1$s', String(firstValue))
                .replace('%2$d', String(secondValue))
                .replace('%2$s', String(secondValue))
                .replace('%3$s', String(thirdValue));
        }
        return String(firstValue) + ' / ' + String(secondValue) + ' / ' + String(thirdValue);
    }
    function formatPrice(value) {
        var amount = Number(value);
        var symbol = String(config.currencySymbol || '').trim();
        if (!Number.isFinite(amount)) {
            amount = 0;
        }
        var formattedAmount = amount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return symbol !== '' ? formattedAmount + ' ' + symbol : formattedAmount;
    }
    function getMonthFloorDate() {
        var today = new Date();
        return new Date(today.getFullYear(), today.getMonth(), 1);
    }
    function populateSelectOptions(selectEl, options, selectedValue) {
        if (!selectEl) {
            return;
        }
        var normalizedSelected = String(selectedValue);
        var html = options.map(function (item) {
            var selected = String(item.value) === normalizedSelected ? ' selected' : '';
            var disabled = item && item.disabled ? ' disabled' : '';
            return '<option value="' + escapeHtml(item.value) + '"' + selected + disabled + '>' + escapeHtml(item.label) + '</option>';
        }).join('');
        if (selectEl.innerHTML !== html) {
            selectEl.innerHTML = html;
        }
        selectEl.value = normalizedSelected;
    }
    function getYearOptions(currentYear, floorYear) {
        var minYear = Number(floorYear);
        var startYear = minYear - 1;
        var maxYear = floorYear + 10;
        var selectedYear = Number(currentYear);
        var options = [];
        if (Number.isFinite(selectedYear) && selectedYear > maxYear) {
            maxYear = selectedYear;
        }
        if (startYear < 1970) {
            startYear = 1970;
        }
        for (var year = startYear; year <= maxYear; year++) {
            options.push({
                value: String(year),
                label: String(year),
                disabled: year < minYear
            });
        }
        return options;
    }
    function getHomeUrl() {
        var homeUrl = String(config.homeUrl || '').trim();
        if (homeUrl !== '') {
            return homeUrl;
        }
        return '/';
    }
    function isCalendarPageMode() {
        return String(config.pageMode || 'calendar') === 'calendar';
    }
    function getFixedRoomId() {
        var parsed = parseInt(String(config.fixedRoomId || '0'), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return 0;
        }
        return parsed;
    }
    function getFixedAvailabilityRoomId() {
        var hiddenInventoryInput = document.querySelector('input[name="inventory_room_id"], input[name="physical_room_id"]');
        var hiddenParsed = hiddenInventoryInput ? parseInt(String(hiddenInventoryInput.value || '0'), 10) : 0;
        if (Number.isFinite(hiddenParsed) && hiddenParsed > 0) {
            return hiddenParsed;
        }
        var fixedRoom = config.fixedRoom && typeof config.fixedRoom === 'object' ? config.fixedRoom : {};
        var parsed = parseInt(String(fixedRoom.physical_room_id || fixedRoom.inventory_room_id || config.fixedInventoryRoomId || '0'), 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
        return getFixedRoomId();
    }
    function isFixedRoomMode() {
        return Boolean(config.fixedRoomMode) && getFixedRoomId() > 0;
    }
    function buildContextUrl(baseUrl, context) {
        var resolvedBaseUrl = String(baseUrl || window.location.href || '');
        var url;
        try {
            url = new URL(resolvedBaseUrl, window.location.href);
        } catch (error) {
            url = new URL(window.location.href);
        }
        url.searchParams.set('checkin', String(context.checkin || ''));
        url.searchParams.set('checkout', String(context.checkout || ''));
        url.searchParams.set('guests', String(context.guests || 1));
        url.searchParams.set('room_count', String(context.roomCount || 0));
        url.searchParams.set('accommodation_type', String(context.accommodationType || getAccommodationTypeValue()));
        if (Number(context.roomId || 0) > 0) {
            url.searchParams.set('room_id', String(context.roomId));
        } else {
            url.searchParams.delete('room_id');
        }
        if (Number(context.availabilityRoomId || 0) > 0 && Number(context.availabilityRoomId || 0) !== Number(context.roomId || 0)) {
            url.searchParams.set('inventory_room_id', String(context.availabilityRoomId));
        } else {
            url.searchParams.delete('inventory_room_id');
        }
        return url.toString();
    }
    function getStepHeadingText(step) {
        var strings = config.strings || {};
        if (isFixedRoomMode()) {
            return String(strings.selectDatesHeadingFixedRoom || strings.selectDatesHeading || 'Select your dates');
        }
        if (Number(step) > 1) {
            return String(strings.availableAccommodationHeading || 'Available Accommodation');
        }
        return String(strings.selectDatesHeading || 'Select your dates');
    }
    function setCurrentStep(step, resultsEl) {
        var nextStep = parseInt(String(step || '1'), 10);
        var formEl = document.getElementById('must-booking-search-form');
        var headingEl = document.getElementById('must-booking-step-heading');
        var pageEl = document.querySelector('.must-hotel-booking-page-booking');
        if (!Number.isFinite(nextStep) || nextStep < 1) {
            nextStep = 1;
        }
        if (nextStep > 4) {
            nextStep = 4;
        }
        state.currentStep = nextStep;
        if (pageEl) {
            pageEl.classList.toggle('is-step-1', nextStep === 1);
            pageEl.classList.toggle('is-step-2', nextStep === 2);
        }
        if (headingEl) {
            headingEl.textContent = getStepHeadingText(nextStep);
        }
        if (formEl) {
            formEl.style.display = nextStep === 1 ? '' : 'none';
        }
        var stepElements = document.querySelectorAll('.must-booking-stepper-step[data-step]');
        stepElements.forEach(function (stepElement) {
            var stepValue = parseInt(String(stepElement.getAttribute('data-step') || ''), 10);
            stepElement.classList.toggle('is-active', stepValue === nextStep);
        });
        if (resultsEl) {
            resultsEl.style.display = nextStep > 1 ? '' : 'none';
        }
    }
    function redirectToAccommodation(context) {
        window.location.href = buildContextUrl(
            String(config.accommodationUrl || config.bookingUrl || window.location.href),
            context
        );
    }
    function redirectToCheckout(context) {
        window.location.href = buildContextUrl(
            String(config.checkoutUrl || config.bookingUrl || window.location.href),
            context
        );
    }
    function getAccommodationTypeLabel(accommodationTypeSelect) {
        var selectEl = accommodationTypeSelect || document.getElementById('must-booking-accommodation-type');
        if (!selectEl) {
            if (isFixedRoomMode() && config.fixedRoom && typeof config.fixedRoom === 'object') {
                if (String(config.fixedRoom.name || '') !== '') {
                    return String(config.fixedRoom.name);
                }
                if (String(config.fixedRoom.categoryLabel || '') !== '') {
                    return String(config.fixedRoom.categoryLabel);
                }
            }
            return 'Standard Rooms';
        }
        var selectedIndex = typeof selectEl.selectedIndex === 'number' ? selectEl.selectedIndex : -1;
        if (selectedIndex >= 0 && selectEl.options && selectEl.options[selectedIndex]) {
            return String(selectEl.options[selectedIndex].text || 'Standard Rooms');
        }
        return String(selectEl.value || 'Standard Rooms');
    }
    function getAccommodationTypeValue(accommodationTypeSelect) {
        var fallback = String(
            (config.initial && config.initial.accommodationType) ||
            config.defaultAccommodationType ||
            'standard-rooms'
        );
        var selectEl = accommodationTypeSelect || document.getElementById('must-booking-accommodation-type');
        if (!selectEl) {
            return fallback;
        }
        return String(selectEl.value || fallback);
    }
    function getMaxRoomsLimit() {
        var parsed = parseInt(String(config.maxRooms || '3'), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return 3;
        }
        return parsed;
    }
    function getRoomCapacityForAccommodationType(accommodationType) {
        if (isFixedRoomMode()) {
            var fixedCapacity = config.fixedRoom && typeof config.fixedRoom === 'object'
                ? parseInt(String(config.fixedRoom.maxGuests || config.fixedRoom.max_guests || '1'), 10)
                : 1;
            return Number.isFinite(fixedCapacity) && fixedCapacity > 0 ? fixedCapacity : 1;
        }
        var capacities = config.categoryCapacities && typeof config.categoryCapacities === 'object'
            ? config.categoryCapacities
            : {};
        var normalizedType = String(accommodationType || getAccommodationTypeValue()).trim();
        var parsed = parseInt(String(capacities[normalizedType] || config.maxGuests || '4'), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return 4;
        }
        return parsed;
    }
    function getRoomCountValue(roomCountSelect) {
        if (isFixedRoomMode()) {
            return 1;
        }
        var fallback = parseInt(String((config.initial && config.initial.roomCount) || '0'), 10);
        var selectEl = roomCountSelect || document.getElementById('must-booking-room-count-select');
        if (!Number.isFinite(fallback) || fallback < 0) {
            fallback = 0;
        }
        if (!selectEl) {
            return fallback;
        }
        var parsed = parseInt(String(selectEl.value || fallback), 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }
        return Math.min(getMaxRoomsLimit(), parsed);
    }
    function resolveRoomCount(context) {
        var roomCount = parseInt(String(context.roomCount || 0), 10);
        var roomCapacity = getRoomCapacityForAccommodationType(context.accommodationType);
        var resolvedAutoCount = Math.ceil(Math.max(1, Number(context.guests || 1)) / Math.max(1, roomCapacity));
        if (!Number.isFinite(resolvedAutoCount) || resolvedAutoCount < 1) {
            resolvedAutoCount = 1;
        }
        resolvedAutoCount = Math.min(getMaxRoomsLimit(), resolvedAutoCount);
        if (Number.isFinite(roomCount) && roomCount > 0) {
            return Math.min(getMaxRoomsLimit(), roomCount);
        }
        return resolvedAutoCount;
    }
    function formatRoomCountLabel(roomCount) {
        var numericRoomCount = parseInt(String(roomCount || '1'), 10);
        if (!Number.isFinite(numericRoomCount) || numericRoomCount < 1) {
            numericRoomCount = 1;
        }
        if (numericRoomCount === 1) {
            return String((config.strings && config.strings.roomCountSingular) || '%d Room').replace('%d', '1');
        }
        return String((config.strings && config.strings.roomCountPlural) || '%d Rooms').replace('%d', String(numericRoomCount));
    }
    function getMaxGuestsLimit(accommodationType, roomCount) {
        var parsed = parseInt(String(config.maxGuests || '5'), 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return 5;
        }
        if (isFixedRoomMode()) {
            return Math.max(1, Math.min(parsed, getRoomCapacityForAccommodationType(accommodationType)));
        }
        return parsed;
    }
    function getResultsDateRangeText(context) {
        var strings = config.strings || {};
        var checkinDate = parseDateString(context.checkin);
        var checkoutDate = parseDateString(context.checkout);
        if (!checkinDate || !checkoutDate) {
            return String(strings.selectDatesSummary || 'Select dates');
        }
        return [
            String(checkinDate.getDate()).padStart(2, '0'),
            monthNames[checkinDate.getMonth()],
            '-',
            String(checkoutDate.getDate()).padStart(2, '0'),
            monthNames[checkoutDate.getMonth()],
            checkoutDate.getFullYear()
        ].join(' ');
    }
    function getResultsSelectionSummary(context, accommodationTypeSelect) {
        var label = getAccommodationTypeLabel(accommodationTypeSelect);
        var template = (config.strings && config.strings.selectionSummaryFormat) || '%1$s / %2$d Guests / %3$s';
        var roomCountLabel = formatRoomCountLabel(resolveRoomCount(context));
        return formatThreeValueTemplate(template, label, context.guests, roomCountLabel);
    }
    function updateResultsSummary(context, accommodationTypeSelect) {
        var dateRangeEl = document.getElementById('must-booking-results-date-range');
        var selectionSummaryEl = document.getElementById('must-booking-results-selection-summary');
        if (dateRangeEl) {
            dateRangeEl.textContent = getResultsDateRangeText(context);
        }
        if (selectionSummaryEl) {
            selectionSummaryEl.textContent = getResultsSelectionSummary(context, accommodationTypeSelect);
        }
    }
    function getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountInput) {
        var checkin = String(checkinInput.value || '').trim();
        var checkout = String(checkoutInput.value || '').trim();
        var accommodationType = getAccommodationTypeValue(accommodationTypeSelect);
        var roomCount = getRoomCountValue(roomCountInput);
        var guests = parseInt(String(guestsInput.value || '1'), 10);
        var maxGuests = getMaxGuestsLimit(accommodationType, roomCount);
        if (!Number.isFinite(guests) || guests < 1) {
            guests = 1;
        }
        if (guests > maxGuests) {
            guests = maxGuests;
        }
        return {
            checkin: checkin,
            checkout: checkout,
            guests: guests,
            roomCount: roomCount,
            accommodationType: accommodationType,
            roomId: isFixedRoomMode() ? getFixedRoomId() : 0,
            availabilityRoomId: isFixedRoomMode() ? getFixedAvailabilityRoomId() : 0
        };
    }
    function isValidRange(context) {
        return (
            isValidDateString(context.checkin) &&
            isValidDateString(context.checkout) &&
            context.checkin < context.checkout
        );
    }
    function setLoading(loadingEl, isLoading) {
        if (!loadingEl) {
            return;
        }
        if (!isLoading) {
            loadingEl.style.display = 'none';
            loadingEl.textContent = '';
            return;
        }
        loadingEl.style.display = '';
        loadingEl.textContent = (config.strings && config.strings.loading) || 'Loading...';
    }
    function setMessage(messagesEl, message, type) {
        if (!messagesEl) {
            return;
        }
        if (!message) {
            messagesEl.innerHTML = '';
            messagesEl.hidden = true;
            return;
        }
        var cssClass = type === 'error' ? 'must-booking-message must-booking-message-error' : 'must-booking-message';
        messagesEl.hidden = false;
        messagesEl.innerHTML = '<p class="' + cssClass + '">' + escapeHtml(message) + '</p>';
    }
    function syncHiddenSelectionFields(context) {
        var checkinFields = document.querySelectorAll('.must-booking-hidden-checkin');
        var checkoutFields = document.querySelectorAll('.must-booking-hidden-checkout');
        var guestsFields = document.querySelectorAll('.must-booking-hidden-guests');
        var roomCountFields = document.querySelectorAll('.must-booking-room-count');
        var accommodationTypeFields = document.querySelectorAll('.must-booking-hidden-accommodation-type');
        var roomIdFields = document.querySelectorAll('.must-booking-hidden-room-id');
        var inventoryRoomIdFields = document.querySelectorAll('input[name="inventory_room_id"], input[name="physical_room_id"]');
        checkinFields.forEach(function (field) {
            field.value = context.checkin;
        });
        checkoutFields.forEach(function (field) {
            field.value = context.checkout;
        });
        guestsFields.forEach(function (field) {
            field.value = String(context.guests);
        });
        roomCountFields.forEach(function (field) {
            field.value = String(context.roomCount || 0);
        });
        accommodationTypeFields.forEach(function (field) {
            field.value = String(context.accommodationType || '');
        });
        roomIdFields.forEach(function (field) {
            field.value = String(context.roomId || 0);
        });
        inventoryRoomIdFields.forEach(function (field) {
            field.value = String(context.availabilityRoomId || 0);
        });
    }
    function rebuildGuestsSelectOptions(guestsSelect, guestsInput, accommodationTypeSelect, roomCountSelect) {
        if (!guestsSelect || !guestsInput) {
            return;
        }
        var accommodationType = getAccommodationTypeValue(accommodationTypeSelect);
        var roomCount = getRoomCountValue(roomCountSelect);
        var maxGuests = getMaxGuestsLimit(accommodationType, roomCount);
        var currentGuests = parseInt(String(guestsInput.value || guestsSelect.value || '1'), 10);
        var options = [];
        if (!Number.isFinite(currentGuests) || currentGuests < 1) {
            currentGuests = 1;
        }
        if (currentGuests > maxGuests) {
            currentGuests = maxGuests;
        }
        for (var guestIndex = 1; guestIndex <= maxGuests; guestIndex++) {
            options.push({
                value: String(guestIndex),
                label: String(guestIndex)
            });
        }
        populateSelectOptions(guestsSelect, options, String(currentGuests));
        guestsInput.value = String(currentGuests);
    }
    function renderRooms(roomListEl, noRoomsEl, resultsEl, rooms, context) {
        if (!roomListEl || !noRoomsEl || !resultsEl) {
            return;
        }
        if (!Array.isArray(rooms) || rooms.length === 0) {
            roomListEl.innerHTML = '';
            noRoomsEl.textContent = state.lastAvailabilityMessage || ((config.strings && config.strings.noRooms) || 'No rooms are available for the selected dates.');
            noRoomsEl.style.display = '';
            resultsEl.style.display = '';
            return;
        }
        var strings = config.strings || {};
        var bookingUrl = String(config.bookingUrl || window.location.href);
        var nonce = String(config.selectRoomNonce || '');
        var arrowIconUrl = String(config.arrowIconUrl || '');
        var bedIconUrl = String(config.bedIconUrl || '');
        var html = rooms.map(function (room) {
            var roomId = Number(room.id || 0);
            var roomTypeId = Number(room.room_type_id || roomId || 0);
            var inventoryRoomId = Number(room.physical_room_id || 0);
            var submittedRoomId = inventoryRoomId > 0 ? roomTypeId : roomId;
            var inventoryRoomInput = inventoryRoomId > 0
                ? '<input type="hidden" name="inventory_room_id" value="' + escapeHtml(inventoryRoomId) + '" />'
                : '';
            var roomName = String(room.name || strings.roomLabel || 'Room');
            var roomDescription = String(room.description || '');
            var maxGuests = Number(room.max_guests || 0);
            var roomSize = String(room.room_size || '');
            var beds = String(room.beds || room.bed_setup || '');
            var viewType = String(room.view_type || '');
            var floor = Number(room.floor || 0);
            var estimatedTotal = room.dynamic_total_price !== null && room.dynamic_total_price !== undefined
                ? Number(room.dynamic_total_price)
                : (
                    room.price_preview_total !== null && room.price_preview_total !== undefined
                        ? Number(room.price_preview_total)
                        : null
                );
            var detailsUrl = String(room.details_url || '');
            var primaryImageUrl = String(room.primary_image_url || '');
            var galleryImages = Array.isArray(room.gallery_images) ? room.gallery_images.slice(0, 3) : [];
            var ratePlans = Array.isArray(room.rate_plans) ? room.rate_plans : [];
            var metaParts = [];
            if (maxGuests > 0) {
                metaParts.push('<span>' + escapeHtml(formatTemplate(strings.capacityFormat || '%d Guests', maxGuests)) + '</span>');
            }
            if (roomSize !== '') {
                metaParts.push('<span>' + escapeHtml(roomSize) + '</span>');
            }
            if (beds !== '') {
                metaParts.push('<span>' + escapeHtml(beds) + '</span>');
            }
            if (viewType !== '') {
                metaParts.push('<span>' + escapeHtml(viewType) + '</span>');
            }
            if (floor !== 0) {
                metaParts.push('<span>' + escapeHtml((strings.floorLabel || 'Floor') + ' ' + floor) + '</span>');
            }
            if (estimatedTotal !== null && Number.isFinite(estimatedTotal)) {
                metaParts.push('<span>' + escapeHtml(formatTemplate(strings.estimatedTotalFormat || 'Estimated Total: %s', formatPrice(estimatedTotal))) + '</span>');
            }
            var metaHtml = metaParts.length > 0
                ? '<div class="must-booking-room-meta">' + metaParts.join('') + '</div>'
                : '';
            var mediaHtml = primaryImageUrl !== ''
                ? '<div class="must-booking-room-media"><img src="' + escapeHtml(primaryImageUrl) + '" alt="' + escapeHtml(roomName) + '" loading="lazy" /></div>'
                : '<div class="must-booking-room-media"><div class="must-booking-room-media-placeholder">' + escapeHtml(strings.noImage || 'Image unavailable') + '</div></div>';
            var thumbsHtml = galleryImages.map(function (imageUrl) {
                return '<span class="must-booking-room-thumb"><img src="' + escapeHtml(String(imageUrl || '')) + '" alt="" loading="lazy" /></span>';
            }).join('');
            while (galleryImages.length < 3) {
                thumbsHtml += '<span class="must-booking-room-thumb is-placeholder" aria-hidden="true"></span>';
                galleryImages.push('');
            }
            var arrowIconHtml = arrowIconUrl !== ''
                ? '<img src="' + escapeHtml(arrowIconUrl) + '" alt="" aria-hidden="true" />'
                : '';
            var bedIconHtml = bedIconUrl !== ''
                ? '<img src="' + escapeHtml(bedIconUrl) + '" alt="" aria-hidden="true" />'
                : '';
            var descriptionHtml = roomDescription !== ''
                ? '<p class="must-booking-room-description">' + escapeHtml(roomDescription) + '</p>'
                : '';
            var detailsLinkHtml = detailsUrl !== ''
                ? (
                    '<a class="must-booking-room-details" href="' + escapeHtml(detailsUrl) + '">' +
                    '<span>' + escapeHtml(strings.additionalDetails || 'Additional Details') + '</span>' +
                    bedIconHtml +
                    '</a>'
                )
                : '';
            var ratePlansHtml = ratePlans.map(function (ratePlan) {
                var ratePlanId = Number(ratePlan.id || 0);
                var ratePlanName = String(ratePlan.name || 'Rate');
                var ratePlanDescription = String(ratePlan.description || '');
                var nightlyPrice = Number(ratePlan.nightly_price || 0);
                var totalPrice = Number(ratePlan.total_price || 0);
                var metaHtml = '';
                if (ratePlanDescription !== '' || (Number.isFinite(totalPrice) && totalPrice > 0)) {
                    metaHtml =
                        '<div class="must-booking-room-rate-plan-meta">' +
                        (ratePlanDescription !== '' ? '<p>' + escapeHtml(ratePlanDescription) + '</p>' : '') +
                        ((Number.isFinite(totalPrice) && totalPrice > 0)
                            ? '<p>' + escapeHtml(formatTemplate(strings.stayTotalFormat || 'Stay Total: %s', formatPrice(totalPrice))) + '</p>'
                            : '') +
                        '</div>';
                }
                return (
                    '<div class="must-booking-room-rate-plan">' +
                    '<div class="must-booking-room-rate-plan-copy">' +
                    '<strong>' + escapeHtml(ratePlanName) + '</strong>' +
                    '<span>' + escapeHtml(formatPrice(nightlyPrice)) + '</span>' +
                    '</div>' +
                    metaHtml +
                    '<form class="must-hotel-booking-select-room-form" method="post" action="' + escapeHtml(bookingUrl) + '">' +
                    '<input type="hidden" name="must_booking_nonce" value="' + escapeHtml(nonce) + '" />' +
                    '<input type="hidden" name="must_booking_action" value="select_room" />' +
                    '<input type="hidden" name="room_id" value="' + escapeHtml(submittedRoomId) + '" />' +
                    inventoryRoomInput +
                    '<input type="hidden" name="rate_plan_id" value="' + escapeHtml(ratePlanId) + '" />' +
                    '<input class="must-booking-hidden-checkin" type="hidden" name="checkin" value="' + escapeHtml(context.checkin) + '" />' +
                    '<input class="must-booking-hidden-checkout" type="hidden" name="checkout" value="' + escapeHtml(context.checkout) + '" />' +
                    '<input class="must-booking-hidden-guests" type="hidden" name="guests" value="' + escapeHtml(context.guests) + '" />' +
                    '<input class="must-booking-room-count" type="hidden" name="room_count" value="' + escapeHtml(context.roomCount || 0) + '" />' +
                    '<input class="must-booking-hidden-accommodation-type" type="hidden" name="accommodation_type" value="' + escapeHtml(context.accommodationType || '') + '" />' +
                    '<button type="submit" class="must-booking-room-book-button">' +
                    '<span>' + escapeHtml(strings.bookNow || 'Book Now') + '</span>' +
                    arrowIconHtml +
                    '</button>' +
                    '</form>' +
                    '</div>'
                );
            }).join('');
            return (
                '<article class="must-hotel-booking-room-card">' +
                mediaHtml +
                '<div class="must-booking-room-content">' +
                '<div class="must-booking-room-header">' +
                '<h3>' + escapeHtml(roomName) + '</h3>' +
                descriptionHtml +
                metaHtml +
                '</div>' +
                '<div class="must-booking-room-thumbs">' + thumbsHtml + '</div>' +
                '<div class="must-booking-room-actions">' +
                (ratePlansHtml !== '' ? ('<div class="must-booking-room-rate-plans">' + ratePlansHtml + '</div>') : '') +
                detailsLinkHtml +
                '</div>' +
                '</div>' +
                '</article>'
            );
        }).join('');
        roomListEl.innerHTML = html;
        state.lastAvailabilityMessage = '';
        noRoomsEl.style.display = 'none';
        resultsEl.style.display = '';
    }
    function setSummaryDate(dayEl, monthEl, value) {
        if (!dayEl || !monthEl) {
            return;
        }
        var date = parseDateString(value);
        if (!date) {
            dayEl.textContent = '--';
            monthEl.textContent = '--';
            return;
        }
        dayEl.textContent = String(date.getDate()).padStart(2, '0');
        monthEl.textContent = monthNames[date.getMonth()];
    }
    function updateSummary(context) {
        var arrivalDayEl = document.getElementById('must-booking-arrival-day');
        var arrivalMonthEl = document.getElementById('must-booking-arrival-month');
        var departureDayEl = document.getElementById('must-booking-departure-day');
        var departureMonthEl = document.getElementById('must-booking-departure-month');
        setSummaryDate(arrivalDayEl, arrivalMonthEl, context.checkin);
        setSummaryDate(departureDayEl, departureMonthEl, context.checkout);
    }
    function updateCalendarMeta(picker, monthId, yearId) {
        if (!picker) {
            return;
        }
        var monthEl = document.getElementById(monthId);
        var yearEl = document.getElementById(yearId);
        if (!monthEl || !yearEl) {
            return;
        }
        var floorDate = getMonthFloorDate();
        var checkinInput = document.getElementById('must-booking-checkin');
        var minDateString = floorDate.getFullYear() + '-' + String(floorDate.getMonth() + 1).padStart(2, '0') + '-01';
        if (monthId === 'must-booking-checkout-month' && checkinInput && String(checkinInput.value || '') !== '') {
            minDateString = addDays(String(checkinInput.value), 1);
        }
        var minDate = parseDateString(minDateString);
        var minYear = minDate ? minDate.getFullYear() : floorDate.getFullYear();
        var minMonth = minDate && picker.currentYear === minYear ? minDate.getMonth() : 0;
        var monthOptions = monthNames.map(function (label, index) {
            return {
                value: String(index),
                label: label,
                disabled: picker.currentYear === minYear && index < minMonth
            };
        });
        populateSelectOptions(monthEl, monthOptions, String(picker.currentMonth || 0));
        populateSelectOptions(yearEl, getYearOptions(picker.currentYear || minYear, minYear), String(picker.currentYear || ''));
    }
    function updateCalendarShiftState() {
        var previousButton = document.getElementById('must-booking-cal-prev');
        if (!previousButton || !state.checkinPicker) {
            return;
        }
        var floorDate = getMonthFloorDate();
        var checkinMonthDate = new Date(state.checkinPicker.currentYear, state.checkinPicker.currentMonth, 1);
        var canMovePrev = checkinMonthDate.getTime() > floorDate.getTime();
        previousButton.disabled = !canMovePrev;
        previousButton.classList.toggle('is-disabled', !canMovePrev);
    }
    function updateRangeHighlights(checkinValue, checkoutValue, previewCheckoutValue) {
        var startDate = parseDateString(checkinValue);
        var endDate = parseDateString(previewCheckoutValue || checkoutValue);
        var start = startDate ? formatDate(startDate) : '';
        var end = endDate ? formatDate(endDate) : '';
        [state.checkinPicker, state.checkoutPicker].forEach(function (picker) {
            if (!picker || !picker.calendarContainer) {
                return;
            }
            var dayElements = picker.calendarContainer.querySelectorAll('.flatpickr-day');
            dayElements.forEach(function (dayElement) {
                dayElement.classList.remove('must-booking-day-in-range');
                dayElement.classList.remove('must-booking-day-start');
                dayElement.classList.remove('must-booking-day-end');
                if (!dayElement.dateObj) {
                    return;
                }
                var current = formatDate(dayElement.dateObj);
                if (start && current === start) {
                    dayElement.classList.add('must-booking-day-start');
                }
                if (end && current === end) {
                    dayElement.classList.add('must-booking-day-end');
                }
                if (!start || !end || end <= start) {
                    return;
                }
                if (current > start && current < end) {
                    dayElement.classList.add('must-booking-day-in-range');
                }
            });
        });
    }
    function markUnavailableDayElement(dayElement, unavailableDates) {
        if (!dayElement || !dayElement.dateObj) {
            return;
        }
        var dates = normalizeDateList(unavailableDates);
        var dateString = formatDate(dayElement.dateObj);
        var isUnavailable = dates.indexOf(dateString) !== -1;
        dayElement.classList.toggle('must-booking-day-unavailable', isUnavailable);
        if (isUnavailable) {
            dayElement.setAttribute('aria-disabled', 'true');
            return;
        }
        if (!dayElement.classList.contains('flatpickr-disabled') && !dayElement.classList.contains('notAllowed')) {
            dayElement.removeAttribute('aria-disabled');
        }
    } function syncUnavailableDayClasses(picker, unavailableDates) {
        if (!picker || !picker.calendarContainer) {
            return;
        }
        var dates = normalizeDateList(unavailableDates);
        var dayElements = picker.calendarContainer.querySelectorAll('.flatpickr-day');
        dayElements.forEach(function (dayElement) {
            dayElement.classList.remove('must-booking-day-unavailable');
            markUnavailableDayElement(dayElement, dates);
        });
    }
    function refreshUnavailableDayClasses() {
        var checkinInput = document.getElementById('must-booking-checkin');
        var checkoutInput = document.getElementById('must-booking-checkout');

        syncUnavailableDayClasses(
            state.checkinPicker,
            !state.checkoutPicker && checkinInput && checkoutInput
                ? getSingleCalendarVisualUnavailableDates(
                    checkinInput.value,
                    checkoutInput.value
                )
                : state.disabledCheckinDates
        );

        syncUnavailableDayClasses(
            state.checkoutPicker,
            state.disabledCheckoutDates
        );
    }

    function normalizeDateList(value) {
        if (!Array.isArray(value)) {
            return [];
        }

        return value.filter(function (date) {
            return isValidDateString(date);
        }).map(function (date) {
            return String(date);
        });
    }

    function isDateInList(date, dates) {
        return dates.indexOf(String(date || '')) !== -1;
    }

    function getSingleCalendarDisabledDates(selectedCheckin, selectedCheckout) {
        var currentCheckin = String(selectedCheckin || '').trim();
        var currentCheckout = String(selectedCheckout || '').trim();

        /*
         * When check-in exists but checkout is empty, the next click is checkout.
         * In every other state, the next click starts a new check-in selection.
         */
        if (
            isValidDateString(currentCheckin) &&
            !isValidDateString(currentCheckout)
        ) {
            return normalizeDateList(state.disabledCheckoutDates);
        }

        return normalizeDateList(state.disabledCheckinDates);
    }

    function getSingleCalendarUnavailableDates(
        selectedCheckin,
        selectedCheckout
    ) {
        return getSingleCalendarDisabledDates(
            selectedCheckin,
            selectedCheckout
        );
    }

    function getSingleCalendarVisualUnavailableDates(
        selectedCheckin,
        selectedCheckout
    ) {
        return getSingleCalendarUnavailableDates(
            selectedCheckin,
            selectedCheckout
        );
    }

    function isSingleCalendarUnavailableDate(
        date,
        selectedCheckin,
        selectedCheckout
    ) {
        return getSingleCalendarDisabledDates(
            selectedCheckin,
            selectedCheckout
        ).indexOf(String(date || '')) !== -1;
    }

    function findFirstAvailableDate(startDate, disabledDates) {
        var start = parseDateString(startDate || config.today || '');
        var windowDays = parseInt(String(config.windowDays || '180'), 10);
        var dates = normalizeDateList(disabledDates);

        if (!start) {
            return '';
        }

        if (!Number.isFinite(windowDays) || windowDays < 1) {
            windowDays = 180;
        }

        for (var index = 0; index < windowDays; index++) {
            var candidate = new Date(start.getTime());
            candidate.setDate(candidate.getDate() + index);

            var formatted = formatDate(candidate);

            if (dates.indexOf(formatted) === -1) {
                return formatted;
            }
        }

        return '';
    }

    function findFirstAvailableCheckout(checkin, disabledCheckoutDates) {
        var start = parseDateString(checkin);
        var windowDays = parseInt(String(config.windowDays || '180'), 10);
        var dates = normalizeDateList(disabledCheckoutDates);

        if (!start) {
            return '';
        }

        if (!Number.isFinite(windowDays) || windowDays < 1) {
            windowDays = 180;
        }

        for (var nights = 1; nights <= windowDays; nights++) {
            var candidate = new Date(start.getTime());
            candidate.setDate(candidate.getDate() + nights);

            var formatted = formatDate(candidate);

            if (dates.indexOf(formatted) === -1) {
                return formatted;
            }
        }

        return '';
    }
    function getSingleCalendarDisabledDates(selectedCheckin, selectedCheckout) {
        var currentCheckin = String(selectedCheckin || '').trim();
        var currentCheckout = String(selectedCheckout || '').trim();

        /*
         * With one calendar, the meaning of a click depends on the current step:
         *
         * - No active unfinished range: the next click selects check-in.
         * - Check-in selected and checkout empty: the next click selects checkout.
         *
         * Checkout-specific disabled dates must never globally disable dates that
         * can still be selected as a new check-in.
         */
        if (
            isValidDateString(currentCheckin) &&
            !isValidDateString(currentCheckout)
        ) {
            return normalizeDateList(state.disabledCheckoutDates);
        }

        return normalizeDateList(state.disabledCheckinDates);
    }

    function getInitialDisabledDatesPayload() {
        return config.initialDisabledDates && typeof config.initialDisabledDates === 'object'
            ? config.initialDisabledDates
            : {};
    }
    function applyInitialDisabledDatesBeforePickers(checkinInput, checkoutInput) {
        var payload = getInitialDisabledDatesPayload();
        var disabledCheckinDates = normalizeDateList(payload.disabled_checkin_dates);
        var disabledCheckoutDates = normalizeDateList(payload.disabled_checkout_dates);
        var today = isValidDateString(config.today || '') ? String(config.today) : formatDate(new Date());
        var firstAvailableCheckin = isValidDateString(payload.first_available_checkin || '')
            ? String(payload.first_available_checkin)
            : findFirstAvailableDate(today, disabledCheckinDates);
        state.disabledCheckinDates = disabledCheckinDates;
        state.disabledCheckoutDates = disabledCheckoutDates;
        if (!firstAvailableCheckin) {
            return;
        }
        var currentCheckin = String(checkinInput.value || '').trim();
        if (
            !isValidDateString(currentCheckin) ||
            currentCheckin < today ||
            isDateInList(currentCheckin, disabledCheckinDates)
        ) {
            checkinInput.value = firstAvailableCheckin;
            currentCheckin = firstAvailableCheckin;
        }
        var currentCheckout = String(checkoutInput.value || '').trim();
        var firstAvailableCheckout = isValidDateString(payload.first_available_checkout || '')
            ? String(payload.first_available_checkout)
            : findFirstAvailableCheckout(currentCheckin, disabledCheckoutDates);
        if (
            firstAvailableCheckout &&
            (
                !isValidDateString(currentCheckout) ||
                currentCheckout <= currentCheckin ||
                isDateInList(currentCheckout, disabledCheckoutDates)
            )
        ) {
            checkoutInput.value = firstAvailableCheckout;
        }
    }
    function applyDisabledDatesToPickers(disabledCheckinDates, disabledCheckoutDates, checkinInput, checkoutInput, payload) {
        var checkinDates = normalizeDateList(disabledCheckinDates);
        var checkoutDates = normalizeDateList(disabledCheckoutDates);
        var today = isValidDateString(config.today || '') ? String(config.today) : formatDate(new Date());
        var currentCheckin = String(checkinInput.value || '').trim();
        var nextCheckin = currentCheckin;
        var responsePayload = payload && typeof payload === 'object' ? payload : {};
        var firstAvailableCheckin = isValidDateString(responsePayload.first_available_checkin || '')
            ? String(responsePayload.first_available_checkin)
            : findFirstAvailableDate(today, checkinDates);
        state.disabledCheckinDates = checkinDates.slice();
        state.disabledCheckoutDates = checkoutDates.slice();
        if (
            firstAvailableCheckin &&
            (
                !isValidDateString(nextCheckin) ||
                nextCheckin < today ||
                isDateInList(nextCheckin, checkinDates)
            )
        ) {
            nextCheckin = firstAvailableCheckin;
            checkinInput.value = nextCheckin;
            if (state.checkinPicker) {
                state.checkinPicker.setDate(nextCheckin, false);
                state.checkinPicker.jumpToDate(nextCheckin, true);
            }
        }
        if (state.checkinPicker) {
            state.checkinPicker.set(
                'disable',
                !state.checkoutPicker ? getSingleCalendarDisabledDates(
                    nextCheckin,
                    checkoutInput.value
                ) : state.disabledCheckinDates
            );
        }
        if (!state.checkoutPicker) {
            refreshUnavailableDayClasses();
            return;
        }
        var minCheckout = isValidDateString(nextCheckin) ? addDays(nextCheckin, 1) : today;
        var currentCheckout = String(checkoutInput.value || '').trim();
        var firstAvailableCheckout = isValidDateString(responsePayload.first_available_checkout || '')
            ? String(responsePayload.first_available_checkout)
            : findFirstAvailableCheckout(nextCheckin, checkoutDates);
        state.checkoutPicker.set('minDate', minCheckout || today);
        state.checkoutPicker.set('disable', checkoutDates);
        if (
            firstAvailableCheckout &&
            (
                !isValidDateString(currentCheckout) ||
                currentCheckout <= nextCheckin ||
                isDateInList(currentCheckout, checkoutDates)
            )
        ) {
            checkoutInput.value = firstAvailableCheckout;
            state.checkoutPicker.setDate(firstAvailableCheckout, false);
            state.checkoutPicker.jumpToDate(firstAvailableCheckout, true);
        }
        refreshUnavailableDayClasses();
    }
    function fetchDisabledDates(context) {
        if (!config.ajaxUrl || !config.disabledDatesAction) {
            return Promise.resolve();
        }
        var params = new URLSearchParams();
        params.append('action', String(config.disabledDatesAction));
        params.append('nonce', String(config.availabilityNonce || ''));
        params.append('guests', String(context.guests));
        params.append('room_count', String(context.roomCount || 0));
        params.append('accommodation_type', String(context.accommodationType || getAccommodationTypeValue()));
        params.append('window_days', String(config.windowDays || 180));
        var disabledDatesRoomId = Number(context.roomId || 0);
        var disabledDatesAvailabilityRoomId = Number(context.availabilityRoomId || 0);
        if (disabledDatesAvailabilityRoomId > 0) {
            params.append('room_id', String(disabledDatesAvailabilityRoomId));
            if (disabledDatesRoomId > 0 && disabledDatesAvailabilityRoomId !== disabledDatesRoomId) {
                params.append('inventory_room_id', String(disabledDatesAvailabilityRoomId));
            }
        } else if (disabledDatesRoomId > 0) {
            params.append('room_id', String(disabledDatesRoomId));
        }
        if (isValidDateString(context.checkin)) {
            params.append('checkin', context.checkin);
        }
        var requestToken = ++state.disabledDatesRequestToken;
        return fetch(String(config.ajaxUrl) + '?' + params.toString(), {
            method: 'GET',
            credentials: 'same-origin'
        }).then(function (response) {
            if (!response.ok) {
                throw new Error('disabled-dates-request-failed');
            }
            return response.json();
        }).then(function (payload) {
            if (requestToken !== state.disabledDatesRequestToken) {
                return;
            }
            if (!payload || payload.success !== true || !payload.data) {
                throw new Error('disabled-dates-response-invalid');
            }
            var data = payload.data;
            var disabledDatesSource = String(data.disabled_dates_source || '');
            var disabledDatesStatus = String(data.disabled_dates_status || '');
            var disabledCheckinDates = Array.isArray(data.disabled_checkin_dates) ? data.disabled_checkin_dates : [];
            var disabledCheckoutDates = Array.isArray(data.disabled_checkout_dates) ? data.disabled_checkout_dates : [];
            /**
             * Clock disabled-date calendars are allowed to fail open server-side.
             * But the frontend should not wipe already-known unavailable dates when that happens.
             */
            if (
                disabledDatesSource === 'clock_rates_availability' &&
                disabledDatesStatus !== '' &&
                disabledDatesStatus !== 'ok'
            ) {
                refreshUnavailableDayClasses();
                return;
            }
            var checkinInput = document.getElementById('must-booking-checkin');
            var checkoutInput = document.getElementById('must-booking-checkout');
            if (!checkinInput || !checkoutInput) {
                return;
            }
            applyDisabledDatesToPickers(disabledCheckinDates, disabledCheckoutDates, checkinInput, checkoutInput, data);
            var guestsInput = document.getElementById('must-booking-guests');
            var roomCountInput = document.getElementById('must-booking-room-count-select') || document.getElementById('must-booking-room-count');
            if (guestsInput) {
                updateSummary(getContext(checkinInput, checkoutInput, guestsInput, document.getElementById('must-booking-accommodation-type'), roomCountInput));
                updateResultsSummary(getContext(checkinInput, checkoutInput, guestsInput, document.getElementById('must-booking-accommodation-type'), roomCountInput), document.getElementById('must-booking-accommodation-type'));
            } else {
                var fallbackContext = {
                    checkin: checkinInput.value || '',
                    checkout: checkoutInput.value || '',
                    guests: 1,
                    roomCount: 0,
                    accommodationType: getAccommodationTypeValue()
                };
                updateSummary(fallbackContext);
                updateResultsSummary(fallbackContext, document.getElementById('must-booking-accommodation-type'));
            }
            updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
        }).catch(function () {
            return null;
        });
    }
    function fetchAvailability(context, roomListEl, noRoomsEl, resultsEl, loadingEl, messagesEl, options) {
        var suppressRender = Boolean(options && options.suppressRender);
        if (!config.ajaxUrl || !config.availabilityAction) {
            return Promise.resolve([]);
        }
        if (!isValidRange(context)) {
            if (context.checkin !== '' && context.checkout !== '') {
                setMessage(
                    messagesEl,
                    (config.strings && config.strings.invalidRange) || 'Please select valid dates.',
                    'error'
                );
            } else {
                setMessage(messagesEl, '', '');
            }
            if (resultsEl) {
                resultsEl.style.display = 'none';
            }
            if (roomListEl) {
                roomListEl.innerHTML = '';
            }
            return Promise.resolve([]);
        }
        setMessage(messagesEl, '', '');
        state.lastAvailabilityStatus = '';
        setLoading(loadingEl, true);
        var params = new URLSearchParams();
        params.append('action', String(config.availabilityAction));
        params.append('nonce', String(config.availabilityNonce || ''));
        params.append('checkin', context.checkin);
        params.append('checkout', context.checkout);
        params.append('guests', String(context.guests));
        params.append('room_count', String(context.roomCount || 0));
        params.append('accommodation_type', String(context.accommodationType || getAccommodationTypeValue()));
        var availabilityRoomId = Number(context.roomId || 0);
        var availabilityPhysicalRoomId = Number(context.availabilityRoomId || 0);
        if (availabilityPhysicalRoomId > 0) {
            params.append('room_id', String(availabilityPhysicalRoomId));
            if (availabilityRoomId > 0 && availabilityPhysicalRoomId !== availabilityRoomId) {
                params.append('inventory_room_id', String(availabilityPhysicalRoomId));
            }
        } else if (availabilityRoomId > 0) {
            params.append('room_id', String(availabilityRoomId));
        }
        var requestToken = ++state.availabilityRequestToken;
        return fetch(String(config.ajaxUrl) + '?' + params.toString(), {
            method: 'GET',
            credentials: 'same-origin'
        }).then(function (response) {
            if (!response.ok) {
                throw new Error('availability-request-failed');
            }
            return response.json();
        }).then(function (payload) {
            if (requestToken !== state.availabilityRequestToken) {
                return;
            }
            if (!payload || payload.success !== true || !payload.data) {
                throw new Error('availability-response-invalid');
            }
            var rooms = Array.isArray(payload.data.rooms) ? payload.data.rooms : [];
            state.lastAvailabilityMessage = typeof payload.data.message === 'string' ? payload.data.message : '';
            state.lastAvailabilityStatus = typeof payload.data.availability_status === 'string'
                ? payload.data.availability_status
                : '';
            syncHiddenSelectionFields(context);
            if (!suppressRender) {
                renderRooms(roomListEl, noRoomsEl, resultsEl, rooms, context);
            }
            return rooms;
        }).catch(function () {
            if (requestToken !== state.availabilityRequestToken) {
                return [];
            }
            state.lastAvailabilityMessage = '';
            state.lastAvailabilityStatus = 'provider_unconfirmed';
            setMessage(
                messagesEl,
                (config.strings && config.strings.requestFailed) || 'Unable to load availability.',
                'error'
            );
            return [];
        }).finally(function () {
            if (requestToken !== state.availabilityRequestToken) {
                return;
            }
            setLoading(loadingEl, false);
        });
    }
    function initializeDatePickers(checkinInput, checkoutInput, onFieldChange) {
        if (typeof window.flatpickr !== 'function') {
            return;
        }
        var checkinCalendar = document.getElementById('must-booking-checkin-calendar');
        var checkoutCalendar = document.getElementById('must-booking-checkout-calendar');
        var useOneCalendar = String(config.calendarLayout || 'two_calendars') === 'one_calendar';
        function handleCalendarDateSelection(dateStr) {
            var selectedDate = String(dateStr || '').trim();
            var currentCheckin = String(checkinInput.value || '').trim();
            var currentCheckout = String(checkoutInput.value || '').trim();
            if (!isValidDateString(selectedDate)) {
                return;
            }
            if (isSingleCalendarUnavailableDate(
                selectedDate,
                currentCheckin,
                currentCheckout
            )) {
                refreshUnavailableDayClasses();
                updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                return;
            }
            if (!isValidDateString(currentCheckin) || isValidDateString(currentCheckout) || selectedDate <= currentCheckin) {
                checkinInput.value = selectedDate;
                checkoutInput.value = '';
                state.previewCheckout = '';
                if (state.checkinPicker) {
                    state.checkinPicker.setDate(selectedDate, false);
                    state.checkinPicker.set(
                        'disable',
                        getSingleCalendarDisabledDates(
                            selectedDate,
                            ''
                        )
                    );
                    state.checkinPicker.jumpToDate(selectedDate, true);
                }
                refreshUnavailableDayClasses();
                updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                onFieldChange('checkin');
                return;
            }
            checkoutInput.value = selectedDate;
            state.previewCheckout = '';
            if (state.checkinPicker) {
                state.checkinPicker.set(
                    'disable',
                    getSingleCalendarDisabledDates(
                        checkinInput.value,
                        selectedDate
                    )
                );
            }
            refreshUnavailableDayClasses();
            updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
            onFieldChange('checkout');
        }
        if (checkinCalendar && checkoutCalendar && useOneCalendar) {
            state.checkoutPicker = null;
            state.checkinPicker = window.flatpickr(checkinCalendar, {
                inline: true,
                disableMobile: true,
                dateFormat: 'Y-m-d',
                allowInput: false,
                disable: getSingleCalendarDisabledDates(
                    checkinInput.value,
                    checkoutInput.value
                ),
                locale: {
                    firstDayOfWeek: 1
                },
                defaultDate: isValidDateString(checkinInput.value) ? checkinInput.value : null,
                minDate: config.today || 'today',
                onChange: function (selectedDates, dateStr) {
                    handleCalendarDateSelection(dateStr);
                },
                onMonthChange: function () {
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                },
                onYearChange: function () {
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                },
                onDayCreate: function (selectedDates, dateStr, instance, dayElement) {
                    markUnavailableDayElement(
                        dayElement,
                        getSingleCalendarVisualUnavailableDates(
                            checkinInput.value,
                            checkoutInput.value
                        )
                    );
                }
            });
            if (state.checkinPicker && state.checkinPicker.calendarContainer) {
                state.checkinPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            }
            updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
            updateCalendarShiftState();
            refreshUnavailableDayClasses();
            updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
            var singlePreviousButton = document.getElementById('must-booking-cal-prev');
            var singleNextButton = document.getElementById('must-booking-cal-next-inline') || document.getElementById('must-booking-cal-next');
            var singleCheckinMonthSelect = document.getElementById('must-booking-checkin-month');
            var singleCheckinYearSelect = document.getElementById('must-booking-checkin-year');
            if (singlePreviousButton) {
                singlePreviousButton.addEventListener('click', function () {
                    var floorDate = getMonthFloorDate();
                    var checkinMonthDate = new Date(state.checkinPicker.currentYear, state.checkinPicker.currentMonth, 1);
                    if (checkinMonthDate.getTime() <= floorDate.getTime()) {
                        updateCalendarShiftState();
                        return;
                    }
                    state.checkinPicker.changeMonth(-1);
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            if (singleNextButton) {
                singleNextButton.addEventListener('click', function () {
                    state.checkinPicker.changeMonth(1);
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            if (singleCheckinMonthSelect) {
                singleCheckinMonthSelect.addEventListener('change', function () {
                    var month = parseInt(String(singleCheckinMonthSelect.value || '0'), 10);
                    var year = parseInt(String((singleCheckinYearSelect && singleCheckinYearSelect.value) || state.checkinPicker.currentYear), 10);
                    if (!Number.isFinite(month) || month < 0 || month > 11 || !Number.isFinite(year)) {
                        return;
                    }
                    var floorDate = getMonthFloorDate();
                    var target = new Date(year, month, 1);
                    if (target.getTime() < floorDate.getTime()) {
                        target = floorDate;
                    }
                    state.checkinPicker.jumpToDate(target, true);
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            if (singleCheckinYearSelect) {
                singleCheckinYearSelect.addEventListener('change', function () {
                    if (singleCheckinMonthSelect) {
                        singleCheckinMonthSelect.dispatchEvent(new Event('change'));
                    }
                });
            }
            if (state.checkinPicker && state.checkinPicker.calendarContainer) {
                state.checkinPicker.calendarContainer.addEventListener('mouseover', function (event) {
                    var target = event.target && event.target.closest ? event.target.closest('.flatpickr-day') : null;
                    if (!target || !target.dateObj) {
                        return;
                    }
                    if (
                        target.classList.contains('flatpickr-disabled') ||
                        target.classList.contains('notAllowed') ||
                        target.classList.contains('must-booking-day-unavailable')
                    ) {
                        return;
                    }
                    if (!checkinInput.value || checkoutInput.value) {
                        return;
                    }
                    var hovered = formatDate(target.dateObj);
                    if (hovered <= String(checkinInput.value || '')) {
                        state.previewCheckout = '';
                        updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                        return;
                    }
                    state.previewCheckout = hovered;
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
                state.checkinPicker.calendarContainer.addEventListener('mouseleave', function () {
                    state.previewCheckout = '';
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            return;
        }
        if (checkinCalendar && checkoutCalendar) {
            state.checkoutPicker = window.flatpickr(checkoutCalendar, {
                inline: true,
                disableMobile: true,
                dateFormat: 'Y-m-d',
                allowInput: false,
                disable: state.disabledCheckoutDates,
                locale: {
                    firstDayOfWeek: 1
                },
                defaultDate: isValidDateString(checkoutInput.value) ? checkoutInput.value : null,
                minDate: isValidDateString(checkinInput.value)
                    ? addDays(checkinInput.value, 1)
                    : (config.today || 'today'),
                onChange: function (selectedDates, dateStr) {
                    checkoutInput.value = dateStr || '';
                    state.previewCheckout = '';
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                    onFieldChange('checkout');
                },
                onMonthChange: function () {
                    updateCalendarMeta(state.checkoutPicker, 'must-booking-checkout-month', 'must-booking-checkout-year');
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                },
                onYearChange: function () {
                    updateCalendarMeta(state.checkoutPicker, 'must-booking-checkout-month', 'must-booking-checkout-year');
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                },
                onDayCreate: function (selectedDates, dateStr, instance, dayElement) {
                    markUnavailableDayElement(dayElement, state.disabledCheckoutDates);
                }
            });
            state.checkinPicker = window.flatpickr(checkinCalendar, {
                inline: true,
                disableMobile: true,
                dateFormat: 'Y-m-d',
                allowInput: false,
                disable: state.disabledCheckinDates,
                locale: {
                    firstDayOfWeek: 1
                },
                defaultDate: isValidDateString(checkinInput.value) ? checkinInput.value : null,
                minDate: config.today || 'today',
                onChange: function (selectedDates, dateStr) {
                    checkinInput.value = dateStr || '';
                    if (!dateStr) {
                        checkoutInput.value = '';
                        state.checkoutPicker.clear();
                        state.checkoutPicker.set('minDate', config.today || 'today');
                    } else {
                        var minCheckout = addDays(dateStr, 1);
                        state.checkoutPicker.set('minDate', minCheckout);
                        if (!isValidDateString(checkoutInput.value) || checkoutInput.value <= dateStr) {
                            checkoutInput.value = '';
                            state.checkoutPicker.clear();
                            state.checkoutPicker.jumpToDate(minCheckout, true);
                        }
                    }
                    state.previewCheckout = '';
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                    onFieldChange('checkin');
                },
                onMonthChange: function () {
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                },
                onYearChange: function () {
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                },
                onDayCreate: function (selectedDates, dateStr, instance, dayElement) {
                    markUnavailableDayElement(dayElement, state.disabledCheckinDates);
                }
            });
            if (!isValidDateString(checkoutInput.value)) {
                state.checkoutPicker.changeMonth(1);
            }
            if (state.checkinPicker && state.checkinPicker.calendarContainer) {
                state.checkinPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            }
            if (state.checkoutPicker && state.checkoutPicker.calendarContainer) {
                state.checkoutPicker.calendarContainer.classList.add('must-booking-flatpickr-instance');
            }
            updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
            updateCalendarMeta(state.checkoutPicker, 'must-booking-checkout-month', 'must-booking-checkout-year');
            updateCalendarShiftState();
            refreshUnavailableDayClasses();
            updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
            var previousButton = document.getElementById('must-booking-cal-prev');
            var nextButton = document.getElementById('must-booking-cal-next');
            var checkinMonthSelect = document.getElementById('must-booking-checkin-month');
            var checkinYearSelect = document.getElementById('must-booking-checkin-year');
            var checkoutMonthSelect = document.getElementById('must-booking-checkout-month');
            var checkoutYearSelect = document.getElementById('must-booking-checkout-year');
            if (previousButton) {
                previousButton.addEventListener('click', function () {
                    var floorDate = getMonthFloorDate();
                    var checkinMonthDate = new Date(state.checkinPicker.currentYear, state.checkinPicker.currentMonth, 1);
                    if (checkinMonthDate.getTime() <= floorDate.getTime()) {
                        updateCalendarShiftState();
                        return;
                    }
                    state.checkinPicker.changeMonth(-1);
                    state.checkoutPicker.changeMonth(-1);
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarMeta(state.checkoutPicker, 'must-booking-checkout-month', 'must-booking-checkout-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            if (nextButton) {
                nextButton.addEventListener('click', function () {
                    state.checkinPicker.changeMonth(1);
                    state.checkoutPicker.changeMonth(1);
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarMeta(state.checkoutPicker, 'must-booking-checkout-month', 'must-booking-checkout-year');
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            if (checkinMonthSelect) {
                checkinMonthSelect.addEventListener('change', function () {
                    var month = parseInt(String(checkinMonthSelect.value || '0'), 10);
                    var year = parseInt(String((checkinYearSelect && checkinYearSelect.value) || state.checkinPicker.currentYear), 10);
                    if (!Number.isFinite(month) || month < 0 || month > 11 || !Number.isFinite(year)) {
                        return;
                    }
                    var floorDate = getMonthFloorDate();
                    var target = new Date(year, month, 1);
                    if (target.getTime() < floorDate.getTime()) {
                        target = floorDate;
                    }
                    state.checkinPicker.jumpToDate(target, true);
                    state.checkoutPicker.jumpToDate(new Date(target.getFullYear(), target.getMonth() + 1, 1), true);
                    updateCalendarMeta(state.checkinPicker, 'must-booking-checkin-month', 'must-booking-checkin-year');
                    updateCalendarMeta(state.checkoutPicker, 'must-booking-checkout-month', 'must-booking-checkout-year');
                    updateCalendarShiftState();
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            if (checkinYearSelect) {
                checkinYearSelect.addEventListener('change', function () {
                    if (checkinMonthSelect) {
                        checkinMonthSelect.dispatchEvent(new Event('change'));
                    }
                });
            }
            if (checkoutMonthSelect) {
                checkoutMonthSelect.addEventListener('change', function () {
                    var month = parseInt(String(checkoutMonthSelect.value || '0'), 10);
                    var year = parseInt(String((checkoutYearSelect && checkoutYearSelect.value) || state.checkoutPicker.currentYear), 10);
                    if (!Number.isFinite(month) || month < 0 || month > 11 || !Number.isFinite(year)) {
                        return;
                    }
                    var minDate = parseDateString(checkinInput.value ? addDays(checkinInput.value, 1) : (config.today || ''));
                    var target = new Date(year, month, 1);
                    if (minDate && target.getTime() < new Date(minDate.getFullYear(), minDate.getMonth(), 1).getTime()) {
                        target = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
                    }
                    state.checkoutPicker.jumpToDate(target, true);
                    updateCalendarMeta(state.checkoutPicker, 'must-booking-checkout-month', 'must-booking-checkout-year');
                    refreshUnavailableDayClasses();
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            if (checkoutYearSelect) {
                checkoutYearSelect.addEventListener('change', function () {
                    if (checkoutMonthSelect) {
                        checkoutMonthSelect.dispatchEvent(new Event('change'));
                    }
                });
            }
            if (state.checkoutPicker && state.checkoutPicker.calendarContainer) {
                state.checkoutPicker.calendarContainer.addEventListener('mouseover', function (event) {
                    var target = event.target && event.target.closest ? event.target.closest('.flatpickr-day') : null;
                    if (!target || !target.dateObj) {
                        return;
                    }
                    if (target.classList.contains('flatpickr-disabled') || target.classList.contains('notAllowed')) {
                        return;
                    }
                    if (!checkinInput.value) {
                        return;
                    }
                    var hovered = formatDate(target.dateObj);
                    if (hovered <= String(checkinInput.value || '')) {
                        state.previewCheckout = '';
                        updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                        return;
                    }
                    state.previewCheckout = hovered;
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
                state.checkoutPicker.calendarContainer.addEventListener('mouseleave', function () {
                    state.previewCheckout = '';
                    updateRangeHighlights(checkinInput.value, checkoutInput.value, state.previewCheckout);
                });
            }
            return;
        }
        state.checkoutPicker = window.flatpickr(checkoutInput, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            minDate: checkinInput.value ? addDays(checkinInput.value, 1) : (config.today || 'today'),
            onChange: function () {
                onFieldChange('checkout');
            }
        });
        state.checkinPicker = window.flatpickr(checkinInput, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            minDate: config.today || 'today',
            onChange: function () {
                onFieldChange('checkin');
            }
        });
    }
    function initBookingPage() {
        var form = document.getElementById('must-booking-search-form');
        var checkinInput = document.getElementById('must-booking-checkin');
        var checkoutInput = document.getElementById('must-booking-checkout');
        var guestsInput = document.getElementById('must-booking-guests');
        var guestsSelect = document.getElementById('must-booking-guests-select');
        var roomCountInput = document.getElementById('must-booking-room-count');
        var roomCountSelect = document.getElementById('must-booking-room-count-select');
        var accommodationTypeSelect = document.getElementById('must-booking-accommodation-type');
        var stepBackButton = document.getElementById('must-booking-step-back');
        var stepNextButton = document.getElementById('must-booking-step-next');
        var resultsEl = document.getElementById('must-booking-results');
        var roomListEl = document.getElementById('must-booking-room-list');
        var noRoomsEl = document.getElementById('must-booking-no-rooms-message');
        var loadingEl = document.getElementById('must-booking-loading');
        var messagesEl = document.getElementById('must-booking-live-messages');
        var editDatesButton = document.getElementById('must-booking-results-edit-dates');
        var editSummaryButton = document.getElementById('must-booking-results-edit-summary');
        if (!form || !checkinInput || !checkoutInput || !guestsInput || !roomListEl || !noRoomsEl || !resultsEl) {
            return;
        }
        function setFixedRoomContinueState(nextState) {
            if (!isFixedRoomMode()) {
                return;
            }
            var submitButton = form.querySelector('.must-booking-check-availability');
            if (!submitButton) {
                return;
            }
            var label = submitButton.querySelector('span');
            var strings = config.strings || {};
            var stateName = String(nextState || 'ready');
            var disabled = stateName === 'unavailable';
            submitButton.disabled = disabled;
            submitButton.classList.toggle('is-disabled', disabled);
            submitButton.classList.toggle('is-retry', stateName === 'provider_unconfirmed');
            submitButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            if (label) {
                label.textContent = stateName === 'provider_unconfirmed'
                    ? String(strings.retryAvailability || 'Retry Availability')
                    : (stateName === 'unavailable'
                        ? String(strings.chooseOtherDates || 'Choose Other Dates')
                        : String(strings.continueToGuestInfo || 'Continue to Guest Information'));
            }
        }
        if (config.initial && typeof config.initial === 'object') {
            if (!checkinInput.value && isValidDateString(config.initial.checkin || '')) {
                checkinInput.value = String(config.initial.checkin);
            }
            if (!checkoutInput.value && isValidDateString(config.initial.checkout || '')) {
                checkoutInput.value = String(config.initial.checkout);
            }
            if (!guestsInput.value) {
                guestsInput.value = String(config.initial.guests || 1);
            }
            if (roomCountInput && !roomCountInput.value) {
                roomCountInput.value = String(config.initial.roomCount || 0);
            }
        }
        if (accommodationTypeSelect) {
            accommodationTypeSelect.value = getAccommodationTypeValue(accommodationTypeSelect);
        }
        if (roomCountSelect && roomCountInput) {
            roomCountSelect.value = String(getRoomCountValue(roomCountSelect));
            roomCountInput.value = String(getRoomCountValue(roomCountSelect));
        }
        if (guestsSelect) {
            rebuildGuestsSelectOptions(guestsSelect, guestsInput, accommodationTypeSelect, roomCountSelect);
            guestsInput.value = String(getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountSelect).guests || 1);
        }
        function refreshCalendarState(source) {
            var context = getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountSelect);
            syncHiddenSelectionFields(context);
            updateSummary(context);
            updateResultsSummary(context, accommodationTypeSelect);
            updateRangeHighlights(context.checkin, context.checkout, state.previewCheckout);
            setCurrentStep(1, resultsEl);
            setFixedRoomContinueState('ready');
            if (source === 'checkin' || source === 'guests' || source === 'accommodation_type' || source === 'room_count') {
                fetchDisabledDates(context).finally(function () {
                    var updatedContext = getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountSelect);
                    syncHiddenSelectionFields(updatedContext);
                    updateSummary(updatedContext);
                    updateResultsSummary(updatedContext, accommodationTypeSelect);
                    updateRangeHighlights(updatedContext.checkin, updatedContext.checkout, state.previewCheckout);
                    if (!isCalendarPageMode() && source === 'accommodation_type' && isValidRange(updatedContext)) {
                        setMessage(messagesEl, '', '');
                        setCurrentStep(2, resultsEl);
                        fetchAvailability(updatedContext, roomListEl, noRoomsEl, resultsEl, loadingEl, messagesEl);
                        return;
                    }
                    setCurrentStep(1, resultsEl);
                });
                return;
            }
        }
        function runAvailabilityCheck() {
            var context = getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountSelect);
            syncHiddenSelectionFields(context);
            updateSummary(context);
            updateResultsSummary(context, accommodationTypeSelect);
            updateRangeHighlights(context.checkin, context.checkout, state.previewCheckout);
            if (!isValidRange(context)) {
                setMessage(
                    messagesEl,
                    (config.strings && config.strings.invalidRange) || 'Please select valid dates.',
                    'error'
                );
                setCurrentStep(1, resultsEl);
                return;
            }
            setMessage(messagesEl, '', '');
            if (isCalendarPageMode()) {
                if (isFixedRoomMode()) {
                    fetchAvailability(
                        context,
                        roomListEl,
                        noRoomsEl,
                        resultsEl,
                        loadingEl,
                        messagesEl,
                        { suppressRender: true }
                    ).then(function (rooms) {
                        if (Array.isArray(rooms) && rooms.length > 0) {
                            redirectToCheckout(context);
                            return;
                        }
                        setFixedRoomContinueState(state.lastAvailabilityStatus === 'provider_unconfirmed' ? 'provider_unconfirmed' : 'unavailable');
                        setMessage(
                            messagesEl,
                            state.lastAvailabilityMessage || ((config.strings && config.strings.noRooms) || 'No rooms are available for the selected dates.'),
                            'error'
                        );
                        setCurrentStep(1, resultsEl);
                    });
                    return;
                }
                redirectToAccommodation(context);
                return;
            }
            setCurrentStep(2, resultsEl);
            fetchAvailability(context, roomListEl, noRoomsEl, resultsEl, loadingEl, messagesEl);
        }
        function scheduleRefresh(source) {
            if (state.refreshTimer !== null) {
                window.clearTimeout(state.refreshTimer);
            }
            state.refreshTimer = window.setTimeout(function () {
                refreshCalendarState(source);
            }, 220);
        }
        applyInitialDisabledDatesBeforePickers(checkinInput, checkoutInput);
        initializeDatePickers(checkinInput, checkoutInput, scheduleRefresh);
        var initialContext = getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountSelect);
        var initialStep = isCalendarPageMode() ? 1 : parseInt(String(config.initialStep || '1'), 10);
        syncHiddenSelectionFields(initialContext);
        updateSummary(initialContext);
        updateResultsSummary(initialContext, accommodationTypeSelect);
        updateRangeHighlights(initialContext.checkin, initialContext.checkout, state.previewCheckout);
        setCurrentStep(initialStep > 1 && isValidRange(initialContext) ? 2 : 1, resultsEl);
        if (guestsSelect) {
            guestsSelect.addEventListener('change', function () {
                var guestsValue = parseInt(String(guestsSelect.value || '1'), 10);
                var maxGuests = getMaxGuestsLimit(getAccommodationTypeValue(accommodationTypeSelect), getRoomCountValue(roomCountSelect));
                if (!Number.isFinite(guestsValue) || guestsValue < 1) {
                    guestsValue = 1;
                }
                if (guestsValue > maxGuests) {
                    guestsValue = maxGuests;
                }
                guestsInput.value = String(guestsValue);
                scheduleRefresh('guests');
            });
        } else {
            guestsInput.addEventListener('change', function () {
                scheduleRefresh('guests');
            });
            guestsInput.addEventListener('input', function () {
                scheduleRefresh('guests');
            });
        }
        if (accommodationTypeSelect) {
            accommodationTypeSelect.addEventListener('change', function () {
                if (guestsSelect) {
                    rebuildGuestsSelectOptions(guestsSelect, guestsInput, accommodationTypeSelect, roomCountSelect);
                }
                scheduleRefresh('accommodation_type');
            });
        }
        if (roomCountSelect && roomCountInput) {
            roomCountSelect.addEventListener('change', function () {
                roomCountInput.value = String(getRoomCountValue(roomCountSelect));
                if (guestsSelect) {
                    rebuildGuestsSelectOptions(guestsSelect, guestsInput, accommodationTypeSelect, roomCountSelect);
                }
                scheduleRefresh('room_count');
            });
        }
        [editDatesButton, editSummaryButton].forEach(function (button) {
            if (!button) {
                return;
            }
            button.addEventListener('click', function (event) {
                event.preventDefault();
                setMessage(messagesEl, '', '');
                setCurrentStep(1, resultsEl);
            });
        });
        if (stepBackButton) {
            stepBackButton.addEventListener('click', function (event) {
                event.preventDefault();
                if (state.currentStep <= 1) {
                    window.location.href = getHomeUrl();
                    return;
                }
                setMessage(messagesEl, '', '');
                setCurrentStep(state.currentStep - 1, resultsEl);
            });
        }
        if (stepNextButton) {
            stepNextButton.addEventListener('click', function (event) {
                event.preventDefault();
                if (state.currentStep > 1) {
                    return;
                }
                if (guestsSelect) {
                    guestsInput.value = String(guestsSelect.value || guestsInput.value || '1');
                }
                var context = getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountSelect);
                if (!isValidRange(context)) {
                    setMessage(
                        messagesEl,
                        (config.strings && config.strings.invalidRange) || 'Please select valid dates.',
                        'error'
                    );
                    setCurrentStep(1, resultsEl);
                    return;
                }
                runAvailabilityCheck();
            });
        }
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            if (guestsSelect) {
                guestsInput.value = String(guestsSelect.value || guestsInput.value || '1');
            }
            runAvailabilityCheck();
        });
        fetchDisabledDates(initialContext).finally(function () {
            var contextAfterLoad = getContext(checkinInput, checkoutInput, guestsInput, accommodationTypeSelect, roomCountSelect);
            syncHiddenSelectionFields(contextAfterLoad);
            updateSummary(contextAfterLoad);
            updateResultsSummary(contextAfterLoad, accommodationTypeSelect);
            updateRangeHighlights(contextAfterLoad.checkin, contextAfterLoad.checkout, state.previewCheckout);
            if (!isCalendarPageMode() && initialStep > 1 && isValidRange(contextAfterLoad)) {
                setCurrentStep(2, resultsEl);
                if (roomListEl.children.length === 0 || roomListEl.querySelector('.must-hotel-booking-room-card') === null) {
                    fetchAvailability(contextAfterLoad, roomListEl, noRoomsEl, resultsEl, loadingEl, messagesEl);
                }
                return;
            }
            setCurrentStep(1, resultsEl);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBookingPage);
    } else {
        initBookingPage();
    }
})();
