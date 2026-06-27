import { supabase } from './supabase'
import { trackApiRequest } from './diagnostics'
import { logAppError, logAppEvent } from '../utils/appDiagnostics'
import {
  getEndOfLocalDay,
  getEndOfLocalDate,
  getLocalDate,
  getMealTypeForLocalTime,
  getStartOfLocalDate,
  getStartOfLocalDay,
  getUserTimezone,
  parseDatabaseTimestamp
} from '../utils/timezone'

const MEAL_LOG_COLUMNS = [
  'id',
  'user_id',
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
  'meal_type',
  'image_path',
  'image_url',
  'thumbnail_path',
  'thumbnail_url',
  'image_width',
  'image_height',
  'image_size_bytes',
  'image_content_type',
  'image_uploaded_at',
  'source',
  'nutrients_json',
  'nutrient_confidence',
  'nutrient_source',
  'nutrients_estimated_at'
].join(',')

const MEAL_LOG_INTEGER_FIELDS = new Set([
  'calories',
  'protein',
  'carbs',
  'fat',
  'meal_score',
  'image_width',
  'image_height',
  'image_size_bytes'
])
const USER_PROFILE_COLUMNS = [
  'id',
  'created_at',
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

export const uploadMealImage = async (userId, mealId, imagePayload) => {
  if (!imagePayload?.blob) return null

  const imagePath = `${userId}/${mealId}/original.jpg`
  const uploadStartedAt = new Date().toISOString()

  console.info('[CalCheck] MEAL_IMAGE_UPLOAD_START', {
    user_id: userId,
    meal_id: mealId,
    image_path: imagePath,
    image_size_bytes: imagePayload.blob.size || null
  })
  logAppEvent('MEAL_IMAGE_UPLOAD_START', {
    user_id: userId,
    level: 'info',
    screen: 'scan',
    operation: 'meal image upload',
    metadata: {
      meal_id: mealId,
      image_size_bytes: imagePayload.blob.size || null
    }
  })

  const { error } = await trackApiRequest('meal image upload', () => supabase
    .storage
    .from('meal-images')
    .upload(imagePath, imagePayload.blob, {
      cacheControl: '31536000',
      contentType: 'image/jpeg',
      upsert: true
    }))

  if (error) throw error

  const { data: publicUrlData } = supabase
    .storage
    .from('meal-images')
    .getPublicUrl(imagePath)

  const imageUrl = publicUrlData?.publicUrl || null
  const diagnostics = imagePayload.diagnostics || {}
  const imageFields = {
    image_path: imagePath,
    image_url: imageUrl,
    thumbnail_path: imagePath,
    thumbnail_url: imageUrl,
    image_width: toNullableInteger(diagnostics.upload_width),
    image_height: toNullableInteger(diagnostics.upload_height),
    image_size_bytes: toNullableInteger(imagePayload.blob.size || diagnostics.upload_size_bytes),
    image_content_type: 'image/jpeg',
    image_uploaded_at: uploadStartedAt
  }

  console.info('[CalCheck] MEAL_IMAGE_UPLOAD_SUCCESS', {
    user_id: userId,
    meal_id: mealId,
    image_path: imagePath,
    image_width: imageFields.image_width,
    image_height: imageFields.image_height,
    image_size_bytes: imageFields.image_size_bytes,
    has_public_url: Boolean(imageUrl)
  })
  logAppEvent('MEAL_IMAGE_UPLOAD_SUCCESS', {
    user_id: userId,
    level: 'info',
    screen: 'scan',
    operation: 'meal image upload',
    metadata: {
      meal_id: mealId,
      image_width: imageFields.image_width,
      image_height: imageFields.image_height,
      image_size_bytes: imageFields.image_size_bytes,
      has_public_url: Boolean(imageUrl)
    }
  })

  return imageFields
}

const normalizeMealLogIntegerFields = (fields, userId) => {
  const normalized = { ...fields }

  MEAL_LOG_INTEGER_FIELDS.forEach((field) => {
    if (!(field in normalized)) return
    const value = normalized[field]
    if (value == null || value === '') return
    const numberValue = Number(value)

    if (!Number.isFinite(numberValue)) return
    if (Number.isInteger(numberValue)) {
      normalized[field] = numberValue
      return
    }

    logSchemaTypeMismatch(userId, field, value, 'integer')
    normalized[field] = Math.round(numberValue)
  })

  return normalized
}

const logSchemaTypeMismatch = (userId, field, value, expectedType) => {
  console.warn('[CalCheck] MEAL_SAVE_SCHEMA_TYPE_MISMATCH', {
    field,
    value,
    js_type: typeof value,
    expected_db_type: expectedType,
    operation: 'saveMealLog'
  })
  logAppEvent('MEAL_SAVE_SCHEMA_TYPE_MISMATCH', {
    user_id: userId,
    level: 'warn',
    screen: 'scan',
    operation: 'saveMealLog',
    metadata: {
      field,
      value,
      js_type: typeof value,
      expected_db_type: expectedType
    }
  })
}

const toNullableInteger = (value) => {
  if (value == null || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Math.round(numberValue) : null
}
// Meal CRUD operations
export const saveMealLog = async (userId, mealData, options = {}) => {
  const now = new Date()
  const timezone = getUserTimezone()
  const localDate = getLocalDate(now, timezone)
  const mealType = getMealTypeForLocalTime(now, timezone)
  const mealFields = { ...(mealData || {}) }
  delete mealFields.image
  delete mealFields.imageData
  delete mealFields.image_path
  delete mealFields.image_url
  delete mealFields.thumbnail_path
  delete mealFields.thumbnail_url
  delete mealFields.photo_url
  delete mealFields.image_width
  delete mealFields.image_height
  delete mealFields.image_size_bytes
  delete mealFields.image_content_type
  delete mealFields.image_uploaded_at
  const hasNutrients = mealFields.nutrients_json && typeof mealFields.nutrients_json === 'object'
  const nutrientConfidence = ['low', 'medium', 'high'].includes(mealFields.nutrient_confidence)
    ? mealFields.nutrient_confidence
    : null
  const normalizedMealFields = normalizeMealLogIntegerFields(mealFields, userId)
  const insertPayload = {
    ...normalizedMealFields,
    user_id: userId,
    timestamp: now.toISOString(),
    timezone,
    local_date: localDate,
    meal_type: mealType,
    source: options.source || normalizedMealFields.source || null,
    nutrients_json: hasNutrients ? mealFields.nutrients_json : null,
    nutrient_confidence: hasNutrients ? nutrientConfidence : null,
    nutrient_source: hasNutrients ? 'ai_estimate' : null,
    nutrients_estimated_at: hasNutrients ? now.toISOString() : null
  }

  console.info('[CalCheck] saveMealLog integer field validation', {
    calories: insertPayload.calories,
    protein: insertPayload.protein,
    carbs: insertPayload.carbs,
    fat: insertPayload.fat,
    meal_score: insertPayload.meal_score
  })

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

  if (error) {
    logAppError('MEAL_SAVE_FAILED', error, {
      user_id: userId,
      screen: 'scan',
      operation: 'save meal',
      metadata: {
        has_nutrients_json: hasNutrients,
        source: insertPayload.source || null
      }
    })
    throw error
  }

  const insertedMeal = data?.[0] || null
  console.info('[CalCheck] saveMealLog Supabase insert response', {
    id: insertedMeal?.id,
    timezone: insertedMeal?.timezone,
    local_date: insertedMeal?.local_date,
    meal_type: insertedMeal?.meal_type,
    full_row: insertedMeal
  })
  console.info('[CalCheck] NUTRIENT_FIELDS_SAVED', {
    id: insertedMeal?.id || null,
    has_nutrients_json: Boolean(insertedMeal?.nutrients_json),
    nutrient_confidence: insertedMeal?.nutrient_confidence || null
  })

  let savedMeal = insertedMeal

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

    savedMeal = repairedMeal
  }

  if (savedMeal?.id && options.image?.blob) {
    try {
      console.info('[CalCheck] MEAL_IMAGE_PAYLOAD_READY', {
        user_id: userId,
        meal_id: savedMeal.id,
        has_blob: true,
        blob_size: options.image.blob.size || null,
        blob_type: options.image.blob.type || null,
        source: options.source || null
      })
      const imageFields = await uploadMealImage(userId, savedMeal.id, options.image)

      if (imageFields) {
        const { data: mealWithImage, error: imageUpdateError } = await trackApiRequest('meal image fields save', () => supabase
          .from('meal_logs')
          .update(imageFields)
          .eq('id', savedMeal.id)
          .select(MEAL_LOG_COLUMNS)
          .single())

        if (imageUpdateError) throw imageUpdateError

        console.info('[CalCheck] MEAL_IMAGE_FIELDS_SAVED', {
          id: mealWithImage?.id,
          image_path: mealWithImage?.image_path,
          has_image_url: Boolean(mealWithImage?.image_url),
          has_thumbnail_url: Boolean(mealWithImage?.thumbnail_url)
        })

        return mealWithImage
      }
    } catch (imageError) {
      console.warn('[CalCheck] MEAL_IMAGE_UPLOAD_FAILED', {
        user_id: userId,
        meal_id: savedMeal.id,
        error: imageError?.message || String(imageError),
        code: imageError?.code || imageError?.status || null
      })
      logAppError('MEAL_IMAGE_UPLOAD_FAILED', imageError, {
        user_id: userId,
        screen: 'scan',
        operation: 'meal image upload',
        metadata: { meal_id: savedMeal.id }
      })
      logAppError('MEAL_IMAGE_UPLOAD_NON_BLOCKING_FAILURE', imageError, {
        user_id: userId,
        level: 'warn',
        screen: 'scan',
        operation: 'meal image upload',
        metadata: { meal_id: savedMeal.id, meal_save_preserved: true }
      })
    }
  } else if (savedMeal?.id) {
    console.info('[CalCheck] MEAL_IMAGE_PAYLOAD_MISSING', {
      user_id: userId,
      meal_id: savedMeal.id,
      has_options_image: Boolean(options.image),
      has_blob: Boolean(options.image?.blob)
    })
  }

  return savedMeal
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

  console.info('[CalCheck] PROFILE_FETCH_START', {
    user_id: userId,
    email,
    mode: 'get-or-create',
    timezone
  })

  try {
    const { data: existing, error: lookupError } = await trackApiRequest('profile lookup', () => supabase
        .from('users')
        .select(USER_PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle())

    if (lookupError) throw lookupError

    if (existing) {
      if (existing.timezone !== timezone) {
        const updated = await updateUserTimezone(userId, timezone)
        console.info('[CalCheck] PROFILE_FETCH_SUCCESS', {
          user_id: userId,
          mode: 'get-or-create',
          found: true,
          timezone_updated: true
        })
        return updated
      }

      console.info('[CalCheck] PROFILE_FETCH_SUCCESS', {
        user_id: userId,
        mode: 'get-or-create',
        found: true,
        timezone_updated: false
      })
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

    console.info('[CalCheck] PROFILE_FETCH_SUCCESS', {
      user_id: userId,
      mode: 'get-or-create',
      found: false,
      created: true
    })
    return created
  } catch (error) {
    console.error('[CalCheck] PROFILE_FETCH_FAILED', {
      user_id: userId,
      mode: 'get-or-create',
      aborted: error?.name === 'AbortError',
      error
    })
    throw error
  }
}

export const getMealLogsForLocalDateRange = async (
  userId,
  startLocalDate,
  endLocalDate,
  timezone = getUserTimezone(),
  options = {}
) => {
  const rangeStart = getStartOfLocalDate(startLocalDate, timezone)
  const rangeEnd = getEndOfLocalDate(endLocalDate, timezone)

  const { data, error } = await trackApiRequest('history load local date range', () => withAbortSignal(
    supabase
      .from('meal_logs')
      .select(MEAL_LOG_COLUMNS)
      .eq('user_id', userId)
      .gte('timestamp', rangeStart.toISOString())
      .lte('timestamp', rangeEnd.toISOString())
      .order('timestamp', { ascending: false }),
    options.signal
  ))

  if (error) throw error

  return (data || []).filter((meal) => {
    const mealLocalDate = meal.local_date || getLocalDate(parseDatabaseTimestamp(meal.timestamp), meal.timezone || timezone)
    return mealLocalDate >= startLocalDate && mealLocalDate <= endLocalDate
  })
}

export const getFirstMealLog = async (userId, timezone = getUserTimezone(), options = {}) => {
  const { data, error } = await trackApiRequest('first meal load', () => withAbortSignal(
    supabase
      .from('meal_logs')
      .select(MEAL_LOG_COLUMNS)
      .eq('user_id', userId)
      .order('timestamp', { ascending: true })
      .limit(1),
    options.signal
  ))

  if (error) throw error

  const meal = data?.[0] || null
  if (!meal) return null

  return {
    ...meal,
    fallback_anchor_date: meal.local_date
      ? getStartOfLocalDate(meal.local_date, meal.timezone || timezone).toISOString()
      : meal.timestamp
  }
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
  console.info('[CalCheck] PROFILE_FETCH_START', {
    user_id: userId,
    mode: 'load',
    hasAbortSignal: Boolean(options.signal),
    signalAborted: Boolean(options.signal?.aborted)
  })

  try {
    const { data, error } = await trackApiRequest('profile load', () => withAbortSignal(
      supabase
        .from('users')
        .select(USER_PROFILE_COLUMNS)
        .eq('id', userId)
        .single(),
      options.signal
    ))

    if (error) throw error

    console.info('[CalCheck] PROFILE_FETCH_SUCCESS', {
      user_id: userId,
      mode: 'load',
      hasProfile: Boolean(data),
      subscription_status: data?.subscription_status || null,
      is_pro: Boolean(data?.is_pro)
    })
    return data
  } catch (error) {
    console.error('[CalCheck] PROFILE_FETCH_FAILED', {
      user_id: userId,
      mode: 'load',
      aborted: error?.name === 'AbortError' || Boolean(options.signal?.aborted),
      signalAborted: Boolean(options.signal?.aborted),
      error
    })
    throw error
  }
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
