(function ($) {
    'use strict';

    var editorCache = {};

    function mediaStrings() {
        return window.mustHotelBookingRoomsMedia || {};
    }

    function canUseMediaLibrary() {
        return typeof window.wp !== 'undefined' && window.wp.media;
    }

    function getThumbUrl(attachment) {
        if (attachment && attachment.sizes && attachment.sizes.thumbnail && attachment.sizes.thumbnail.url) {
            return attachment.sizes.thumbnail.url;
        }

        if (attachment && attachment.sizes && attachment.sizes.medium && attachment.sizes.medium.url) {
            return attachment.sizes.medium.url;
        }

        if (attachment && attachment.url) {
            return attachment.url;
        }

        return '';
    }

    function buildGalleryPreviewHtml(attachments) {
        var html = '';

        attachments.forEach(function (attachment) {
            var thumbUrl = getThumbUrl(attachment);

            if (!thumbUrl) {
                return;
            }

            html += '<img class="must-room-gallery-thumb" src="' + thumbUrl + '" alt="" />';
        });

        return html;
    }

    function buildMainPreviewHtml(attachment) {
        var thumbUrl = getThumbUrl(attachment);

        if (!thumbUrl) {
            return '';
        }

        return '<img class="must-room-main-image-thumb" src="' + thumbUrl + '" alt="" />';
    }

    function bindAmenityState($scope) {
        $scope.find('.must-room-amenity-option input[type="checkbox"]').each(function () {
            var $input = $(this);
            $input.closest('.must-room-amenity-option').toggleClass('is-selected', $input.is(':checked'));
        });
    }

    function syncToggleCards($scope) {
        $scope.find('.must-accommodation-toggle input[type="checkbox"]').each(function () {
            var $input = $(this);
            $input.closest('.must-accommodation-toggle').toggleClass('is-active', $input.is(':checked'));
        });
    }

    function updateBehaviorSummary($scope) {
        syncToggleCards($scope);

        $scope.find('.must-accommodation-form-section').has('.must-accommodation-behavior-summary').each(function () {
            var $section = $(this);
            var $pillWrap = $section.find('[data-booking-behavior-pills]');
            var pills = [];

            $section.find('[data-toggle-card] input[type="checkbox"]').each(function () {
                var $input = $(this);
                var isChecked = $input.is(':checked');
                var label = isChecked ? $input.attr('data-toggle-label-on') : $input.attr('data-toggle-label-off');

                if (label) {
                    pills.push('<span class="must-accommodation-behavior-pill' + (isChecked ? ' is-active' : '') + '">' + label + '</span>');
                }
            });

            $pillWrap.html(pills.join(''));
        });
    }

    function updateAmenitySummary($scope) {
        var emptyText = mediaStrings().noAmenitiesSelected || 'No amenities selected yet.';

        $scope.find('.must-accommodation-inline-picker').each(function () {
            var $picker = $(this).closest('.must-accommodation-field-span-2');
            var $tags = $picker.find('.must-accommodation-selected-tags').first();
            var labels = [];

            $picker.find('.must-room-amenity-option input[type="checkbox"]:checked').each(function () {
                labels.push($(this).siblings('.must-room-amenity-label').text());
            });

            $picker.find('.must-accommodation-inline-picker-copy small').text(labels.length === 1 ? '1 amenity selected' : labels.length + ' amenities selected');

            if (!$tags.length) {
                return;
            }

            if (!labels.length) {
                $tags.attr('data-empty-text', emptyText).empty();
                return;
            }

            $tags.removeAttr('data-empty-text').html(labels.map(function (label) {
                return '<span class="must-accommodation-selected-tag">' + label + '</span>';
            }).join(''));
        });
    }

    function filterAmenityList($input) {
        var query = String($input.val() || '').toLowerCase().trim();
        var modalId = $input.attr('data-amenity-search');
        var $modal = $('#' + modalId);

        $modal.find('[data-amenity-list] .must-room-amenity-option').each(function () {
            var $option = $(this);
            var label = String($option.attr('data-amenity-label') || '');
            var shouldShow = query === '' || label.indexOf(query) !== -1;

            $option.toggle(shouldShow);
        });
    }

    function initializeEditorScope($scope) {
        bindAmenityState($scope);
        syncToggleCards($scope);
        updateBehaviorSummary($scope);
        updateAmenitySummary($scope);
    }

    function getEditorModal(kind) {
        return $('[data-editor-modal-shell="' + kind + '"]').first();
    }

    function setBodyLocked(isLocked) {
        $('body').toggleClass('must-accommodation-modal-open', isLocked);
    }

    function openEditorModal($modal) {
        if (!$modal.length) {
            return;
        }

        $modal.prop('hidden', false).addClass('is-open');
        setBodyLocked(true);
        initializeEditorScope($modal);
    }

    function closeEditorModal($modal) {
        if (!$modal.length) {
            return;
        }

        $modal.removeClass('is-open').prop('hidden', true);
        $modal.find('.must-accommodation-submodal').prop('hidden', true).removeClass('is-open');
        setBodyLocked($('.must-accommodation-editor-modal.is-open').length > 1);
    }

    function setEditorLoading($modal) {
        $modal.find('[data-editor-slot]').html(
            '<div class="must-accommodation-editor-loading">' +
                '<span class="spinner is-active"></span>' +
                '<strong>' + (mediaStrings().loadingEditor || 'Loading editor...') + '</strong>' +
            '</div>'
        );
        openEditorModal($modal);
    }

    function extractEditorHtml(markup, kind) {
        var parser = new window.DOMParser();
        var doc = parser.parseFromString(markup, 'text/html');
        var slot = doc.querySelector('[data-editor-modal-shell="' + kind + '"] [data-editor-slot]');

        return slot ? slot.innerHTML : '';
    }

    function loadEditorIntoModal(url, kind, fallbackUrl) {
        var $modal = getEditorModal(kind);

        if (!$modal.length || !url) {
            window.location.href = fallbackUrl || url;
            return;
        }

        if (editorCache[url]) {
            $modal.find('[data-editor-slot]').html(editorCache[url]);
            openEditorModal($modal);
            return;
        }

        setEditorLoading($modal);

        window.fetch(url, {
            credentials: 'same-origin'
        }).then(function (response) {
            if (!response.ok) {
                throw new Error('bad_response');
            }

            return response.text();
        }).then(function (markup) {
            var html = extractEditorHtml(markup, kind);

            if (!html) {
                throw new Error('missing_editor');
            }

            editorCache[url] = html;
            $modal.find('[data-editor-slot]').html(html);
            openEditorModal($modal);
        }).catch(function () {
            window.alert(mediaStrings().loadingEditorFailed || 'Unable to load the editor. Opening the page directly instead.');
            window.location.href = fallbackUrl || url;
        });
    }

    function openSubmodal($modal) {
        if (!$modal.length) {
            return;
        }

        $modal.prop('hidden', false).addClass('is-open');
    }

    function closeSubmodal($modal) {
        if (!$modal.length) {
            return;
        }

        $modal.removeClass('is-open').prop('hidden', true);
    }

    $(document).on('click', '.must-open-accommodation-editor', function (event) {
        var $trigger = $(this);
        var url = $trigger.attr('data-editor-url') || $trigger.attr('href');
        var kind = $trigger.attr('data-editor-modal');

        if (!url || !kind) {
            return;
        }

        event.preventDefault();
        loadEditorIntoModal(url, kind, $trigger.attr('href'));
    });

    $(document).on('click', '[data-close-editor], .must-close-accommodation-editor', function (event) {
        var $target = $(this);
        var $modal = $target.closest('.must-accommodation-editor-modal');
        var nextUrl = $target.attr('href') || $modal.attr('data-close-url') || window.location.pathname + window.location.search;

        if ($target.is('a') && event.type === 'click') {
            event.preventDefault();
        }

        closeEditorModal($modal);
        window.history.replaceState({}, document.title, nextUrl);
    });

    $(document).on('click', '.must-open-submodal', function () {
        openSubmodal($('#' + $(this).attr('data-modal-target')));
    });

    $(document).on('click', '[data-close-submodal]', function () {
        closeSubmodal($(this).closest('.must-accommodation-submodal'));
    });

    $(document).on('input', '.must-accommodation-amenity-search', function () {
        filterAmenityList($(this));
    });

    $(document).on('click', '.must-amenity-bulk-action', function () {
        var mode = $(this).attr('data-amenity-bulk');
        var $modal = $(this).closest('.must-accommodation-submodal');

        $modal.find('[data-amenity-list] .must-room-amenity-option:visible input[type="checkbox"]').prop('checked', mode === 'select-all').trigger('change');
    });

    $(document).on('change', '.must-room-amenity-option input[type="checkbox"]', function () {
        var $scope = $(this).closest('.must-accommodation-editor-modal, .must-accommodation-editor-card');

        $(this).closest('.must-room-amenity-option').toggleClass('is-selected', $(this).is(':checked'));
        updateAmenitySummary($scope);
    });

    $(document).on('click', '.must-accommodation-toggle', function (event) {
        var $target = $(event.target);
        var $input = $(this).find('input[type="checkbox"]').first();

        if (!$input.length || $input.is(':disabled') || $target.is('a, button, select, textarea')) {
            return;
        }

        if ($target.is('input[type="checkbox"]')) {
            return;
        }

        event.preventDefault();
        $input.prop('checked', !$input.is(':checked')).trigger('change');
    });

    $(document).on('change', '.must-accommodation-toggle input[type="checkbox"]', function () {
        updateBehaviorSummary($(this).closest('.must-accommodation-editor-modal, .must-accommodation-editor-card'));
    });

    $(document).on('click', '.must-room-upload-main-image', function (event) {
        event.preventDefault();

        if (!canUseMediaLibrary()) {
            window.alert('The WordPress media library is not available on this screen.');
            return;
        }

        var $fieldWrap = $(this).closest('.must-room-main-image-field');
        var $input = $fieldWrap.find('.must-room-main-image-id');
        var $preview = $fieldWrap.find('.must-room-main-image-preview');

        var frame = wp.media({
            title: mediaStrings().mainImageFrameTitle || 'Select Main Image',
            button: {
                text: mediaStrings().mainImageButtonText || 'Use Main Image'
            },
            multiple: false
        });

        frame.on('select', function () {
            var selection = frame.state().get('selection').first();

            if (!selection) {
                return;
            }

            var attachment = selection.toJSON();

            if (!attachment || !attachment.id) {
                return;
            }

            $input.val(parseInt(attachment.id, 10));
            $preview.html(buildMainPreviewHtml(attachment));
        });

        frame.open();
    });

    $(document).on('click', '.must-room-clear-main-image', function (event) {
        event.preventDefault();

        var $fieldWrap = $(this).closest('.must-room-main-image-field');

        $fieldWrap.find('.must-room-main-image-id').val('');
        $fieldWrap.find('.must-room-main-image-preview').empty();
    });

    $(document).on('click', '.must-room-upload-images', function (event) {
        event.preventDefault();

        if (!canUseMediaLibrary()) {
            window.alert('The WordPress media library is not available on this screen.');
            return;
        }

        var $fieldWrap = $(this).closest('.must-room-gallery-field');
        var $input = $fieldWrap.find('.must-room-gallery-ids');
        var $preview = $fieldWrap.find('.must-room-gallery-preview');

        var frame = wp.media({
            title: mediaStrings().galleryFrameTitle || 'Select Gallery Images',
            button: {
                text: mediaStrings().galleryButtonText || 'Use Images'
            },
            multiple: true
        });

        frame.on('select', function () {
            var selection = frame.state().get('selection').toJSON();
            var ids = [];

            selection.forEach(function (attachment) {
                if (attachment.id) {
                    ids.push(parseInt(attachment.id, 10));
                }
            });

            $input.val(ids.join(','));
            $preview.html(buildGalleryPreviewHtml(selection));
        });

        frame.open();
    });

    $(document).on('click', '.must-room-clear-images', function (event) {
        event.preventDefault();

        var $fieldWrap = $(this).closest('.must-room-gallery-field');

        $fieldWrap.find('.must-room-gallery-ids').val('');
        $fieldWrap.find('.must-room-gallery-preview').empty();
    });

    $(document).on('keydown', function (event) {
        if (event.key === 'Escape') {
            if ($('.must-accommodation-submodal.is-open').length) {
                closeSubmodal($('.must-accommodation-submodal.is-open').last());
                return;
            }

            if ($('.must-accommodation-editor-modal.is-open').length) {
                closeEditorModal($('.must-accommodation-editor-modal.is-open').last());
            }
        }
    });

    $(function () {
        initializeEditorScope($(document));

        $('[data-editor-modal-shell][data-editor-open="1"]').each(function () {
            openEditorModal($(this));
        });
    });
})(jQuery);
