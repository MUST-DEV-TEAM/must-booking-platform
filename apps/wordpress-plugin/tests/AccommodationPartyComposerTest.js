const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'booking-accommodation.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    /    document\.addEventListener\('click', onDocumentClick\);[\s\S]*?    initSelectionForms\(\);\n\}\)\(\);\s*$/,
    '    window.__mustBookingAccommodationPartyComposerTest = { syncAccommodationPartyComposer: syncAccommodationPartyComposer };\n})();\n'
);

assert.notEqual(instrumentedSource, source, 'could not expose the production accommodation party-composer helper for test');

function createControl(value) {
    const attributes = new Map();
    return {
        value: String(value),
        textContent: '',
        hidden: false,
        disabled: false,
        setAttribute: function (name, nextValue) { attributes.set(name, String(nextValue)); },
        getAttribute: function (name) { return attributes.get(name) || null; },
        removeAttribute: function (name) { attributes.delete(name); }
    };
}

const controls = {
    'must-booking-accommodation-adults': createControl(2),
    'must-booking-accommodation-children': createControl(1),
    'must-booking-accommodation-room-count': createControl(0),
    'must-booking-accommodation-guests': createControl(''),
    'must-booking-accommodation-guests-total': createControl(''),
    'must-booking-accommodation-party-capacity-message': createControl('')
};
const submitButton = createControl('');
const formAttributes = new Map([
    ['data-max-guests', '6'],
    ['data-single-room-only', 'true']
]);
const form = {
    getAttribute: function (name) { return formAttributes.get(name) || null; },
    querySelector: function (selector) { return selector === '.must-booking-results-filter-apply' ? submitButton : null; }
};

const context = {
    window: { mustBookingAccommodationConfig: {} },
    document: {
        getElementById: function (id) { return controls[id] || null; }
    }
};

vm.runInNewContext(instrumentedSource, context, { filename: scriptPath });

const { syncAccommodationPartyComposer } = context.window.__mustBookingAccommodationPartyComposerTest;

let result = syncAccommodationPartyComposer(form);
assert.equal(result.guests, 3);
assert.equal(controls['must-booking-accommodation-guests'].value, '3');
assert.equal(controls['must-booking-accommodation-guests-total'].textContent, '3');
assert.equal(submitButton.disabled, false);

controls['must-booking-accommodation-adults'].value = '4';
controls['must-booking-accommodation-children'].value = '2';
result = syncAccommodationPartyComposer(form);
assert.equal(result.guests, 6);
assert.equal(controls['must-booking-accommodation-guests'].value, '6');

controls['must-booking-accommodation-room-count'].value = '2';
result = syncAccommodationPartyComposer(form);
assert.match(result.error, /one room at a time/);
assert.equal(submitButton.disabled, true);
assert.equal(controls['must-booking-accommodation-party-capacity-message'].hidden, false);

console.log('Accommodation party composer tests passed.');
