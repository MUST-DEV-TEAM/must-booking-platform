(function () {
    'use strict';

    var cardSelector = '.must-booking-accommodation-room-card';
    var lightboxTriggerSelector = '.must-booking-room-image-trigger';
    var modalTriggerSelector = '.must-booking-room-modal-trigger';
    var filterToggleSelector = '.must-booking-results-filter[data-filter-target]';
    var selectionFormSelector = '.must-hotel-booking-select-room-form';

    var lightbox = null;
    var lightboxImageNode = null;
    var lightboxCaptionNode = null;
    var lightboxCloseNode = null;
    var lightboxPrevNode = null;
    var lightboxNextNode = null;
    var lightboxImages = [];
    var lightboxIndex = 0;
    var lightboxTitle = '';
    var lightboxOpen = false;
    var lightboxLastFocused = null;
    var selectionRequestInFlight = false;
    var activeInlineDetailsId = '';

    function getAccommodationConfig() {
        var config = window.mustBookingAccommodationConfig || {};

        if (!config.labels) {
            config.labels = {};
        }

        if (!config.icons) {
            config.icons = {};
        }

        return config;
    }

    var config = getAccommodationConfig();

    function escapeHtmlAttribute(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

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
        var windowDays = parseInt(String(config.bookingWindowDays || '365'), 10);

        if (!Number.isFinite(windowDays) || windowDays < 1) {
            windowDays = 365;
        }

        return addDays(todayYmd, windowDays);
    }

    function buildPopupPickerOptions(todayYmd, maxDateYmd) {
        return {
            dateFormat: String(config.queryDateFormat || 'Y-m-d'),
            altInput: true,
            altFormat: String(config.displayDateFormat || 'd/m/Y'),
            allowInput: false,
            clickOpens: true,
            position: 'auto left',
            monthSelectorType: 'dropdown',
            disableMobile: true,
            minDate: todayYmd,
            maxDate: maxDateYmd,
            onReady: function (selectedDates, dateStr, instance) {
                if (!instance || !instance.altInput) {
                    return;
                }

                instance.altInput.setAttribute('autocomplete', 'off');
                instance.altInput.setAttribute('inputmode', 'none');

                if (instance.input && instance.input.getAttribute('placeholder')) {
                    instance.altInput.setAttribute('placeholder', instance.input.getAttribute('placeholder'));
                }
            }
        };
    }

    function getLightboxArrowMarkup(url, fallbackCharacter) {
        if (typeof url !== 'string' || url === '') {
            return fallbackCharacter;
        }

        return '<img class="must-hotel-booking-lightbox-nav-icon" src="' + escapeHtmlAttribute(url) + '" alt="" aria-hidden="true" />';
    }

    function renderLiveMessages(messages) {
        var messagesNode = document.getElementById('must-booking-live-messages');
        var hasRenderedMessage = false;

        if (!messagesNode) {
            return;
        }

        messagesNode.innerHTML = '';

        if (!Array.isArray(messages) || !messages.length) {
            messagesNode.hidden = true;
            return;
        }

        messages.forEach(function (message) {
            if (typeof message !== 'string' || message === '') {
                return;
            }

            var paragraph = document.createElement('p');
            paragraph.textContent = message;
            messagesNode.appendChild(paragraph);
            hasRenderedMessage = true;
        });

        messagesNode.hidden = !hasRenderedMessage;
    }

    function getArrowIconClone() {
        var reference = document.querySelector(
            '#must-booking-stepper-next img, .must-booking-results-continue img, .must-booking-room-book-button img'
        );

        if (!(reference instanceof HTMLImageElement)) {
            return null;
        }

        var clone = reference.cloneNode(true);

        if (clone instanceof HTMLImageElement) {
            clone.hidden = false;
            return clone;
        }

        return null;
    }

    function syncResultsContinue(state) {
        var slot = document.getElementById('must-booking-results-continue-slot');

        if (!slot) {
            return;
        }

        slot.innerHTML = '';

        if (!state || !state.can_continue || !state.checkout_url) {
            return;
        }

        var link = document.createElement('a');
        var label = document.createElement('span');
        var arrow = getArrowIconClone();

        link.className = 'must-booking-results-continue';
        link.href = String(state.checkout_url);
        label.textContent = String(state.continue_label || '');
        link.appendChild(label);

        if (arrow) {
            link.appendChild(arrow);
        }

        slot.appendChild(link);
    }

    function syncSelectionStatus(state) {
        var note = document.getElementById('must-booking-results-selection-note');
        var tone = state && typeof state.selection_status_tone === 'string' ? state.selection_status_tone : 'neutral';
        var message = state && typeof state.selection_status_message === 'string' ? state.selection_status_message : '';

        if (!note) {
            return;
        }

        note.classList.remove('is-hidden', 'is-neutral', 'is-success', 'is-warning');

        if (message === '') {
            note.textContent = '';
            note.classList.add('is-hidden');
            return;
        }

        note.textContent = message;
        note.classList.add('is-' + tone);
    }

    function syncStepperNext(state) {
        var nextLink = document.getElementById('must-booking-stepper-next');

        if (!(nextLink instanceof HTMLAnchorElement)) {
            return;
        }

        if (state && state.can_continue && state.checkout_url) {
            nextLink.href = String(state.checkout_url);
            nextLink.classList.remove('is-disabled');
            nextLink.setAttribute('aria-disabled', 'false');
            nextLink.removeAttribute('tabindex');
            return;
        }

        nextLink.href = '#';
        nextLink.classList.add('is-disabled');
        nextLink.setAttribute('aria-disabled', 'true');
        nextLink.setAttribute('tabindex', '-1');
    }

    function syncRoomSelectionState(state) {
        var config = getAccommodationConfig();
        var labels = config.labels || {};
        var selectedRoomIds = Array.isArray(state && state.selected_room_ids) ? state.selected_room_ids.map(function (value) {
            return String(value);
        }) : [];
        var selectedRatePlans = state && state.selected_room_rate_plans && typeof state.selected_room_rate_plans === 'object'
            ? state.selected_room_rate_plans
            : {};
        var selectedRoomMap = {};

        selectedRoomIds.forEach(function (roomId) {
            selectedRoomMap[roomId] = true;
        });

        document.querySelectorAll(selectionFormSelector).forEach(function (form) {
            if (!(form instanceof HTMLFormElement)) {
                return;
            }

            var roomId = String(form.getAttribute('data-room-id') || '');
            var ratePlanId = String(form.getAttribute('data-rate-plan-id') || '0');
            var selectedRatePlanId = Object.prototype.hasOwnProperty.call(selectedRatePlans, roomId)
                ? String(selectedRatePlans[roomId])
                : '';
            var roomIsSelected = !!selectedRoomMap[roomId];
            var hasRatePlanRow = !!form.closest('.must-booking-room-rate-plan');
            var isSelected = roomIsSelected && (!hasRatePlanRow || selectedRatePlanId === ratePlanId);
            var isSwitchingRate = roomIsSelected && !isSelected;
            var actionInput = form.querySelector('input[name="must_accommodation_action"]');
            var nonceInput = form.querySelector('input[name="must_accommodation_nonce"]');
            var button = form.querySelector('.must-booking-room-book-button');
            var label = button ? button.querySelector('span') : null;
            var icon = button ? button.querySelector('img') : null;
            var card = form.closest(cardSelector);
            var ratePlanRow = form.closest('.must-booking-room-rate-plan');
            var buttonLabel = '';
            var buttonDisabled = false;
            var showArrow = false;

            if (!(actionInput instanceof HTMLInputElement) || !(nonceInput instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
                return;
            }

            if (isSelected) {
                actionInput.value = 'remove_selected_room';
                nonceInput.value = String(form.getAttribute('data-remove-nonce') || '');
                buttonLabel = String(labels.removeSelection || labels.removeRoom || 'Remove Selection');
                buttonDisabled = false;
                showArrow = false;
            } else {
                actionInput.value = 'select_room';
                nonceInput.value = String(form.getAttribute('data-select-nonce') || '');
                buttonLabel = isSwitchingRate
                    ? String(labels.chooseRate || 'Choose This Rate')
                    : (state && state.single_room_mode
                        ? String(labels.bookNow || 'Book Now')
                        : (state && state.selection_limit_reached
                            ? String(labels.selectionFull || 'Selection Full')
                            : String(labels.addRoom || 'Add Room')));
                buttonDisabled = !!(state && !state.single_room_mode && state.selection_limit_reached && !roomIsSelected);
                showArrow = !buttonDisabled;
            }

            if (label) {
                label.textContent = buttonLabel;
            }

            if (icon instanceof HTMLImageElement) {
                icon.hidden = !showArrow;
            }

            button.disabled = buttonDisabled;
            button.classList.toggle('is-selected', isSelected);

            if (card) {
                card.classList.toggle('is-selected', roomIsSelected);
            }

            if (ratePlanRow) {
                ratePlanRow.classList.toggle('is-selected', isSelected);
            }
        });
    }

    function submitSelectionForm(form) {
        var config = getAccommodationConfig();
        var formData;

        if (!(form instanceof HTMLFormElement) || !window.fetch || !config.ajaxUrl || !config.ajaxAction) {
            form.submit();
            return;
        }

        if (selectionRequestInFlight) {
            return;
        }

        selectionRequestInFlight = true;
        formData = new FormData(form);
        formData.append('action', String(config.ajaxAction));

        fetch(String(config.ajaxUrl), {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
        })
            .then(function (response) {
                return response.json().catch(function () {
                    return { success: false, data: {} };
                }).then(function (payload) {
                    return {
                        ok: response.ok,
                        payload: payload
                    };
                });
            })
            .then(function (result) {
                var payload = result && result.payload ? result.payload : {};
                var state = payload && payload.data ? payload.data : {};

                renderLiveMessages(Array.isArray(state.messages) ? state.messages : []);

                if (payload.success && state.redirect_url) {
                    window.location.href = String(state.redirect_url);
                    return;
                }

                if (state && Object.prototype.hasOwnProperty.call(state, 'selected_room_ids')) {
                    syncRoomSelectionState(state);
                    syncResultsContinue(state);
                    syncSelectionStatus(state);
                    syncStepperNext(state);
                }

                if (!result.ok || !payload.success) {
                    if (!Array.isArray(state.messages) || !state.messages.length) {
                        renderLiveMessages([String(config.labels.requestFailed || 'Unable to update your room selection right now. Please try again.')]);
                    }
                }
            })
            .catch(function () {
                renderLiveMessages([String(config.labels.requestFailed || 'Unable to update your room selection right now. Please try again.')]);
            })
            .finally(function () {
                selectionRequestInFlight = false;
            });
    }

    function parseImages(value) {
        if (!value) {
            return [];
        }

        try {
            var parsed = JSON.parse(value);

            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.filter(function (item) {
                return typeof item === 'string' && item !== '';
            });
        } catch (error) {
            return [];
        }
    }

    function updateLightboxCaption() {
        if (!lightboxCaptionNode) {
            return;
        }

        var position = String(lightboxIndex + 1) + '/' + String(lightboxImages.length);

        if (lightboxTitle) {
            lightboxCaptionNode.textContent = lightboxTitle + ' (' + position + ')';
            return;
        }

        lightboxCaptionNode.textContent = position;
    }

    function updateLightboxNav() {
        var hasMultiple = lightboxImages.length > 1;

        if (lightboxPrevNode) {
            lightboxPrevNode.hidden = !hasMultiple;
            lightboxPrevNode.disabled = !hasMultiple;
        }

        if (lightboxNextNode) {
            lightboxNextNode.hidden = !hasMultiple;
            lightboxNextNode.disabled = !hasMultiple;
        }
    }

    function showLightboxImage(index) {
        if (!lightboxImageNode || lightboxImages.length === 0) {
            return;
        }

        if (index < 0) {
            index = lightboxImages.length - 1;
        }

        if (index > lightboxImages.length - 1) {
            index = 0;
        }

        lightboxIndex = index;
        lightboxImageNode.src = lightboxImages[lightboxIndex];
        lightboxImageNode.alt = lightboxTitle || 'Room image';
        updateLightboxCaption();
        updateLightboxNav();
    }

    function closeLightbox() {
        if (!lightbox || !lightboxOpen) {
            return;
        }

        lightboxOpen = false;
        lightbox.hidden = true;
        lightbox.classList.remove('is-open');
        lightbox.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('must-hotel-booking-lightbox-open');

        if (lightboxImageNode) {
            lightboxImageNode.removeAttribute('src');
        }

        if (lightboxLastFocused && typeof lightboxLastFocused.focus === 'function') {
            lightboxLastFocused.focus();
        }
    }

    function openLightbox(images, startIndex, title) {
        if (!Array.isArray(images) || images.length === 0) {
            return;
        }

        buildLightbox();
        lightboxImages = images;
        lightboxTitle = title || '';
        lightboxIndex = Number.isFinite(startIndex) ? startIndex : 0;
        lightboxLastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        lightboxOpen = true;
        lightbox.hidden = false;
        lightbox.classList.add('is-open');
        lightbox.setAttribute('aria-hidden', 'false');
        document.body.classList.add('must-hotel-booking-lightbox-open');
        showLightboxImage(lightboxIndex);

        if (lightboxCloseNode) {
            lightboxCloseNode.focus();
        }
    }

    function buildLightbox() {
        if (lightbox) {
            return;
        }

        var config = getAccommodationConfig();
        var prevIconMarkup = getLightboxArrowMarkup(config.icons.lightboxPrev, '&#10094;');
        var nextIconMarkup = getLightboxArrowMarkup(config.icons.lightboxNext, '&#10095;');

        lightbox = document.createElement('div');
        lightbox.className = 'must-hotel-booking-lightbox';
        lightbox.hidden = true;
        lightbox.setAttribute('aria-hidden', 'true');
        lightbox.setAttribute('role', 'dialog');
        lightbox.setAttribute('aria-modal', 'true');
        lightbox.innerHTML =
            '<div class="must-hotel-booking-lightbox-backdrop" data-lightbox-close="1"></div>' +
            '<div class="must-hotel-booking-lightbox-dialog" role="document">' +
            '<button type="button" class="must-hotel-booking-lightbox-close" aria-label="Close image preview">&times;</button>' +
            '<button type="button" class="must-hotel-booking-lightbox-nav must-hotel-booking-lightbox-prev" aria-label="Previous image">' + prevIconMarkup + '</button>' +
            '<figure class="must-hotel-booking-lightbox-figure">' +
            '<img class="must-hotel-booking-lightbox-image" src="" alt="" />' +
            '<figcaption class="must-hotel-booking-lightbox-caption"></figcaption>' +
            '</figure>' +
            '<button type="button" class="must-hotel-booking-lightbox-nav must-hotel-booking-lightbox-next" aria-label="Next image">' + nextIconMarkup + '</button>' +
            '</div>';

        document.body.appendChild(lightbox);

        lightboxImageNode = lightbox.querySelector('.must-hotel-booking-lightbox-image');
        lightboxCaptionNode = lightbox.querySelector('.must-hotel-booking-lightbox-caption');
        lightboxCloseNode = lightbox.querySelector('.must-hotel-booking-lightbox-close');
        lightboxPrevNode = lightbox.querySelector('.must-hotel-booking-lightbox-prev');
        lightboxNextNode = lightbox.querySelector('.must-hotel-booking-lightbox-next');

        lightbox.addEventListener('click', function (event) {
            var target = event.target;

            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (target.dataset.lightboxClose === '1') {
                closeLightbox();
            }
        });

        if (lightboxCloseNode) {
            lightboxCloseNode.addEventListener('click', closeLightbox);
        }

        if (lightboxPrevNode) {
            lightboxPrevNode.addEventListener('click', function () {
                showLightboxImage(lightboxIndex - 1);
            });
        }

        if (lightboxNextNode) {
            lightboxNextNode.addEventListener('click', function () {
                showLightboxImage(lightboxIndex + 1);
            });
        }
    }

    function closeInlineDetails(exceptId) {
        document.querySelectorAll('.must-booking-room-inline-details').forEach(function (detailsNode) {
            if (!(detailsNode instanceof HTMLElement)) {
                return;
            }

            var shouldStayOpen = exceptId !== '' && detailsNode.id === exceptId;

            detailsNode.hidden = !shouldStayOpen;
            detailsNode.classList.toggle('is-open', shouldStayOpen);
        });

        document.querySelectorAll(modalTriggerSelector).forEach(function (triggerNode) {
            if (!(triggerNode instanceof HTMLElement)) {
                return;
            }

            var controlsId = String(triggerNode.getAttribute('data-room-inline-details-id') || '');
            var isExpanded = exceptId !== '' && controlsId === exceptId;
            triggerNode.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            triggerNode.classList.toggle('is-expanded', isExpanded);
        });

        activeInlineDetailsId = exceptId || '';
    }

    function toggleInlineDetailsFromTrigger(triggerNode) {
        if (!(triggerNode instanceof HTMLElement)) {
            return;
        }

        var detailsId = String(triggerNode.getAttribute('data-room-inline-details-id') || '');

        if (detailsId === '') {
            return;
        }

        var detailsNode = document.getElementById(detailsId);

        if (!(detailsNode instanceof HTMLElement)) {
            return;
        }

        if (activeInlineDetailsId === detailsId && !detailsNode.hidden) {
            closeInlineDetails('');
            return;
        }

        closeInlineDetails(detailsId);
    }

    function onDocumentClick(event) {
        var target = event.target;

        if (!(target instanceof HTMLElement)) {
            return;
        }

        var inlineDetailsCloseNode = target.closest('[data-room-inline-details-close="1"]');

        if (inlineDetailsCloseNode) {
            var inlineDetailsNode = inlineDetailsCloseNode.closest('.must-booking-room-inline-details');
            var inlineDetailsId = inlineDetailsNode instanceof HTMLElement ? inlineDetailsNode.id : '';

            event.preventDefault();
            closeInlineDetails('');

            if (inlineDetailsId !== '') {
                var triggerNode = document.querySelector('[data-room-inline-details-id="' + inlineDetailsId + '"]');

                if (triggerNode instanceof HTMLElement) {
                    triggerNode.focus();
                }
            }

            return;
        }

        var lightboxTriggerNode = target.closest(lightboxTriggerSelector);

        if (lightboxTriggerNode) {
            var cardNode = lightboxTriggerNode.closest(cardSelector);

            if (!cardNode) {
                return;
            }

            var images = parseImages(cardNode.getAttribute('data-lightbox-images'));

            if (images.length === 0) {
                return;
            }

            var index = parseInt(String(lightboxTriggerNode.getAttribute('data-lightbox-index') || '0'), 10);

            if (!Number.isFinite(index)) {
                index = 0;
            }

            event.preventDefault();
            openLightbox(images, index, String(cardNode.getAttribute('data-lightbox-title') || ''));
            return;
        }

        var modalTriggerNode = target.closest(modalTriggerSelector);

        if (modalTriggerNode) {
            event.preventDefault();
            toggleInlineDetailsFromTrigger(modalTriggerNode);
            return;
        }

        var disabledStepperNext = target.closest('#must-booking-stepper-next.is-disabled');

        if (disabledStepperNext) {
            event.preventDefault();
        }
    }

    function closeAccommodationFilterPanels(exceptId) {
        document.querySelectorAll(filterToggleSelector).forEach(function (toggle) {
            var targetId = String(toggle.getAttribute('data-filter-target') || '');
            var panel = targetId !== '' ? document.getElementById(targetId) : null;
            var isOpen = targetId !== '' && targetId === exceptId;

            toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

            if (panel) {
                panel.hidden = !isOpen;
                panel.classList.toggle('is-open', isOpen);
            }
        });
    }

    function initAccommodationFilters() {
        var toggles = document.querySelectorAll(filterToggleSelector);

        if (!toggles.length) {
            return;
        }

        toggles.forEach(function (toggle) {
            toggle.addEventListener('click', function (event) {
                event.preventDefault();

                var targetId = String(toggle.getAttribute('data-filter-target') || '');
                var panel = targetId !== '' ? document.getElementById(targetId) : null;
                var shouldOpen = panel ? panel.hidden : false;

                closeAccommodationFilterPanels(shouldOpen ? targetId : '');
            });
        });
    }

    function initAccommodationDatePickers() {
        var datesPanel = document.getElementById('must-booking-accommodation-dates-panel');
        var checkinInput;
        var checkoutInput;
        var todayYmd;
        var maxDateYmd;
        var commonOptions;
        var checkoutPicker;

        if (!datesPanel || typeof window.flatpickr !== 'function') {
            return;
        }

        checkinInput = datesPanel.querySelector('.must-booking-results-filter-checkin');
        checkoutInput = datesPanel.querySelector('.must-booking-results-filter-checkout');

        if (!(checkinInput instanceof HTMLInputElement) || !(checkoutInput instanceof HTMLInputElement)) {
            return;
        }

        if (checkinInput.dataset.mustFlatpickrReady === '1' || checkoutInput.dataset.mustFlatpickrReady === '1') {
            return;
        }

        todayYmd = getTodayYmd();
        maxDateYmd = getMaxDateYmd(todayYmd);
        commonOptions = buildPopupPickerOptions(todayYmd, maxDateYmd);

        checkoutPicker = window.flatpickr(checkoutInput, Object.assign({}, commonOptions, {
            minDate: isValidYmd(checkinInput.value) ? addDays(checkinInput.value, 1) : addDays(todayYmd, 1)
        }));

        window.flatpickr(checkinInput, Object.assign({}, commonOptions, {
            onChange: function (selectedDates, checkinValue) {
                if (!checkoutPicker) {
                    return;
                }

                if (!selectedDates || !selectedDates.length || !isValidYmd(checkinValue)) {
                    checkoutPicker.set('minDate', addDays(todayYmd, 1));
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

        checkinInput.dataset.mustFlatpickrReady = '1';
        checkoutInput.dataset.mustFlatpickrReady = '1';
    }

    function initSelectionForms() {
        document.addEventListener('submit', function (event) {
            var target = event.target;

            if (!(target instanceof HTMLFormElement) || !target.matches(selectionFormSelector)) {
                return;
            }

            event.preventDefault();
            submitSelectionForm(target);
        });
    }

    function onDocumentKeyDown(event) {
        if (!lightboxOpen) {
            if (event.key === 'Escape' && activeInlineDetailsId !== '') {
                event.preventDefault();
                closeInlineDetails('');
            }

            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeLightbox();
            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showLightboxImage(lightboxIndex - 1);
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            showLightboxImage(lightboxIndex + 1);
        }
    }

    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeyDown);
    initAccommodationDatePickers();
    initAccommodationFilters();
    initSelectionForms();
})();
