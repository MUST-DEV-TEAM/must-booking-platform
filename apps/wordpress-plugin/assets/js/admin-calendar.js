(function () {
    'use strict';

    var panels = document.querySelectorAll('.must-calendar-context-panel');

    if (!panels.length) {
        return;
    }

    var setMode = function (panel, mode, url) {
        var sections = panel.querySelectorAll('[data-must-calendar-mode]');
        var triggers = panel.querySelectorAll('[data-must-calendar-mode-trigger]');
        var nextMode = mode || 'details';

        panel.setAttribute('data-active-mode', nextMode);

        sections.forEach(function (section) {
            section.hidden = section.getAttribute('data-must-calendar-mode') !== nextMode;
        });

        triggers.forEach(function (trigger) {
            trigger.classList.toggle('is-active', trigger.getAttribute('data-must-calendar-mode-trigger') === nextMode);
        });

        if (url && window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState({}, document.title, url);
        }
    };

    panels.forEach(function (panel) {
        var initialMode = panel.getAttribute('data-initial-mode') || 'details';
        var triggers = panel.querySelectorAll('[data-must-calendar-mode-trigger]');

        triggers.forEach(function (trigger) {
            trigger.addEventListener('click', function (event) {
                var mode = trigger.getAttribute('data-must-calendar-mode-trigger');
                var href = trigger.getAttribute('href') || '';

                if (!mode) {
                    return;
                }

                event.preventDefault();
                setMode(panel, mode, href);
            });
        });

        setMode(panel, initialMode);
    });
})();
