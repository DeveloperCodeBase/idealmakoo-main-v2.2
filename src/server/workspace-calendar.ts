/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { assert } from "./types";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validCalendarDate(value: string) { return datePattern.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function validZone(value: string) {
    try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date);
        return true;
    }
    catch {
        return false;
    }
}
const calendarDefinitionSchema = z.object({ name: z.string().trim().min(1).max(160), active: z.boolean(), timeZone: z.string().min(1).max(100).refine(validZone, "Use a supported IANA time zone."), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(value => new Set(value).size === value.length, "Weekdays must be unique."), intervals: z.array(z.object({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }).strict()).min(1).max(4).refine(value => value.every((row, index) => row.endMinute > row.startMinute && (index === 0 || value[index - 1].endMinute <= row.startMinute)), "Working intervals must be sorted and cannot overlap."), holidays: z.array(z.string().refine(validCalendarDate, "Use a valid Gregorian calendar date.")).max(366).refine(value => new Set(value).size === value.length, "Holiday dates must be unique."), assignmentMinutes: z.number().int().min(1).max(43200), firstResponseMinutes: z.number().int().min(1).max(43200), resolutionMinutes: z.number().int().min(1).max(43200) }).strict();
export type CalendarDefinition = z.infer<typeof calendarDefinitionSchema>;
const formatters = new Map<string, Intl.DateTimeFormat>;
function formatter(timeZone: string) {
    let value = formatters.get(timeZone);
    if (!value) {
        value = new Intl.DateTimeFormat("en-US", { timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
        if (formatters.size >= 100)
            formatters.clear();
        formatters.set(timeZone, value);
    }
    return value;
}
function localParts(instant: number, format: Intl.DateTimeFormat) { const values = Object.fromEntries(format.formatToParts(instant).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)])); const date = `${String(values.year).padStart(4, "0")}-${String(values.month).padStart(2, "0")}-${String(values.day).padStart(2, "0")}`; const civil = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) + (instant % 1e3 + 1e3) % 1e3; return { date, weekday: new Date(Date.UTC(values.year, values.month - 1, values.day)).getUTCDay(), minute: values.hour * 60 + values.minute, secondMs: values.second * 1e3 + (instant % 1e3 + 1e3) % 1e3, civil }; }
function walk(calendar: CalendarDefinition, start: Date, target: number, end?: Date) {
    const initial = start.getTime(), limit = end?.getTime() ?? initial + 400 * 864e5;
    (assert)(Number.isFinite(initial) && Number.isFinite(limit) && limit >= initial && Number.isFinite(target) && target >= 0, 422, "SLA_RANGE", "Invalid business calendar interval.");
    const format = formatter(calendar.timeZone), weekdays = new Set(calendar.weekdays), holidays = new Set(calendar.holidays);
    let cursor = initial, remaining = target, counted = 0, steps = 0;
    while (cursor < limit && (end !== void 0 || remaining > 0)) {
        (assert)(++steps < 6e5, 422, "SLA_RANGE", "The requested deadline is outside the supported calendar range.");
        const local = localParts(cursor, format), working = weekdays.has(local.weekday) && !holidays.has(local.date);
        const period = working ? calendar.intervals.find(row => local.minute >= row.startMinute && local.minute < row.endMinute) : void 0;
        const boundary = period?.endMinute ?? (working ? calendar.intervals.find(row => row.startMinute > local.minute)?.startMinute : void 0) ?? 1440;
        let distance = Math.max(1, (boundary - local.minute) * 6e4 - local.secondMs);
        distance = Math.min(distance, limit - cursor);
        const after = localParts(cursor + distance, format);
        if (after.civil - local.civil !== distance)
            distance = Math.min(6e4 - local.secondMs, limit - cursor);
        if (period) {
            if (end === void 0 && remaining <= distance)
                return cursor + remaining;
            counted += distance;
            remaining -= distance;
        }
        cursor += distance;
    }
    if (end !== void 0)
        return counted;
    (assert)(remaining <= 0, 422, "SLA_RANGE", "The configured calendar cannot satisfy this deadline within 400 days.");
    return cursor;
}
function addConfiguredBusinessMinutes(calendar: CalendarDefinition, start: Date, minutes: number) { (assert)(Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= 43200, 422, "SLA_RANGE", "Use between zero and 43200 working minutes."); return addConfiguredBusinessMilliseconds(calendar, start, minutes * 6e4); }
function addConfiguredBusinessMilliseconds(calendar: CalendarDefinition, start: Date, milliseconds: number) {
    (assert)(Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 43200 * 6e4, 422, "SLA_RANGE", "The working-time allowance is out of range.");
    if (milliseconds === 0)
        return new Date(start);
    return new Date(walk(calendar, start, milliseconds));
}
function elapsedBusinessMilliseconds(calendar: CalendarDefinition, start: Date, end: Date) { return walk(calendar, start, 0, end); }
export { addConfiguredBusinessMilliseconds, addConfiguredBusinessMinutes, calendarDefinitionSchema, elapsedBusinessMilliseconds, validCalendarDate };
