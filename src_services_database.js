import { supabase } from './supabase'

// Meal CRUD operations
export const saveMealLog = async (userId, mealData) => {
  const { data, error } = await supabase
    .from('meal_logs')
    .insert({
      user_id: userId,
      timestamp: new Date().toISOString(),
      ...mealData
    })
    .select()

  if (error) throw error
  return data[0]
}

export const getMealLogsToday = async (userId) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('meal_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('timestamp', today.toISOString())
    .order('timestamp', { ascending: false })

  if (error) throw error
  return data
}

export const getMealLogsWeek = async (userId) => {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  weekAgo.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('meal_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('timestamp', weekAgo.toISOString())
    .order('timestamp', { ascending: true })

  if (error) throw error
  return data
}

export const deleteMealLog = async (mealId) => {
  const { error } = await supabase
    .from('meal_logs')
    .delete()
    .eq('id', mealId)

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
export const calculateWeeklyBreakdown = (mealLogs) => {
  const breakdown = {}

  mealLogs.forEach(meal => {
    const date = new Date(meal.timestamp).toLocaleDateString('en-IN')
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
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (existing) return existing

  const { data: created } = await supabase
    .from('users')
    .insert({
      id: userId,
      email,
      goal: 'muscle_gain',
      calorie_target: 2500,
      protein_target: 150,
      subscription_status: 'free',
      scans_used_today: 0
    })
    .select()
    .single()

  return created
}

// Update user profile
export const updateUserProfile = async (userId, updates) => {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Get user profile
export const getUserProfile = async (userId) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

// Increment daily scan counter
export const incrementScanCount = async (userId) => {
  const today = new Date().toLocaleDateString('en-IN')

  const { data: existing } = await supabase
    .from('scan_counters')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single()

  if (existing) {
    const { data } = await supabase
      .from('scan_counters')
      .update({ scan_count: existing.scan_count + 1 })
      .eq('id', existing.id)
      .select()
      .single()
    return data
  } else {
    const { data } = await supabase
      .from('scan_counters')
      .insert({ user_id: userId, date: today, scan_count: 1 })
      .select()
      .single()
    return data
  }
}

// Get scan count for today
export const getScanCountToday = async (userId) => {
  const today = new Date().toLocaleDateString('en-IN')

  const { data } = await supabase
    .from('scan_counters')
    .select('scan_count')
    .eq('user_id', userId)
    .eq('date', today)
    .single()

  return data?.scan_count || 0
}
