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
  omega3_mg: ['Chia seeds', 'Flaxseed', 'Walnuts', 'Salmon', 'Sardines', 'Herring'],
  calcium_mg: ['Curd', 'Yoghurt', 'Milk', 'Fortified soy milk', 'Calcium-set tofu', 'Sardines with bones', 'Paneer'],
  vitamin_c_mg: ['Kiwi', 'Orange', 'Strawberries', 'Red bell pepper', 'Amla', 'Broccoli'],
  magnesium_mg: ['Pumpkin seeds', 'Almonds', 'Cashews', 'Spinach', 'Black beans', 'Edamame'],
  vitamin_d_ug: ['Salmon', 'Trout', 'Egg yolks', 'UV-exposed mushrooms', 'Fortified milk', 'Fortified soy milk'],
  iron_mg: ['Lentils', 'White beans', 'Tofu', 'Spinach', 'Eggs', 'Lean meat', 'Fortified cereal', 'Kiwi', 'Orange', 'Red bell pepper', 'Tomatoes'],
  vitamin_b12_ug: ['Eggs', 'Milk', 'Curd', 'Salmon', 'Tuna', 'Fortified nutritional yeast'],
  folate_ug: ['Spinach', 'Lentils', 'Chickpeas', 'Asparagus', 'Avocado'],
  zinc_mg: ['Pumpkin seeds', 'Chickpeas', 'Cashews', 'Eggs', 'Meat', 'Oysters'],
  iodine_ug: ['Iodized salt', 'Curd', 'Milk', 'Eggs', 'Seaweed'],
  selenium_ug: ['Brazil nuts', 'Eggs', 'Tuna', 'Sardines', 'Sunflower seeds'],
  vitamin_a_ug: ['Carrot', 'Sweet potato', 'Spinach', 'Pumpkin', 'Eggs'],
  vitamin_e_mg: ['Almonds', 'Sunflower seeds', 'Peanut butter', 'Avocado', 'Spinach'],
  vitamin_k_ug: ['Spinach', 'Kale', 'Broccoli', 'Cabbage', 'Lettuce']
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
  'Kiwi',
  'Orange',
  'Strawberries',
  'Red bell pepper',
  'Amla',
  'Pumpkin seeds',
  'Almonds',
  'Cashews',
  'Spinach',
  'Edamame',
  'Egg yolks',
  'UV-exposed mushrooms',
  'Fortified milk',
  'White beans',
  'Tofu',
  'Eggs',
  'Fortified cereal',
  'Tomatoes',
  'Fortified nutritional yeast',
  'Chickpeas',
  'Asparagus',
  'Avocado',
  'Iodized salt',
  'Seaweed',
  'Brazil nuts',
  'Sunflower seeds',
  'Carrot',
  'Sweet potato',
  'Pumpkin',
  'Peanut butter',
  'Kale',
  'Cabbage',
  'Lettuce'
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

  if (meals.length === 0) {
    console.info('[CalCheck] NUTRITION_QUALITY_INSUFFICIENT_DATA', {
      reason: 'no-meals',
      meal_count: 0,
      logged_days: 0
    })
    return emptyResult('empty')
  }

  if (meals.length < 6 && loggedDays.size < 2) {
    console.info('[CalCheck] NUTRITION_QUALITY_INSUFFICIENT_DATA', {
      reason: 'building-pattern',
      meal_count: meals.length,
      logged_days: loggedDays.size
    })
    return emptyResult('building')
  }

  if (mealsWithNutrients.length === 0) {
    console.info('[CalCheck] NUTRITION_QUALITY_INSUFFICIENT_DATA', {
      reason: 'nutrients-missing',
      meal_count: meals.length,
      logged_days: loggedDays.size
    })
    return emptyResult('building')
  }

  const baselineDays = Math.max(1, loggedDays.size)
  const totals = getNutrientTotals(mealsWithNutrients)
  const insights = NUTRIENT_KEYS
    .filter((key) => key !== 'sodium_mg')
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
        confidence: getAggregateConfidence(mealsWithNutrients),
        percent
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.percent - b.percent)

  const sodiumTotal = totals.sodium_mg
  const sodiumHigh = sodiumTotal != null && sodiumTotal > DAILY_TARGETS.sodium_mg.target * baselineDays * 1.15
  const likelyLow = insights.slice(0, 2).map(({ percent, ...insight }) => insight)
  const foodsToAdd = getFoodsToAdd(insights.slice(0, 4), meals)
  let score = 100

  insights.forEach((insight) => {
    score -= insight.severity === 'low' ? 14 : 8
  })

  if (sodiumHigh) score -= 6

  const result = {
    score: clamp(Math.round(score), 0, 100),
    state: 'active',
    likelyLow,
    foodsToAdd,
    sodiumHigh
  }

  console.info('[CalCheck] FOODS_TO_ADD_GENERATED', {
    foods: foodsToAdd.map((food) => food.name),
    gaps: likelyLow.map((gap) => gap.key)
  })
  console.info('[CalCheck] NUTRITION_QUALITY_CALCULATED', {
    score: result.score,
    meal_count: meals.length,
    logged_days: loggedDays.size,
    likely_low: likelyLow.map((gap) => gap.key),
    sodium_high: sodiumHigh
  })

  return result
}

const emptyResult = (state) => ({
  score: null,
  state,
  likelyLow: [],
  foodsToAdd: [],
  sodiumHigh: false
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
  if (values.includes('high')) return 'high'
  if (values.includes('medium')) return 'medium'
  return 'low'
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
      const previous = scores.get(food) || { name: food, reason: insight.label, score: 0 }
      previous.score += 12 - index * 2 - foodIndex * 0.4
      if (!previous.reason.includes(insight.label)) previous.reason = `${previous.reason}, ${insight.label}`
      scores.set(food, previous)
    })
  })

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name, reason }) => ({ name, reason }))
}

const appearsVegetarianish = (meals) => {
  const names = meals.map((meal) => String(meal.food_name || '').toLowerCase()).join(' ')
  return !NON_VEGETARIAN_MARKERS.some((marker) => names.includes(marker))
}

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, value))
