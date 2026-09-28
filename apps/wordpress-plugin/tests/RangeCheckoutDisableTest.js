const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'must-booking-calendar.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    '    initializePartyComposer();\n    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);',
    '    window.__mustBookingRangeCheckoutTest = {\n' +
    '        rangeDateIsDisabled: rangeDateIsDisabled,\n' +
    '        setPendingCheckin: function (v) { pendingRangeCheckin = v; },\n' +
    '        markUnavailable: function (dates) { unavailableDates = {}; dates.forEach(function (d) { unavailableDates[d] = true; }); }\n' +
    '    };'
);

assert.notEqual(instrumentedSource, source, 'could not expose the range checkout disable predicate for test');

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

function run() {
    const context = makeContext();
    vm.runInNewContext(instrumentedSource, context, { filename: scriptPath });
    return context.window.__mustBookingRangeCheckoutTest;
}

// Before any checkin is picked, this predicate must not disable anything by
// itself (checkinDateBlockedByMinimumStay already handles checkin picking;
// this predicate is only about constraining the checkout choice once a
// checkin exists).
{
    const helpers = run();
    helpers.markUnavailable([]);
    assert.equal(helpers.rangeDateIsDisabled(new Date(2026, 9, 1)), false, 'no pending checkin means no extra checkout constraint');
}

// Once a checkin is pending, a candidate checkout before checkin+minimumNights
// must be disabled.
{
    const helpers = run();
    helpers.markUnavailable([]);
    helpers.setPendingCheckin('2026-10-01');
    // minimumNights is 1 in this context, so checkin itself (0 nights) is too
    // short; checkin+1 day is the earliest valid checkout.
    assert.equal(helpers.rangeDateIsDisabled(new Date(2026, 9, 1)), true, 'checkin date itself is not a valid checkout (0 nights)');
    assert.equal(helpers.rangeDateIsDisabled(new Date(2026, 9, 2)), false, 'checkin+1 day satisfies a 1-night minimum');
}

// A candidate checkout beyond the first unavailable night after checkin must
// be disabled (gap-aware capping), even though it isn't unavailable itself.
{
    const helpers = run();
    helpers.markUnavailable(['2026-10-04']);
    helpers.setPendingCheckin('2026-10-01');
    assert.equal(helpers.rangeDateIsDisabled(new Date(2026, 9, 4)), false, 'checkout landing exactly on the first gap is still valid (arrive, do not sleep the gap night)');
    assert.equal(helpers.rangeDateIsDisabled(new Date(2026, 9, 5)), true, 'checkout past the first gap must be disabled');
}

// A candidate checkout before the pending checkin (picking backwards) must
// be disabled, not silently reinterpreted.
{
    const helpers = run();
    helpers.markUnavailable([]);
    helpers.setPendingCheckin('2026-10-05');
    assert.equal(helpers.rangeDateIsDisabled(new Date(2026, 9, 1)), true, 'a date before the pending checkin cannot be a checkout');
}

console.log('Range checkout disable tests passed.');
