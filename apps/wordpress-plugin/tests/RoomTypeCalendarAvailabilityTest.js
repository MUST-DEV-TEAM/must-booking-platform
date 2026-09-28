const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'must-booking-calendar.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    '    initializePartyComposer();\n    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);',
    '    window.__mustBookingRoomTypeCalendarTest = { resolveCalendarAvailabilitySource: resolveCalendarAvailabilitySource };'
);

assert.notEqual(instrumentedSource, source, 'could not expose the room-type calendar helper for test');

function createSelect(value) {
    return { value: value };
}

function makeContext(overrides) {
    const elements = Object.assign(
        {
            '#must-booking-accommodation-type': createSelect(''),
            '#must-booking-adults': createSelect('1'),
            '#must-booking-children': createSelect('0')
        },
        overrides || {}
    );
    return {
        window: {
            flatpickr: function () {},
            mustHotelBookingCalendar: {
                roomAvailability: null,
                roomTypeAvailability: { ajaxUrl: 'https://hotel.example/wp-admin/admin-ajax.php', nonce: 'a-nonce' }
            }
        },
        document: {
            querySelector: function (selector) {
                return elements[selector] || null;
            }
        }
    };
}

// No room type selected at all yet (the "All types" option) — there is
// nothing to check, so no availability source should be resolved.
const noSelection = makeContext();
vm.runInNewContext(instrumentedSource, noSelection, { filename: scriptPath });
const { resolveCalendarAvailabilitySource: withNoSelection } = noSelection.window.__mustBookingRoomTypeCalendarTest;
assert.equal(withNoSelection(), null, 'no accommodation type selected must resolve no availability source');

// A room type is selected from the dropdown, with no fixed physical room —
// the calendar must check that room type's live Clock availability.
const roomTypeSelected = makeContext({
    '#must-booking-accommodation-type': createSelect('clock-type-1'),
    '#must-booking-adults': createSelect('2'),
    '#must-booking-children': createSelect('1')
});
vm.runInNewContext(instrumentedSource, roomTypeSelected, { filename: scriptPath });
const { resolveCalendarAvailabilitySource: withRoomType } = roomTypeSelected.window.__mustBookingRoomTypeCalendarTest;
const resolved = withRoomType();
assert.notEqual(resolved, null, 'a selected accommodation type must resolve an availability source');
assert.equal(resolved.roomTypeId, 'clock-type-1');
assert.equal(resolved.adults, '2');
assert.equal(resolved.children, '1');
assert.equal(resolved.ajaxUrl, 'https://hotel.example/wp-admin/admin-ajax.php');
assert.equal(resolved.nonce, 'a-nonce');

// A fixed physical room (roomId already known) always wins over the dropdown
// — it keeps checking that exact room, matching the pre-existing behavior.
const fixedRoomContext = makeContext({ '#must-booking-accommodation-type': createSelect('clock-type-1') });
fixedRoomContext.window.mustHotelBookingCalendar.roomAvailability = {
    ajaxUrl: 'https://hotel.example/wp-admin/admin-ajax.php',
    nonce: 'fixed-room-nonce',
    availabilityAction: 'must_booking_room_availability_check'
};
vm.runInNewContext(instrumentedSource, fixedRoomContext, { filename: scriptPath });
const { resolveCalendarAvailabilitySource: withFixedRoom } = fixedRoomContext.window.__mustBookingRoomTypeCalendarTest;
const fixedResolved = withFixedRoom();
assert.notEqual(fixedResolved, null);
assert.equal(fixedResolved.roomTypeId, undefined, 'fixed-room mode must not send a room_type_id calendar request');
assert.equal(fixedResolved.nonce, 'fixed-room-nonce');

console.log('Room type calendar availability tests passed.');
