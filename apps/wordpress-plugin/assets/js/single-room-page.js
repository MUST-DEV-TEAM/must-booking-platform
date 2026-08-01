(function () {
    'use strict';

    var mediaSelector = '.must-hotel-booking-single-room-media';
    var triggerSelector = '.must-hotel-booking-single-room-main-image-trigger, .must-hotel-booking-single-room-thumb-button';
    var relatedCardSelector = '.must-hotel-booking-related-room-card';
    var lightbox = null;
    var imageNode = null;
    var captionNode = null;
    var closeNode = null;
    var prevNode = null;
    var nextNode = null;
    var currentImages = [];
    var currentTitle = '';
    var currentIndex = 0;
    var isOpen = false;

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

    function updateCaption() {
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

    function updateButtons() {
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

        if (index < 0) {
            index = currentImages.length - 1;
        }

        if (index > currentImages.length - 1) {
            index = 0;
        }

        currentIndex = index;
        imageNode.src = currentImages[currentIndex];
        imageNode.alt = currentTitle || 'Room image';
        updateCaption();
        updateButtons();
    }

    function closeLightbox() {
        if (!lightbox || !isOpen) {
            return;
        }

        isOpen = false;
        lightbox.hidden = true;
        lightbox.classList.remove('is-open');
        document.body.classList.remove('must-hotel-booking-single-room-lightbox-open');

        if (imageNode) {
            imageNode.removeAttribute('src');
        }
    }

    function openLightbox(images, startIndex, title) {
        if (!lightbox || !Array.isArray(images) || images.length === 0) {
            return;
        }

        currentImages = images;
        currentTitle = title || '';
        currentIndex = Number.isFinite(startIndex) ? startIndex : 0;
        isOpen = true;

        lightbox.hidden = false;
        lightbox.classList.add('is-open');
        document.body.classList.add('must-hotel-booking-single-room-lightbox-open');
        showImage(currentIndex);

        if (closeNode) {
            closeNode.focus();
        }
    }

    function buildLightbox() {
        if (lightbox) {
            return;
        }

        lightbox = document.createElement('div');
        lightbox.className = 'must-hotel-booking-single-room-lightbox';
        lightbox.hidden = true;
        lightbox.innerHTML =
            '<div class="must-hotel-booking-single-room-lightbox-backdrop" data-lightbox-close="1"></div>' +
            '<div class="must-hotel-booking-single-room-lightbox-dialog" role="dialog" aria-modal="true">' +
            '<button type="button" class="must-hotel-booking-single-room-lightbox-close" aria-label="Close image preview">&times;</button>' +
            '<button type="button" class="must-hotel-booking-single-room-lightbox-nav must-hotel-booking-single-room-lightbox-prev" aria-label="Previous image">&#10094;</button>' +
            '<figure class="must-hotel-booking-single-room-lightbox-figure">' +
            '<img class="must-hotel-booking-single-room-lightbox-image" src="" alt="" />' +
            '<figcaption class="must-hotel-booking-single-room-lightbox-caption"></figcaption>' +
            '</figure>' +
            '<button type="button" class="must-hotel-booking-single-room-lightbox-nav must-hotel-booking-single-room-lightbox-next" aria-label="Next image">&#10095;</button>' +
            '</div>';

        document.body.appendChild(lightbox);

        imageNode = lightbox.querySelector('.must-hotel-booking-single-room-lightbox-image');
        captionNode = lightbox.querySelector('.must-hotel-booking-single-room-lightbox-caption');
        closeNode = lightbox.querySelector('.must-hotel-booking-single-room-lightbox-close');
        prevNode = lightbox.querySelector('.must-hotel-booking-single-room-lightbox-prev');
        nextNode = lightbox.querySelector('.must-hotel-booking-single-room-lightbox-next');

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
            closeNode.addEventListener('click', closeLightbox);
        }

        if (prevNode) {
            prevNode.addEventListener('click', function () {
                showImage(currentIndex - 1);
            });
        }

        if (nextNode) {
            nextNode.addEventListener('click', function () {
                showImage(currentIndex + 1);
            });
        }
    }

    function initializeSingleRoomLightbox(root) {
        var scope = root || document;
        var media = scope.querySelector(mediaSelector);

        if (!media || media.dataset.mustLightboxReady === '1') {
            return;
        }

        media.dataset.mustLightboxReady = '1';
        buildLightbox();

        media.addEventListener('click', function (event) {
            var target = event.target;

            if (!(target instanceof HTMLElement)) {
                return;
            }

            var trigger = target.closest(triggerSelector);

            if (!trigger) {
                return;
            }

            var images = parseImages(media.getAttribute('data-lightbox-images'));

            if (images.length === 0) {
                return;
            }

            var index = parseInt(String(trigger.getAttribute('data-lightbox-index') || '0'), 10);

            if (!Number.isFinite(index)) {
                index = 0;
            }

            event.preventDefault();
            openLightbox(images, index, String(media.getAttribute('data-lightbox-title') || ''));
        });
    }

    function initializeRelatedRoomCard(card) {
        if (!card || card.dataset.mustRelatedReady === '1') {
            return;
        }

        var images = parseImages(card.getAttribute('data-related-room-images'));
        var imageNode = card.querySelector('.must-hotel-booking-related-room-image');
        var imageTriggerNode = card.querySelector('.must-hotel-booking-related-room-image-trigger');
        var prevButton = card.querySelector('.must-hotel-booking-related-room-arrow-prev');
        var nextButton = card.querySelector('.must-hotel-booking-related-room-arrow-next');
        var relatedTitle = String(card.getAttribute('data-related-room-title') || '');

        if (!imageNode || images.length === 0) {
            card.dataset.mustRelatedReady = '1';
            return;
        }

        var currentIndex = 0;

        function setImage(index) {
            if (images.length === 0) {
                return;
            }

            if (index < 0) {
                index = images.length - 1;
            }

            if (index > images.length - 1) {
                index = 0;
            }

            currentIndex = index;
            imageNode.src = images[currentIndex];
        }

        if (prevButton) {
            prevButton.addEventListener('click', function (event) {
                event.preventDefault();
                setImage(currentIndex - 1);
            });
        }

        if (nextButton) {
            nextButton.addEventListener('click', function (event) {
                event.preventDefault();
                setImage(currentIndex + 1);
            });
        }

        if (imageTriggerNode) {
            imageTriggerNode.addEventListener('click', function (event) {
                event.preventDefault();
                buildLightbox();
                openLightbox(images, currentIndex, relatedTitle);
            });
        }

        card.dataset.mustRelatedReady = '1';
    }

    function initializeRelatedRooms(root) {
        var scope = root || document;
        var cards = scope.querySelectorAll(relatedCardSelector);

        cards.forEach(function (card) {
            initializeRelatedRoomCard(card);
        });
    }

    document.addEventListener('keydown', function (event) {
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
            showImage(currentIndex - 1);
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            showImage(currentIndex + 1);
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initializeSingleRoomLightbox(document);
            initializeRelatedRooms(document);
        });
    } else {
        initializeSingleRoomLightbox(document);
        initializeRelatedRooms(document);
    }
})();
