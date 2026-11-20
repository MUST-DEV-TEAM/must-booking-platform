"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOOKING_LIMIT_RANGES = exports.WEEKDAYS = void 0;
exports.checkBookingLimit = checkBookingLimit;
exports.validMonthDay = validMonthDay;
exports.checkSeason = checkSeason;
exports.inSeason = inSeason;
exports.checkWeekdays = checkWeekdays;
exports.checkBookingWindow = checkBookingWindow;
/**
 * The rules for the hotel-wide booking limits, written once. The Booking rules form shows these
 * messages as the owner types and the API refuses the same values (settings redesign plan, S4).
 */
exports.WEEKDAYS = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 7, label: 'Sun' },
];
/** Allowed whole-number ranges. A field left empty means "no limit". */
exports.BOOKING_LIMIT_RANGES = {
    minStayNights: { min: 1, max: 30, unit: 'nights' },
    maxStayNights: { min: 1, max: 365, unit: 'nights' },
    advanceBookingDays: { min: 1, max: 730, unit: 'days' },
    minNoticeHours: { min: 0, max: 720, unit: 'hours' },
    maxGuestsPerBooking: { min: 1, max: 50, unit: 'guests' },
    maxRoomsPerBooking: { min: 1, max: 20, unit: 'rooms' },
};
function checkBookingLimit(key, value) {
    if (value === null || value === undefined)
        return null;
    const range = exports.BOOKING_LIMIT_RANGES[key];
    return Number.isInteger(value) && value >= range.min && value <= range.max
        ? null
        : `Enter a whole number from ${range.min} to ${range.max} ${range.unit}, or leave it empty.`;
}
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** "MM-DD" that exists in a leap year, such as 06-15. */
function validMonthDay(value) {
    const match = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
    return !!match && Number(match[2]) <= MONTH_LENGTHS[Number(match[1]) - 1];
}
function checkSeason(from, to) {
    if (!from && !to)
        return null;
    if (!from || !to)
        return 'Enter both the opening and closing dates, or leave both empty to be open all year.';
    if (!validMonthDay(from) || !validMonthDay(to))
        return 'Choose real dates for the season.';
    if (from === to)
        return 'The closing date must differ from the opening date.';
    return null;
}
/** Whether a month-day falls inside the season; a season may run over the new year (Nov to Mar). */
function inSeason(monthDay, from, to) {
    if (!from || !to)
        return true;
    return from <= to ? monthDay >= from && monthDay <= to : monthDay >= from || monthDay <= to;
}
function checkWeekdays(value) {
    return Array.isArray(value) &&
        value.length >= 1 &&
        value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
        new Set(value).size === value.length
        ? null
        : 'Choose at least one day.';
}
/** Cross-field rules; returns messages by field. */
function checkBookingWindow(values) {
    const out = {};
    if (values.minStayNights != null &&
        values.maxStayNights != null &&
        values.minStayNights > values.maxStayNights)
        out.maxStayNights = 'The maximum stay cannot be shorter than the minimum stay.';
    const season = checkSeason(values.seasonOpenFrom, values.seasonOpenTo);
    if (season)
        out.seasonOpenTo = season;
    return out;
}
