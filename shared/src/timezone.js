import { DEFAULT_SEND_WINDOW, HARD_LIMITS } from './constants.js';

const WEEKDAY_MAP = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

/**
 * Returns local { dayOfWeek, hour, minute } for a Date in the specified IANA timezone.
 * Falls back to UTC if timezone is invalid or omitted.
 */
export function getLocalTimeParts(date = new Date(), timeZone = 'UTC') {
  let validTz = timeZone || 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: validTz });
  } catch {
    validTz = 'UTC';
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: validTz,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const dayOfWeek = WEEKDAY_MAP[map.weekday] ?? date.getUTCDay();
  const hour = Number(map.hour === '24' ? 0 : map.hour);
  const minute = Number(map.minute || 0);

  return { dayOfWeek, hour, minute, timeZone: validTz };
}

/**
 * Checks whether `date` falls within `sendWindow` in the contact's local `timeZone`.
 */
export function isWithinSendWindow(date = new Date(), timeZone = 'UTC', sendWindow = DEFAULT_SEND_WINDOW) {
  const days = Array.isArray(sendWindow?.days) && sendWindow.days.length > 0
    ? sendWindow.days
    : DEFAULT_SEND_WINDOW.days;
  const startHour = typeof sendWindow?.startHour === 'number' ? sendWindow.startHour : DEFAULT_SEND_WINDOW.startHour;
  const endHour = typeof sendWindow?.endHour === 'number' ? sendWindow.endHour : DEFAULT_SEND_WINDOW.endHour;

  const { dayOfWeek, hour } = getLocalTimeParts(date, timeZone);

  if (!days.includes(dayOfWeek)) {
    return false;
  }

  return hour >= startHour && hour < endHour;
}

/**
 * Computes a random pacing delay in milliseconds between 30 seconds and 2 minutes.
 */
export function getRandomPacingMs(
  minSeconds = HARD_LIMITS.MIN_PACING_SECONDS,
  maxSeconds = HARD_LIMITS.MAX_PACING_SECONDS
) {
  const seconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
  return seconds * 1000;
}

/**
 * Finds the next Date (at 15-minute resolution) that falls inside the recipient's sendWindow.
 */
export function getNextValidSendWindowDate(fromDate = new Date(), timeZone = 'UTC', sendWindow = DEFAULT_SEND_WINDOW) {
  const candidate = new Date(fromDate.getTime());
  // Step forward in 15-minute increments up to 14 days to find the next open window
  const maxSteps = 14 * 24 * 4;
  for (let i = 0; i < maxSteps; i++) {
    if (isWithinSendWindow(candidate, timeZone, sendWindow)) {
      return candidate;
    }
    candidate.setTime(candidate.getTime() + 15 * 60 * 1000);
  }
  return candidate;
}
