const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'must-booking-calendar.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    '    initializePartyComposer();\n    loadAvailabilityMonth(todayDate).then(initializeCalendars, initializeCalendars);',
    '    window.__mustBookingMinimumStayTest = {\n' +
    '        latestValidCheckoutDate: latestValidCheckoutDate,\n' +
    '        checkinCanStartValidStay: checkinCanStartValidStay,\n' +
    '        markUnavailable: function (dates) { unavailableDates = {}; dates.forEach(function (d) { unavailableDates[d] = true; }); }\n' +
    '    };'
);

assert.notEqual(instrumentedSource, source, 'could not expose the minimum-stay calendar helpers for test');

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
    return context.window.__mustBookingMinimumStayTest;
}

// --- latestValidCheckoutDate: caps checkout at the first unavailable night ---
{
    const helpers = run();
    helpers.markUnavailable(['2026-10-30']);
    // Arrive the 28th; the night of the 30th is sold out. The guest can still
    // check out ON the 30th (they never sleep that night), but not later.
    assert.equal(helpers.latestValidCheckoutDate('2026-10-28', 1), '2026-10-30');
}

{
    const helpers = run();
    helpers.markUnavailable([]);
    // Nothing unavailable in range: capped only by how far the calendar looks
    // ahead, represented here by the caller-supplied horizon.
    assert.equal(helpers.latestValidCheckoutDate('2026-10-28', 1, '2026-11-27'), '2026-11-27');
}

{
    const helpers = run();
    helpers.markUnavailable(['2026-10-29']);
    // The very night right after check-in (the 29th) is unavailable: the
    // guest can still check out on the 29th (a valid 1-night stay, sleeping
    // only the 28th) but no later.
    assert.equal(helpers.latestValidCheckoutDate('2026-10-28', 1), '2026-10-29');
}

{
    const helpers = run();
    helpers.markUnavailable(['2026-10-28']);
    // Check-in night itself is unavailable and the minimum is 1 night: no
    // valid checkout exists at all starting from this check-in.
    assert.equal(helpers.latestValidCheckoutDate('2026-10-28', 1), null);
}

// --- checkinCanStartValidStay: minimum-nights-aware check-in disabling ---
{
    const helpers = run();
    helpers.markUnavailable(['2026-10-29']);
    // Minimum stay is 2 nights (28th and 29th) but the 29th is sold out —
    // starting a stay on the 28th can never reach the 2-night minimum.
    assert.equal(helpers.checkinCanStartValidStay('2026-10-28', 2), false);
}

{
    const helpers = run();
    helpers.markUnavailable(['2026-10-29']);
    // A 1-night minimum only needs the 28th itself, which is free.
    assert.equal(helpers.checkinCanStartValidStay('2026-10-28', 1), true);
}

{
    const helpers = run();
    helpers.markUnavailable([]);
    assert.equal(helpers.checkinCanStartValidStay('2026-10-28', 3), true);
}

console.log('Minimum-stay calendar tests passed.');
