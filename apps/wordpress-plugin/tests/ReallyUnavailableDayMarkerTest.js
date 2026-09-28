const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'must-booking-calendar.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    '    initializePartyComposer();\n    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);',
    '    window.__mustBookingReallyUnavailableTest = {\n' +
    '        markReallyUnavailableDay: markReallyUnavailableDay,\n' +
    '        markUnavailable: function (dates) { unavailableDates = {}; dates.forEach(function (d) { unavailableDates[d] = true; }); }\n' +
    '    };'
);

assert.notEqual(instrumentedSource, source, 'could not expose markReallyUnavailableDay for test');

function makeContext() {
    return {
        window: {
            flatpickr: function () {},
            mustHotelBookingCalendar: { minimumNights: 1 }
        },
        document: {
            querySelector: function () { return null; }
        }
    };
}

function createDay(dateObj, classNames) {
    const classes = new Set(classNames || []);
    return {
        dateObj: dateObj,
        classList: {
            contains: function (name) { return classes.has(name); },
            toggle: function (name, enabled) {
                if (enabled) classes.add(name); else classes.delete(name);
            }
        },
        hasClass: function (name) { return classes.has(name); }
    };
}

function run() {
    const context = makeContext();
    vm.runInNewContext(instrumentedSource, context, { filename: scriptPath });
    return context.window.__mustBookingReallyUnavailableTest;
}

// A date flatpickr marks 'flatpickr-disabled' purely because it now sits
// before the picker's own minDate (set after a checkin click, e.g. checkin
// itself, or dates before checkin+minimumNights) must NOT get the "really
// unavailable" slash: it is not actually unavailable data, just temporarily
// out of range for the current selection step.
{
    const helpers = run();
    helpers.markUnavailable([]); // nothing genuinely unavailable
    const day = createDay(new Date(2026, 9, 1), ['flatpickr-disabled']); // Oct 1, out of range only
    helpers.markReallyUnavailableDay(day);
    assert.equal(day.hasClass('must-booking-day-unavailable'), false, 'a range-bound date must not be painted as really unavailable');
}

// A date that IS genuinely unavailable (real Clock/local data) must still
// get the slash even though flatpickr also marks it flatpickr-disabled.
{
    const helpers = run();
    helpers.markUnavailable(['2026-10-04']);
    const day = createDay(new Date(2026, 9, 4), ['flatpickr-disabled']);
    helpers.markReallyUnavailableDay(day);
    assert.equal(day.hasClass('must-booking-day-unavailable'), true, 'a genuinely unavailable date must still be painted');
}

// Adjacent-month padding days must never get the slash even if unavailable
// data happens to exist for that date (mirrors the existing booking-page.js
// behavior for padding days).
{
    const helpers = run();
    helpers.markUnavailable(['2026-10-04']);
    const day = createDay(new Date(2026, 9, 4), ['flatpickr-disabled', 'prevMonthDay']);
    helpers.markReallyUnavailableDay(day);
    assert.equal(day.hasClass('must-booking-day-unavailable'), false, 'padding days must never be painted');
}

// A date before today is always really unavailable to the guest (it's in
// the past, regardless of what Clock/local data says) and must get the same
// crossed-out treatment as any other unavailable date, not just a plain
// disabled look.
{
    const helpers = run();
    helpers.markUnavailable([]); // no genuinely-unavailable data at all
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const day = createDay(yesterday, ['flatpickr-disabled']);
    helpers.markReallyUnavailableDay(day);
    assert.equal(day.hasClass('must-booking-day-unavailable'), true, 'a past date must be painted as unavailable even with no unavailable-date data');
}

console.log('Really-unavailable day marker tests passed.');
