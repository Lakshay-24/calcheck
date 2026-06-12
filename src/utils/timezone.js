export const getUserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const getDateParts = (date = new Date(), timeZone = getUserTimezone()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)

  return parts.reduce((values, part) => {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value)
    }

    return values
  }, {})
}

export const getLocalDate = (date = new Date(), timeZone = getUserTimezone()) => {
  const parts = getDateParts(date, timeZone)
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0')
  ].join('-')
}

const getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = getDateParts(date, timeZone)
  const utcTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second
  )

  return utcTime - date.getTime()
}

const zonedTimeToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) => {
  const wallTime = Date.UTC(year, month - 1, day, hour, minute, second)
  let utcDate = new Date(wallTime)

  for (let i = 0; i < 3; i += 1) {
    utcDate = new Date(wallTime - getTimeZoneOffsetMs(utcDate, timeZone))
  }

  return utcDate
}

const addDaysToLocalDate = (localDate, days) => {
  const [year, month, day] = localDate.split('-').map(Number)
  const utcDate = new Date(Date.UTC(year, month - 1, day + days))

  return [
    utcDate.getUTCFullYear(),
    String(utcDate.getUTCMonth() + 1).padStart(2, '0'),
    String(utcDate.getUTCDate()).padStart(2, '0')
  ].join('-')
}

export const getStartOfLocalDay = (date = new Date(), timeZone = getUserTimezone()) => {
  const [year, month, day] = getLocalDate(date, timeZone).split('-').map(Number)
  return zonedTimeToUtc({ year, month, day }, timeZone)
}

export const getEndOfLocalDay = (date = new Date(), timeZone = getUserTimezone()) => {
  const nextLocalDate = addDaysToLocalDate(getLocalDate(date, timeZone), 1)
  const [year, month, day] = nextLocalDate.split('-').map(Number)

  return new Date(zonedTimeToUtc({ year, month, day }, timeZone).getTime() - 1)
}

export const isSameLocalDay = (a, b = new Date(), timeZone = getUserTimezone()) => {
  return getLocalDate(a, timeZone) === getLocalDate(b, timeZone)
}

export const getMealTypeForLocalTime = (date = new Date(), timeZone = getUserTimezone()) => {
  const { hour } = getDateParts(date, timeZone)

  if (hour >= 5 && hour < 11) return 'Breakfast'
  if (hour >= 11 && hour < 16) return 'Lunch'
  if (hour >= 16 && hour < 22) return 'Dinner'
  return 'Snack'
}

export const formatLocalTime = (date, timeZone = getUserTimezone()) => {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date))
}

export const formatLocalWeekday = (date = new Date(), timeZone = getUserTimezone()) => {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short'
  }).format(date)
}
