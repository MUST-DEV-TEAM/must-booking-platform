(function ($) {
    function copyText(text) {
        if (!text) {
            return Promise.reject();
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }

        return Promise.reject();
    }

    function getCopySource(sourceId) {
        var node = document.getElementById(sourceId);

        if (!node) {
            return '';
        }

        if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
            return node.value || '';
        }

        return node.textContent || '';
    }

    $(document).on('click', '[data-must-media-target]', function (event) {
        event.preventDefault();

        var targetId = $(this).data('mustMediaTarget');
        var target = document.getElementById(targetId);

        if (!target || !wp.media) {
            return;
        }

        var frame = wp.media({
            title: (window.mustHotelBookingSettingsAdmin && window.mustHotelBookingSettingsAdmin.mediaFrameTitle) || 'Select Image',
            button: {
                text: (window.mustHotelBookingSettingsAdmin && window.mustHotelBookingSettingsAdmin.mediaFrameButton) || 'Use Image'
            },
            multiple: false
        });

        frame.on('select', function () {
            var selection = frame.state().get('selection').first();
            var attachment = selection ? selection.toJSON() : null;

            if (attachment && attachment.url) {
                target.value = attachment.url;
                target.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        frame.open();
    });

    $(document).on('click', '[data-must-clear-target]', function (event) {
        event.preventDefault();

        var targetId = $(this).data('mustClearTarget');
        var target = document.getElementById(targetId);

        if (!target) {
            return;
        }

        target.value = '';
        target.dispatchEvent(new Event('change', { bubbles: true }));
    });

    $(document).on('click', '[data-must-copy]', function (event) {
        event.preventDefault();

        var sourceId = $(this).data('mustCopy');
        var text = getCopySource(sourceId);
        var successLabel = (window.mustHotelBookingSettingsAdmin && window.mustHotelBookingSettingsAdmin.copyLabel) || 'Copied to clipboard.';
        var failLabel = (window.mustHotelBookingSettingsAdmin && window.mustHotelBookingSettingsAdmin.copyFailedLabel) || 'Unable to copy automatically.';

        copyText(text).then(function () {
            window.alert(successLabel);
        }).catch(function () {
            window.alert(failLabel);
        });
    });
}(jQuery));
