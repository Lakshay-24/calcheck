import { supabase } from './supabase'
import { trackApiRequest } from './diagnostics'
import {
  getEndOfLocalDay,
  getLocalDate,
  getMealTypeForLocalTime,
  getStartOfLocalDay,
  getUserTimezone,
  parseDatabaseTimestamp
} from '../utils/timezone'

const MEAL_LOG_COLUMNS = [
  'id',
  'food_name',
  'calories',
  'protein',
  'carbs',
  'fat',
  'meal_score',
  'protein_level',
  'recommended_for',
  'portion_size',
  'estimated_grams',
  'portion_confidence',
  'confidence',
  'portion_multiplier',
  'timestamp',
  'timezone',
  'local_date',
  'meal_type'
].join(',')

const USER_PROFILE_COLUMNS = [
  'id',
  'email',
  'goal',
  'calorie_target',
  'protein_target',
  'subscription_status',
  'is_pro',
  'scans_used_today',
  'timezone',
  'timezone_updated_at',
  'razorpay_subscription_id',
  'subscription_currency',
  'current_period_end',
  'subscription_cancel_at_period_end'
].join(',')

const withAbortSignal = (query, signal) =>
  signal ? query.abortSignal(signal) : query

// Meal CRUD operations
export const saveMealLog = async (userId, mealData) => {
  const now = new Date()
  const timezone = getUserTimezone()
  const localDate = getLocalDate(now, timezone)
  const mealType = getMealTypeForLocalTime(now, timezone)
  const insertPayload = {
    ...mealData,
    user_id: userId,
    timestamp: now.toISOString(),
    timezone,
    local_date: localDate,
    meal_type: mealType
  }

  console.info('[CalCheck] saveMealLog timezone detection', {
    intl_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    helper_timezone: timezone,
    local_date: localDate,
    meal_type: mealType,
    timestamp: insertPayload.timestamp
  })

  console.info('[CalCheck] saveMealLog final insert payload', {
    ...insertPayload,
    candidates: Array.isArray(insertPayload.candidates)
      ? `[${insertPayload.candidates.length} candidates]`
      : insertPayload.candidates
  })

  const { data, error } = await trackApiRequest('save meal', () => supabase
    .from('meal_logs')
    .insert(insertPayload)
    .select(MEAL_LOG_COLUMNS))

  if (error) throw error

  const insertedMeal = data?.[0] || null
  console.info('[CalCheck] saveMealLog Supabase insert response', {
    id: insertedMeal?.id,
    timezone: insertedMeal?.timezone,
    local_date: insertedMeal?.local_date,
    meal_type: insertedMeal?.meal_type,
    full_row: insertedMeal
  })

  if (
    insertedMeal?.id &&
    (!insertedMeal.timezone || !insertedMeal.local_date || !insertedMeal.meal_type)
  ) {
    console.warn('[CalCheck] saveMealLog timezone fields missing after insert; repairing row', {
      id: insertedMeal.id,
      timezone,
      local_date: localDate,
      meal_type: mealType
    })

    const { data: repairedMeal, error: repairError } = await trackApiRequest('save meal repair', () => supabase
        .from('meal_logs')
        .update({
          timezone,
          local_date: localDate,
          meal_type: mealType
        })
        .eq('id', insertedMeal.id)
        .select(MEAL_LOG_COLUMNS)
        .single())

    if (repairError) throw repairError

    console.info('[CalCheck] saveMealLog repair response', {
      id: repairedMeal?.id,
      timezone: repairedMeal?.timezone,
      local_date: repairedMeal?.local_date,
      meal_type: repairedMeal?.meal_type,
      full_row: repairedMeal
    })

    return repairedMeal
  }

  return insertedMeal
}

export const getMealLogsToday = async (userId, timezone = getUserTimezone(), options = {}) => {
  const startOfDay = getStartOfLocalDay(new Date(), timezone)
  const endOfDay = getEndOfLocalDay(new Date(), timezone)

  const { data, error } = await trackApiRequest('history load today', () => withAbortSignal(
    supabase
      .from('meal_logs')
      .select(MEAL_LOG_COLUMNS)
      .eq('user_id', userId)
      .gte('timestamp', startOfDay.toISOString())
      .lte('timestamp', endOfDay.toISOString())
      .order('timestamp', { ascending: false }),
    options.signal
  ))

  if (error) throw error
  return data
}

export const getMealLogsWeek = async (userId, timezone = getUserTimezone(), options = {}) => {
  const today = new Date()
  const weekStart = new Date(getStartOfLocalDay(today, timezone))
  weekStart.setUTCDate(weekStart.getUTCDate() - 6)
  const endOfToday = getEndOfLocalDay(today, timezone)

  const { data, error } = await trackApiRequest('history load week', () => withAbortSignal(
    supabase
      .from('meal_logs')
      .select(MEAL_LOG_COLUMNS)
      .eq('user_id', userId)
      .gte('timestamp', weekStart.toISOString())
      .lte('timestamp', endOfToday.toISOString())
      .order('timestamp', { ascending: true }),
    options.signal
  ))

  if (error) throw error
  return data
}

export const deleteMealLog = async (mealId) => {
  const { error } = await trackApiRequest('delete meal', () => supabase
      .from('meal_logs')
      .delete()
      .eq('id', mealId))

  if (error) throw error
}

// Calculate daily totals
export const calculateDailyTotals = (mealLogs) => {
  return mealLogs.reduce((totals, meal) => ({
    calories: totals.calories + (meal.calories || 0),
    protein: totals.protein + (meal.protein || 0),
    carbs: totals.carbs + (meal.carbs || 0),
    fat: totals.fat + (meal.fat || 0)
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
}

// Calculate weekly totals by day
export const calculateWeeklyBreakdown = (mealLogs, timezone = getUserTimezone()) => {
  const breakdown = {}

  mealLogs.forEach(meal => {
    const date = meal.local_date || getLocalDate(parseDatabaseTimestamp(meal.timestamp), meal.timezone || timezone)
    if (!breakdown[date]) {
      breakdown[date] = { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 }
    }
    breakdown[date].calories += meal.calories || 0
    breakdown[date].protein += meal.protein || 0
    breakdown[date].carbs += meal.carbs || 0
    breakdown[date].fat += meal.fat || 0
    breakdown[date].count += 1
  })

  return breakdown
}

// Get or create user profile
export const getOrCreateUserProfile = async (userId, email) => {
  const timezone = getUserTimezone()

  const { data: existing } = await trackApiRequest('profile lookup', () => supabase
      .from('users')
      .select(USER_PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle())

  if (existing) {
    if (existing.timezone !== timezone) {
      return updateUserTimezone(userId, timezone)
    }

    return existing
  }

  const { data: created, error } = await trackApiRequest('profile create', () => supabase
      .from('users')
      .insert({
        id: userId,
        email,
        goal: 'muscle_gain',
        calorie_target: 2500,
        protein_target: 150,
        subscription_status: 'free',
        is_pro: false,
        scans_used_today: 0,
        timezone,
        timezone_updated_at: new Date().toISOString()
      })
      .select(USER_PROFILE_COLUMNS)
      .single())

  if (error) throw error
  return created
}

// Update user profile
export const updateUserProfile = async (userId, updates) => {
  const { data, error } = await trackApiRequest('profile update', () => supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select(USER_PROFILE_COLUMNS)
      .single())

  if (error) throw error
  return data
}

export const updateUserTimezone = async (userId, timezone = getUserTimezone()) => {
  const { data, error } = await trackApiRequest('profile timezone update', () => supabase
      .from('users')
      .update({
        timezone,
        timezone_updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select(USER_PROFILE_COLUMNS)
      .single())

  if (error) throw error
  return data
}

// Get user profile
export const getUserProfile = async (userId, options = {}) => {
  const { data, error } = await trackApiRequest('profile load', () => withAbortSignal(
    supabase
      .from('users')
      .select(USER_PROFILE_COLUMNS)
      .eq('id', userId)
      .single(),
    options.signal
  ))

  if (error) throw error
  return data
}

export const isUserPro = (profile) => {
  return Boolean(profile?.is_pro)
}

// Increment daily scan counter
export const incrementScanCount = async (userId) => {
  const today = getLocalDate(new Date(), getUserTimezone())

  const { data: existing, error: lookupError } = await trackApiRequest('scan counter lookup', () => supabase
      .from('scan_counters')
      .select('id,scan_count')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle())

  if (lookupError) throw lookupError

  if (existing) {
    const { data, error } = await trackApiRequest('scan counter update', () => supabase
        .from('scan_counters')
        .update({ scan_count: existing.scan_count + 1 })
        .eq('id', existing.id)
        .select('id,scan_count')
        .single())

    if (error) throw error
    return data
  } else {
    const { data, error } = await trackApiRequest('scan counter create', () => supabase
        .from('scan_counters')
        .insert({ user_id: userId, date: today, scan_count: 1 })
        .select('id,scan_count')
        .single())

    if (error) throw error
    return data
  }
}

// Get scan count for today
export const getScanCountToday = async (userId) => {
  const today = getLocalDate(new Date(), getUserTimezone())

  const { data } = await trackApiRequest('scan counter today load', () => supabase
      .from('scan_counters')
      .select('scan_count')
      .eq('user_id', userId)
      .eq('date', today)
      .single())

  return data?.scan_count || 0
}

export const getLifetimeScanCount = async (userId) => {
  const { data, error } = await trackApiRequest('lifetime scan count load', () => supabase
      .from('scan_counters')
      .select('scan_count')
      .eq('user_id', userId))

  if (error) throw error

  return (data || []).reduce((total, row) => total + (row.scan_count || 0), 0)
}
