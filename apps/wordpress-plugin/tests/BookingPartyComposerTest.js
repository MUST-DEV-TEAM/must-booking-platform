const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'must-booking-calendar.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    '    initializePartyComposer();\n    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);',
    '    window.__mustBookingPartyComposerTest = { syncPartyControls: syncPartyControls };'
);

assert.notEqual(instrumentedSource, source, 'could not expose the production party-composer helper for test');

const context = {
    window: {
        flatpickr: function () {},
        mustHotelBookingCalendar: {}
    },
    document: {
        querySelector: function () { return null; }
    }
};

vm.runInNewContext(instrumentedSource, context, { filename: scriptPath });

const { syncPartyControls } = context.window.__mustBookingPartyComposerTest;

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

function composeParty(adults, children, rooms, maxGuests) {
    const adultsSelect = createControl(adults);
    const childrenSelect = createControl(children);
    const adultsInput = createControl('');
    const childrenInput = createControl('');
    const guestsInput = createControl('');
    const totalOutput = createControl('');
    const capacityMessage = createControl('');
    const roomCountSelect = createControl(rooms);
    const submitButton = createControl('');
    const result = syncPartyControls(
        adultsSelect,
        childrenSelect,
        adultsInput,
        childrenInput,
        guestsInput,
        totalOutput,
        capacityMessage,
        roomCountSelect,
        maxGuests,
        true,
        submitButton
    );
    return {
        result,
        adultsSelect,
        childrenSelect,
        adultsInput,
        childrenInput,
        guestsInput,
        totalOutput,
        capacityMessage,
        roomCountSelect,
        submitButton
    };
}

const familyOfThree = composeParty(2, 1, 0, 6);
assert.equal(familyOfThree.result.adults, 2);
assert.equal(familyOfThree.result.children, 1);
assert.equal(familyOfThree.result.guests, 3);
assert.equal(familyOfThree.result.error, '');
assert.equal(familyOfThree.totalOutput.textContent, '3');
assert.equal(familyOfThree.guestsInput.value, '3');
assert.equal(familyOfThree.adultsInput.value, '2');
assert.equal(familyOfThree.childrenInput.value, '1');
assert.equal(familyOfThree.submitButton.disabled, false);

const familyOfSix = composeParty(4, 2, 0, 6);
assert.equal(familyOfSix.result.adults, 4);
assert.equal(familyOfSix.result.children, 2);
assert.equal(familyOfSix.result.guests, 6);
assert.equal(familyOfSix.result.error, '');
assert.equal(familyOfSix.totalOutput.textContent, '6');
assert.equal(familyOfSix.guestsInput.value, '6');

const overCapacity = composeParty(4, 3, 0, 6);
assert.equal(overCapacity.result.guests, 7);
assert.match(overCapacity.result.error, /up to 6 guests/);
assert.equal(overCapacity.childrenSelect.value, '3', 'capacity feedback must not silently alter the adult/child split');
assert.equal(overCapacity.totalOutput.textContent, '7');
assert.equal(overCapacity.submitButton.disabled, true);
assert.equal(overCapacity.capacityMessage.hidden, false);

const multipleRooms = composeParty(4, 2, 2, 6);
assert.match(multipleRooms.result.error, /one room at a time/);
assert.equal(multipleRooms.submitButton.disabled, true);

console.log('Booking party composer tests passed.');
