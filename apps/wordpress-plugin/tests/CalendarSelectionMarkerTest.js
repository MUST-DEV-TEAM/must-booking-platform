const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'must-booking-calendar.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    '    initializePartyComposer();\n    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);',
    '    window.__mustBookingSelectionMarkerTest = { updateCalendarSelectionMarkers: updateCalendarSelectionMarkers };'
);

assert.notEqual(instrumentedSource, source, 'could not expose updateCalendarSelectionMarkers for test');

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

function createDay(dateObj) {
    const classes = new Set(['flatpickr-day', 'flatpickr-disabled']);
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
    return context.window.__mustBookingSelectionMarkerTest;
}

function makePicker(days) {
    return {
        calendarContainer: {
            querySelectorAll: function () { return days; }
        }
    };
}

// The check-in date gets the "start" marker so its own distinct selected
// look (already styled in CSS) wins over the plain disabled look it also
// carries once picked.
{
    const helpers = run();
    const checkinDay = createDay(new Date(2026, 9, 1));
    const middleDay = createDay(new Date(2026, 9, 2));
    const checkoutDay = createDay(new Date(2026, 9, 3));
    const picker = makePicker([checkinDay, middleDay, checkoutDay]);

    helpers.updateCalendarSelectionMarkers(picker, '2026-10-01', '2026-10-03');

    assert.equal(checkinDay.hasClass('must-booking-day-start'), true, 'checkin date must get the start marker');
    assert.equal(checkoutDay.hasClass('must-booking-day-end'), true, 'checkout date must get the end marker');
    assert.equal(middleDay.hasClass('must-booking-day-in-range'), true, 'a night between checkin and checkout must get the in-range marker');
    assert.equal(checkinDay.hasClass('must-booking-day-end'), false);
    assert.equal(checkoutDay.hasClass('must-booking-day-start'), false);
}

// Only a checkin (no checkout yet) still gets marked as the start, with no
// end/in-range markers applied to anything.
{
    const helpers = run();
    const checkinDay = createDay(new Date(2026, 9, 1));
    const otherDay = createDay(new Date(2026, 9, 2));
    const picker = makePicker([checkinDay, otherDay]);

    helpers.updateCalendarSelectionMarkers(picker, '2026-10-01', '');

    assert.equal(checkinDay.hasClass('must-booking-day-start'), true);
    assert.equal(otherDay.hasClass('must-booking-day-in-range'), false);
    assert.equal(otherDay.hasClass('must-booking-day-end'), false);
}

// Clearing the selection (both empty) removes any leftover markers from a
// previous stay so a fresh selection cycle starts clean.
{
    const helpers = run();
    const day = createDay(new Date(2026, 9, 1));
    day.classList.toggle('must-booking-day-start', true);
    const picker = makePicker([day]);

    helpers.updateCalendarSelectionMarkers(picker, '', '');

    assert.equal(day.hasClass('must-booking-day-start'), false);
}

console.log('Calendar selection marker tests passed.');
