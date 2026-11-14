#!/usr/bin/env node
// Berlin times at which backend tests are run ahead of the calendar (#4027).
//
//   node scripts/clock-boundaries.mjs [unix-seconds]   upcoming times (default: from now)
//   node scripts/clock-boundaries.mjs --at 2027-04-20T00:30   Unix seconds of a Berlin time
//
// The first form prints one "YYYY-MM-DDTHH:MM<TAB>reason" line per time,
// sorted. The early-warning run (.github/workflows/clock-early-warning.yml)
// runs the backend suite at each of them through scripts/fake-clock.sh, so a
// test that depends on the day fails there before the day comes. The times are
// the boundaries that broke tests before: a Berlin day that is not yet the UTC
// day (00:30), the weekend and the ISO week, the clock changes, the new year,
// the public holidays of Nordrhein-Westfalen and dates far enough ahead to
// pass fixed fixture dates.
import { addDays, berlinInstant, nrwHolidays } from './seed-smoke-clock.mjs';

const EARLY = { hour: 0, minute: 30 };
const NOON = { hour: 12, minute: 0 };
const LATE = { hour: 23, minute: 30 };
const HOLIDAYS_AHEAD = 3;
const OFFSETS = [30, 90, 365];
const PATTERN = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/;

const berlinDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
});

function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

// Minutes Berlin is ahead of UTC at a wall-clock time of a date.
function utcOffset(date, time) {
  const wall = Date.parse(`${date}T00:00:00Z`) + (time.hour * 60 + time.minute) * 60000;
  return (wall - berlinInstant(date, time)) / 60000;
}

function nextDate(today, predicate) {
  for (let date = addDays(today, 1), i = 0; i < 400; date = addDays(date, 1), i++) {
    if (predicate(date)) return date;
  }
  throw new Error(`no matching date within 400 days of ${today}`);
}

function upcomingHolidays(today, count) {
  const year = Number(today.slice(0, 4));
  return [...nrwHolidays(year), ...nrwHolidays(year + 1)]
    .filter(date => date > today)
    .sort()
    .slice(0, count);
}

function stamp(date, time) {
  return `${date}T${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export function clockBoundaries(nowMs) {
  const today = berlinDate.format(new Date(nowMs));
  const times = new Map();
  const add = (date, time, reason) => {
    const key = stamp(date, time);
    times.set(key, [...(times.get(key) ?? []), reason]);
  };
  add(addDays(today, 1), EARLY, 'Berliner Tag vor dem UTC-Tag');
  add(nextDate(today, date => weekday(date) === 6), EARLY, 'Samstag');
  add(nextDate(today, date => weekday(date) === 0), LATE, 'Sonntagabend vor der neuen ISO-Woche');
  const change = nextDate(today, date => utcOffset(date, EARLY) !== utcOffset(date, NOON));
  add(change, EARLY, 'Tag der Zeitumstellung');
  add(addDays(change, 1), EARLY, 'Tag nach der Zeitumstellung');
  add(nextDate(today, date => date.endsWith('-01-01')), EARLY, 'Neujahr');
  // The day before catches tests that plan for tomorrow; a holiday right
  // after another one is already covered by the first.
  const holidays = upcomingHolidays(today, HOLIDAYS_AHEAD);
  for (const holiday of holidays) {
    const before = addDays(holiday, -1);
    if (!holidays.includes(before)) add(before, NOON, `Tag vor dem Feiertag ${holiday}`);
    add(holiday, EARLY, 'Feiertag in NRW');
  }
  for (const days of OFFSETS) add(addDays(today, days), EARLY, `heute + ${days} Tage`);
  return [...times].sort(([a], [b]) => a.localeCompare(b))
    .map(([at, reasons]) => ({ at, reason: reasons.join(', ') }));
}

export function berlinSeconds(text) {
  const match = PATTERN.exec(text);
  if (!match) throw new Error(`not YYYY-MM-DD[THH:MM]: ${text}`);
  const [, date, hour = '0', minute = '0'] = match;
  return Math.floor(berlinInstant(date, { hour: Number(hour), minute: Number(minute) }) / 1000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [first, second] = process.argv.slice(2);
  try {
    if (first === '--at') {
      console.log(berlinSeconds(second ?? ''));
    } else if (first === undefined || /^\d+$/.test(first)) {
      const nowMs = first === undefined ? Date.now() : Number(first) * 1000;
      for (const { at, reason } of clockBoundaries(nowMs)) console.log(`${at}\t${reason}`);
    } else {
      throw new Error('usage: clock-boundaries.mjs [unix-seconds] | --at YYYY-MM-DD[THH:MM]');
    }
  } catch (error) {
    console.error(`clock-boundaries: ${error.message}`);
    process.exit(2);
  }
}
