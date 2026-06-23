import { getLocalDate, parseDatabaseTimestamp } from './timezone'

export const NUTRIENT_KEYS = [
  'fiber_g',
  'calcium_mg',
  'iron_mg',
  'vitamin_d_ug',
  'vitamin_b12_ug',
  'potassium_mg',
  'magnesium_mg',
  'omega3_mg',
  'vitamin_c_mg',
  'sodium_mg',
  'folate_ug',
  'zinc_mg',
  'iodine_ug',
  'selenium_ug',
  'vitamin_a_ug',
  'vitamin_e_mg',
  'vitamin_k_ug'
]

export const VISIBLE_NUTRIENT_KEYS = [
  'fiber_g',
  'omega3_mg',
  'calcium_mg',
  'iron_mg',
  'vitamin_b12_ug',
  'vitamin_c_mg',
  'magnesium_mg',
  'vitamin_d_ug',
  'potassium_mg'
]

const VISIBLE_NUTRIENT_KEY_SET = new Set(VISIBLE_NUTRIENT_KEYS)
const HIDDEN_UNRELIABLE_KEYS = NUTRIENT_KEYS.filter((key) => !VISIBLE_NUTRIENT_KEY_SET.has(key))
const REJECTED_SALT_FOODS = new Set(['salt', 'iodized salt', 'iodised salt'])

const DAILY_TARGETS = {
  fiber_g: { target: 30, label: 'Fibre' },
  calcium_mg: { target: 1000, label: 'Calcium' },
  iron_mg: { target: 11, label: 'Iron' },
  vitamin_d_ug: { target: 15, label: 'Vitamin D' },
  vitamin_b12_ug: { target: 2.4, label: 'Vitamin B12' },
  potassium_mg: { target: 3500, label: 'Potassium' },
  magnesium_mg: { target: 350, label: 'Magnesium' },
  omega3_mg: { target: 1000, label: 'Omega-3' },
  vitamin_c_mg: { target: 80, label: 'Vitamin C' },
  sodium_mg: { target: 2000, label: 'Sodium', upperLimit: true },
  folate_ug: { target: 400, label: 'Folate' },
  zinc_mg: { target: 9, label: 'Zinc' },
  iodine_ug: { target: 150, label: 'Iodine' },
  selenium_ug: { target: 55, label: 'Selenium' },
  vitamin_a_ug: { target: 800, label: 'Vitamin A' },
  vitamin_e_mg: { target: 12, label: 'Vitamin E' },
  vitamin_k_ug: { target: 90, label: 'Vitamin K' }
}

const FOOD_SUGGESTIONS = {
  fiber_g: ['Raspberries', 'Pear', 'Oats', 'Lentils', 'Black beans', 'Chia seeds', 'Broccoli'],
  omega3_mg: ['Chia seeds', 'Flaxseed', 'Walnuts', 'Salmon', 'Sardines'],
  calcium_mg: ['Curd', 'Yoghurt', 'Milk', 'Fortified soy milk', 'Calcium-set tofu', 'Paneer'],
  iron_mg: ['Lentils', 'White beans', 'Tofu', 'Spinach', 'Eggs', 'Lean meat'],
  vitamin_b12_ug: ['Eggs', 'Milk', 'Curd', 'Salmon', 'Tuna'],
  vitamin_c_mg: ['Kiwi', 'Orange', 'Strawberries', 'Red bell pepper', 'Amla', 'Broccoli'],
  magnesium_mg: ['Pumpkin seeds', 'Almonds', 'Cashews', 'Spinach', 'Black beans'],
  vitamin_d_ug: ['Salmon', 'Trout', 'Egg yolks', 'UV-exposed mushrooms', 'Fortified milk'],
  potassium_mg: ['Banana', 'Potato', 'Sweet potato', 'Coconut water', 'Spinach', 'Lentils']
}

const VEGETARIAN_FIRST = new Set([
  'Raspberries',
  'Pear',
  'Oats',
  'Lentils',
  'Black beans',
  'Chia seeds',
  'Broccoli',
  'Flaxseed',
  'Walnuts',
  'Curd',
  'Yoghurt',
  'Milk',
  'Fortified soy milk',
  'Calcium-set tofu',
  'Paneer',
  'White beans',
  'Tofu',
  'Spinach',
  'Eggs',
  'Kiwi',
  'Orange',
  'Strawberries',
  'Red bell pepper',
  'Amla',
  'Pumpkin seeds',
  'Almonds',
  'Cashews',
  'Egg yolks',
  'UV-exposed mushrooms',
  'Fortified milk',
  'Banana',
  'Potato',
  'Sweet potato',
  'Coconut water'
])

const NON_VEGETARIAN_MARKERS = ['chicken', 'fish', 'salmon', 'sardine', 'meat', 'tuna', 'herring', 'trout', 'oyster', 'lean meat']

const toFiniteNumberOrNull = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const getNutritionQuality = (mealLogs = [], timezone) => {
  const meals = Array.isArray(mealLogs) ? mealLogs : []
  const mealsWithNutrients = meals.filter((meal) => meal?.nutrients_json && typeof meal.nutrients_json === 'object')
  const loggedDays = new Set(
    meals.map((meal) => meal.local_date || getLocalDate(parseDatabaseTimestamp(meal.timestamp), meal.timezone || timezone)).filter(Boolean)
  )
  const context = {
    mealCount: meals.length,
    loggedDays: loggedDays.size,
    nutrientMealCount: mealsWithNutrients.length,
    confidence: getAggregateConfidence(mealsWithNutrients)
  }

  if (meals.length === 0) {
    console.info('[CalCheck] NUTRITION_SCORE_WITHHELD_INSUFFICIENT_DATA', {
      reason: 'no-meals',
      meal_count: 0,
      logged_days: 0
    })
    return emptyResult('empty', context)
  }

  if (meals.length < 6 && loggedDays.size < 2) {
    console.info('[CalCheck] NUTRITION_SCORE_WITHHELD_INSUFFICIENT_DATA', {
      reason: 'building-pattern',
      meal_count: meals.length,
      logged_days: loggedDays.size
    })
    return emptyResult('building', context)
  }

  if (mealsWithNutrients.length === 0) {
    console.info('[CalCheck] NUTRITION_SCORE_WITHHELD_INSUFFICIENT_DATA', {
      reason: 'nutrients-missing',
      meal_count: meals.length,
      logged_days: loggedDays.size
    })
    return emptyResult('building', context)
  }

  if (isMostlyLowConfidence(mealsWithNutrients)) {
    console.info('[CalCheck] NUTRITION_SCORE_WITHHELD_LOW_CONFIDENCE', {
      meal_count: meals.length,
      nutrient_meal_count: mealsWithNutrients.length,
      logged_days: loggedDays.size,
      confidence: context.confidence
    })
    return emptyResult('building', { ...context, lowConfidence: true })
  }

  const baselineDays = Math.max(1, loggedDays.size)
  const totals = getNutrientTotals(mealsWithNutrients)
  const hiddenKeysPresent = HIDDEN_UNRELIABLE_KEYS.filter((key) => totals[key] != null)

  hiddenKeysPresent.forEach((key) => {
    console.info('[CalCheck] NUTRITION_HIDDEN_UNRELIABLE_KEY', {
      key,
      label: DAILY_TARGETS[key]?.label || key
    })
  })
  console.info('[CalCheck] NUTRITION_VISIBLE_KEYS_FILTERED', {
    visible_keys: VISIBLE_NUTRIENT_KEYS,
    hidden_keys_present: hiddenKeysPresent
  })

  const insights = VISIBLE_NUTRIENT_KEYS
    .map((key) => {
      const config = DAILY_TARGETS[key]
      const value = totals[key]
      if (value == null) return null
      const percent = value / (config.target * baselineDays)
      if (percent >= 0.75) return null

      return {
        key,
        label: config.label,
        severity: percent < 0.5 ? 'low' : 'moderate',
        confidence: context.confidence,
        percent
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.percent - b.percent)

  const likelyLow = insights.slice(0, 2).map(({ percent, ...insight }) => insight)
  const foodsToAdd = getFoodsToAdd(insights.slice(0, 4), meals)
  let score = 100

  insights.forEach((insight) => {
    score -= insight.severity === 'low' ? 14 : 8
  })

  const result = {
    score: clamp(Math.round(score), 0, 100),
    state: 'active',
    likelyLow,
    foodsToAdd,
    sodiumHigh: false,
    context
  }

  console.info('[CalCheck] FOODS_TO_ADD_GENERATED', {
    foods: foodsToAdd.map((food) => food.name),
    gaps: likelyLow.map((gap) => gap.key),
    vegetarianish: appearsVegetarianish(meals)
  })
  console.info('[CalCheck] NUTRITION_QUALITY_CALCULATED', {
    score: result.score,
    meal_count: meals.length,
    logged_days: loggedDays.size,
    likely_low: likelyLow.map((gap) => gap.key),
    visible_keys: VISIBLE_NUTRIENT_KEYS
  })

  return result
}

const emptyResult = (state, context = {}) => ({
  score: null,
  state,
  likelyLow: [],
  foodsToAdd: [],
  sodiumHigh: false,
  context
})

const getNutrientTotals = (meals) =>
  meals.reduce((totals, meal) => {
    NUTRIENT_KEYS.forEach((key) => {
      const value = toFiniteNumberOrNull(meal.nutrients_json?.[key])
      if (value == null) return
      totals[key] = (totals[key] || 0) + value
    })

    return totals
  }, {})

const getAggregateConfidence = (meals) => {
  const values = meals.map((meal) => meal.nutrient_confidence).filter(Boolean)
  if (values.length === 0) return 'unknown'
  if (values.includes('high')) return 'high'
  if (values.includes('medium')) return 'medium'
  return 'low'
}

const isMostlyLowConfidence = (meals) => {
  const values = meals.map((meal) => meal.nutrient_confidence).filter(Boolean)
  if (values.length === 0) return true
  const lowCount = values.filter((value) => value === 'low').length
  return lowCount / values.length >= 0.6
}

const getFoodsToAdd = (insights, meals) => {
  const vegetarianish = appearsVegetarianish(meals)
  const scores = new Map()

  insights.forEach((insight, index) => {
    const foods = FOOD_SUGGESTIONS[insight.key] || []
    const sortedFoods = vegetarianish
      ? [...foods].sort((a, b) => Number(!VEGETARIAN_FIRST.has(a)) - Number(!VEGETARIAN_FIRST.has(b)))
      : foods

    sortedFoods.forEach((food, foodIndex) => {
      if (isRejectedSaltFood(food)) {
        console.warn('[CalCheck] FOODS_TO_ADD_REJECTED_SALT', {
          food,
          nutrient_key: insight.key
        })
        return
      }

      const previous = scores.get(food) || { name: food, reason: insight.label, score: 0 }
      previous.score += 12 - index * 2 - foodIndex * 0.4
      if (VEGETARIAN_FIRST.has(food)) previous.score += vegetarianish ? 2 : 0.5
      if (!previous.reason.includes(insight.label)) previous.reason = `${previous.reason}, ${insight.label}`
      scores.set(food, previous)
    })
  })

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name, reason }) => ({ name, reason }))
}

const isRejectedSaltFood = (food) => REJECTED_SALT_FOODS.has(String(food || '').trim().toLowerCase())

const appearsVegetarianish = (meals) => {
  const names = meals.map((meal) => String(meal.food_name || '').toLowerCase()).join(' ')
  return !NON_VEGETARIAN_MARKERS.some((marker) => names.includes(marker))
}

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value))