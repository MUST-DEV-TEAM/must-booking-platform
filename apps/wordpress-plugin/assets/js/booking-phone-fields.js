(function () {
    'use strict';

    function getPickerElements(root) {
        if (!(root instanceof HTMLElement)) {
            return null;
        }

        var input = root.querySelector('[data-picker-input="1"]');
        var toggle = root.querySelector('[data-picker-toggle="1"]');
        var panel = root.querySelector('[data-picker-panel="1"]');
        var search = root.querySelector('[data-picker-search="1"]');
        var label = root.querySelector('[data-picker-selected-label="1"]');
        var flag = root.querySelector('[data-picker-selected-flag="1"]');
        var empty = root.querySelector('[data-picker-empty="1"]');

        if (!(input instanceof HTMLInputElement) || !(toggle instanceof HTMLButtonElement) || !(panel instanceof HTMLElement) || !(label instanceof HTMLElement) || !(flag instanceof HTMLElement)) {
            return null;
        }

        return {
            input: input,
            toggle: toggle,
            panel: panel,
            search: search instanceof HTMLInputElement ? search : null,
            label: label,
            flag: flag,
            empty: empty instanceof HTMLElement ? empty : null
        };
    }

    function sanitizePhoneValue(value) {
        return String(value || '').replace(/\D+/g, '');
    }

    function bindPhoneInput(input) {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        input.addEventListener('input', function () {
            var sanitized = sanitizePhoneValue(input.value);

            if (input.value !== sanitized) {
                input.value = sanitized;
            }
        });

        input.value = sanitizePhoneValue(input.value);
    }

    function closeAllPickers(exceptRoot) {
        document.querySelectorAll('[data-checkout-picker="1"].is-open').forEach(function (picker) {
            if (!(picker instanceof HTMLElement) || picker === exceptRoot) {
                return;
            }

            setPickerOpen(picker, false);
        });
    }

    function updatePickerEmptyState(root) {
        var elements = getPickerElements(root);
        var visibleOptions = 0;

        if (elements === null) {
            return;
        }

        root.querySelectorAll('[data-picker-option="1"]').forEach(function (option) {
            if (option instanceof HTMLElement && !option.hidden) {
                visibleOptions += 1;
            }
        });

        if (elements.empty instanceof HTMLElement) {
            elements.empty.hidden = visibleOptions > 0;
        }
    }

    function resetPickerSearch(root) {
        var elements = getPickerElements(root);

        if (elements === null || !(elements.search instanceof HTMLInputElement)) {
            updatePickerEmptyState(root);
            return;
        }

        elements.search.value = '';

        root.querySelectorAll('[data-picker-option="1"]').forEach(function (option) {
            if (option instanceof HTMLElement) {
                option.hidden = false;
            }
        });

        updatePickerEmptyState(root);
    }

    function filterPickerOptions(root, query) {
        var normalizedQuery = String(query || '').trim().toLowerCase();

        root.querySelectorAll('[data-picker-option="1"]').forEach(function (option) {
            if (!(option instanceof HTMLElement)) {
                return;
            }

            var haystack = String(option.getAttribute('data-search') || '').toLowerCase();
            option.hidden = normalizedQuery !== '' && haystack.indexOf(normalizedQuery) === -1;
        });

        updatePickerEmptyState(root);
    }

    function setPickerOpen(root, isOpen) {
        var elements = getPickerElements(root);

        if (elements === null) {
            return;
        }

        root.classList.toggle('is-open', isOpen);
        elements.panel.hidden = !isOpen;
        elements.toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        if (!isOpen) {
            return;
        }

        resetPickerSearch(root);

        window.setTimeout(function () {
            var selectedOption = root.querySelector('[data-picker-option="1"].is-selected:not([hidden])');

            if (selectedOption instanceof HTMLElement) {
                selectedOption.scrollIntoView({ block: 'nearest' });
            }

            if (elements.search instanceof HTMLInputElement) {
                elements.search.focus();
                elements.search.select();
            }
        }, 0);
    }

    function applyPickerSelection(root, option, shouldFocusToggle) {
        var elements = getPickerElements(root);
        var value;
        var label;
        var flag;

        if (elements === null || !(option instanceof HTMLElement)) {
            return;
        }

        value = String(option.getAttribute('data-value') || '');
        label = String(option.getAttribute('data-label') || '');
        flag = String(option.getAttribute('data-flag') || '');

        elements.input.value = value;
        elements.label.textContent = label;
        elements.flag.textContent = flag;
        elements.flag.classList.toggle('is-hidden', flag === '');
        root.classList.toggle('is-placeholder', value === '');

        root.querySelectorAll('[data-picker-option="1"]').forEach(function (candidate) {
            if (!(candidate instanceof HTMLElement)) {
                return;
            }

            var isSelected = candidate === option;
            candidate.classList.toggle('is-selected', isSelected);
            candidate.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        });

        elements.input.dispatchEvent(new Event('change', { bubbles: true }));
        setPickerOpen(root, false);

        if (shouldFocusToggle) {
            elements.toggle.focus();
        }
    }

    function bindPicker(root) {
        var elements = getPickerElements(root);

        if (elements === null) {
            return;
        }

        elements.toggle.addEventListener('click', function () {
            var shouldOpen = !root.classList.contains('is-open');

            closeAllPickers(root);
            setPickerOpen(root, shouldOpen);
        });

        elements.toggle.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            closeAllPickers(root);
            setPickerOpen(root, true);
        });

        if (elements.search instanceof HTMLInputElement) {
            elements.search.addEventListener('input', function () {
                filterPickerOptions(root, elements.search.value);
            });

            elements.search.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    return;
                }

                if (event.key !== 'Escape') {
                    return;
                }

                event.preventDefault();
                setPickerOpen(root, false);
                elements.toggle.focus();
            });
        }

        root.querySelectorAll('[data-picker-option="1"]').forEach(function (option) {
            if (!(option instanceof HTMLButtonElement)) {
                return;
            }

            option.addEventListener('click', function () {
                applyPickerSelection(root, option, true);
            });

            option.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    setPickerOpen(root, false);
                    elements.toggle.focus();
                }
            });
        });

        updatePickerEmptyState(root);
    }

    function initPhoneInputs() {
        document.querySelectorAll('input[name="phone_number"]').forEach(bindPhoneInput);
        document.querySelectorAll('[data-checkout-picker="1"]').forEach(bindPicker);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPhoneInputs);
    } else {
        initPhoneInputs();
    }

    document.addEventListener('click', function (event) {
        document.querySelectorAll('[data-checkout-picker="1"].is-open').forEach(function (picker) {
            if (!(picker instanceof HTMLElement) || picker.contains(event.target)) {
                return;
            }

            setPickerOpen(picker, false);
        });
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') {
            return;
        }

        closeAllPickers(null);
    });
})();
