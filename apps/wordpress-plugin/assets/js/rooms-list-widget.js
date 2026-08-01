(function () {
    'use strict';

    var rootReadyFlag = 'mustHotelBookingRoomsLightboxReady';
    var triggerSelector = '.must-hotel-booking-rooms-list-image-trigger';
    var cardSelector = '.must-hotel-booking-rooms-list-card';

    var lightbox = null;
    var imageNode = null;
    var captionNode = null;
    var closeNode = null;
    var prevNode = null;
    var nextNode = null;
    var isOpen = false;
    var currentImages = [];
    var currentIndex = 0;
    var currentTitle = '';
    var lastFocusedNode = null;

    function getWidgetConfig() {
        var config = window.mustBookingRoomsListWidgetConfig || {};

        if (!config.icons) {
            config.icons = {};
        }

        return config;
    }

    function escapeHtmlAttribute(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function getLightboxArrowMarkup(url, fallbackCharacter) {
        if (typeof url !== 'string' || url === '') {
            return fallbackCharacter;
        }

        return '<img class="must-hotel-booking-lightbox-nav-icon" src="' + escapeHtmlAttribute(url) + '" alt="" aria-hidden="true" />';
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function parseImages(rawValue) {
        if (!rawValue) {
            return [];
        }

        try {
            var parsed = JSON.parse(rawValue);

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

    function buildCaption() {
        if (!captionNode) {
            return;
        }

        var position = String(currentIndex + 1) + '/' + String(currentImages.length);

        if (currentTitle) {
            captionNode.textContent = currentTitle + ' (' + position + ')';
            return;
        }

        captionNode.textContent = position;
    }

    function setNavState() {
        var hasMultiple = currentImages.length > 1;

        if (prevNode) {
            prevNode.hidden = !hasMultiple;
            prevNode.disabled = !hasMultiple;
        }

        if (nextNode) {
            nextNode.hidden = !hasMultiple;
            nextNode.disabled = !hasMultiple;
        }
    }

    function showImage(index) {
        if (!imageNode || currentImages.length === 0) {
            return;
        }

        currentIndex = clamp(index, 0, currentImages.length - 1);
        imageNode.src = currentImages[currentIndex];
        imageNode.alt = currentTitle || 'Room image';
        buildCaption();
        setNavState();
    }

    function closeLightbox() {
        if (!lightbox || !isOpen) {
            return;
        }

        isOpen = false;
        lightbox.classList.remove('is-open');
        lightbox.hidden = true;
        lightbox.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('must-hotel-booking-lightbox-open');

        if (imageNode) {
            imageNode.removeAttribute('src');
        }

        if (lastFocusedNode && typeof lastFocusedNode.focus === 'function') {
            lastFocusedNode.focus();
        }
    }

    function openLightbox() {
        if (!lightbox || currentImages.length === 0) {
            return;
        }

        isOpen = true;
        lightbox.hidden = false;
        lightbox.classList.add('is-open');
        lightbox.setAttribute('aria-hidden', 'false');
        document.body.classList.add('must-hotel-booking-lightbox-open');

        if (closeNode && typeof closeNode.focus === 'function') {
            closeNode.focus();
        }
    }

    function showPreviousImage() {
        if (currentImages.length < 2) {
            return;
        }

        var previousIndex = currentIndex - 1;

        if (previousIndex < 0) {
            previousIndex = currentImages.length - 1;
        }

        showImage(previousIndex);
    }

    function showNextImage() {
        if (currentImages.length < 2) {
            return;
        }

        var nextIndex = currentIndex + 1;

        if (nextIndex > currentImages.length - 1) {
            nextIndex = 0;
        }

        showImage(nextIndex);
    }

    function buildLightbox() {
        if (lightbox) {
            return;
        }

        var config = getWidgetConfig();
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

        imageNode = lightbox.querySelector('.must-hotel-booking-lightbox-image');
        captionNode = lightbox.querySelector('.must-hotel-booking-lightbox-caption');
        closeNode = lightbox.querySelector('.must-hotel-booking-lightbox-close');
        prevNode = lightbox.querySelector('.must-hotel-booking-lightbox-prev');
        nextNode = lightbox.querySelector('.must-hotel-booking-lightbox-next');

        lightbox.addEventListener('click', function (event) {
            var target = event.target;

            if (!(target instanceof HTMLElement)) {
                return;
            }

            if (target.dataset.lightboxClose === '1') {
                closeLightbox();
            }
        });

        if (closeNode) {
            closeNode.addEventListener('click', function () {
                closeLightbox();
            });
        }

        if (prevNode) {
            prevNode.addEventListener('click', function () {
                showPreviousImage();
            });
        }

        if (nextNode) {
            nextNode.addEventListener('click', function () {
                showNextImage();
            });
        }
    }

    function openFromTrigger(triggerNode) {
        if (!(triggerNode instanceof HTMLElement)) {
            return;
        }

        var cardNode = triggerNode.closest(cardSelector);

        if (!cardNode) {
            return;
        }

        var images = parseImages(cardNode.getAttribute('data-lightbox-images'));

        if (images.length === 0) {
            return;
        }

        var index = parseInt(String(triggerNode.getAttribute('data-lightbox-index') || '0'), 10);

        if (!Number.isFinite(index)) {
            index = 0;
        }

        currentImages = images;
        currentTitle = String(cardNode.getAttribute('data-lightbox-title') || '');
        currentIndex = clamp(index, 0, currentImages.length - 1);
        lastFocusedNode = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        buildLightbox();
        openLightbox();
        showImage(currentIndex);
    }

    function onDocumentClick(event) {
        var target = event.target;

        if (!(target instanceof HTMLElement)) {
            return;
        }

        var triggerNode = target.closest(triggerSelector);

        if (!triggerNode) {
            return;
        }

        event.preventDefault();
        openFromTrigger(triggerNode);
    }

    function onDocumentKeyDown(event) {
        if (!isOpen) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeLightbox();
            return;
        }

        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showPreviousImage();
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            showNextImage();
        }
    }

    function initializeLightbox() {
        if (!document || !document.body || document.body.dataset[rootReadyFlag] === '1') {
            return;
        }

        document.body.dataset[rootReadyFlag] = '1';
        document.addEventListener('click', onDocumentClick);
        document.addEventListener('keydown', onDocumentKeyDown);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeLightbox);
    } else {
        initializeLightbox();
    }
})();
