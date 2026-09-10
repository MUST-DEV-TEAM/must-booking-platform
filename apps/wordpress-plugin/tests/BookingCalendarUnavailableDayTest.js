const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'assets', 'js', 'booking-page.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const instrumentedSource = source.replace(
    /\}\)\(\);\s*$/,
    'window.__mustBookingCalendarTest = { markUnavailableDayElement: markUnavailableDayElement };\n})();\n'
);

assert.notEqual(instrumentedSource, source, 'could not expose calendar helper for test');

const context = {
    window: {
        mustHotelBookingBookingPage: {}
    },
    document: {
        readyState: 'loading',
        addEventListener: function () {}
    }
};

vm.runInNewContext(instrumentedSource, context, { filename: scriptPath });

const { markUnavailableDayElement } = context.window.__mustBookingCalendarTest;

function createDay(classNames) {
    const classes = new Set(classNames || []);
    const attributes = new Map();

    return {
        dateObj: new Date(2026, 8, 15),
        classList: {
            contains: function (className) {
                return classes.has(className);
            },
            toggle: function (className, enabled) {
                if (enabled) {
                    classes.add(className);
                } else {
                    classes.delete(className);
                }
            }
        },
        setAttribute: function (name, value) {
            attributes.set(name, value);
        },
        removeAttribute: function (name) {
            attributes.delete(name);
        },
        hasClass: function (className) {
            return classes.has(className);
        },
        getAttribute: function (name) {
            return attributes.get(name);
        }
    };
}

const apiUnavailable = createDay();
markUnavailableDayElement(apiUnavailable, ['2026-09-15']);
assert.equal(apiUnavailable.hasClass('must-booking-day-unavailable'), true);
assert.equal(apiUnavailable.getAttribute('aria-disabled'), 'true');

const flatpickrDisabled = createDay(['flatpickr-disabled']);
markUnavailableDayElement(flatpickrDisabled, []);
assert.equal(flatpickrDisabled.hasClass('must-booking-day-unavailable'), true);
assert.equal(flatpickrDisabled.getAttribute('aria-disabled'), 'true');

const adjacentMonthPadding = createDay(['flatpickr-disabled', 'prevMonthDay']);
markUnavailableDayElement(adjacentMonthPadding, ['2026-09-15']);
assert.equal(adjacentMonthPadding.hasClass('must-booking-day-unavailable'), false);

const availableDay = createDay();
availableDay.setAttribute('aria-disabled', 'true');
markUnavailableDayElement(availableDay, []);
assert.equal(availableDay.hasClass('must-booking-day-unavailable'), false);
assert.equal(availableDay.getAttribute('aria-disabled'), undefined);

console.log('Booking calendar unavailable-day state tests passed.');
