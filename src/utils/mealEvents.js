const MEAL_SAVED_EVENT = 'calcheck:meal-saved'
const MEAL_UPDATED_EVENT = 'calcheck:meal-updated'
const MEAL_DELETED_EVENT = 'calcheck:meal-deleted'

export const emitMealSaved = (savedMeal) => {
  if (!savedMeal || typeof window === 'undefined') return

  console.info('[CalCheck] MEAL_SAVED_REFRESH_EMITTED', {
    id: savedMeal.id || null,
    local_date: savedMeal.local_date || null,
    meal_type: savedMeal.meal_type || null
  })
  console.info('[CalCheck] MEAL_SAVED_EVENT_PAYLOAD_IMAGE_FIELDS', {
    id: savedMeal.id || null,
    hasImageUrl: Boolean(savedMeal.image_url),
    hasThumbnailUrl: Boolean(savedMeal.thumbnail_url),
    image_url: savedMeal.image_url || null,
    thumbnail_url: savedMeal.thumbnail_url || null
  })

  window.dispatchEvent(new CustomEvent(MEAL_SAVED_EVENT, { detail: { meal: savedMeal } }))
}

export const emitMealUpdated = (updatedMeal) => {
  if (!updatedMeal || typeof window === 'undefined') return

  console.info('[CalCheck] MEAL_UPDATED_REFRESH_EMITTED', {
    id: updatedMeal.id || null,
    local_date: updatedMeal.local_date || null,
    meal_type: updatedMeal.meal_type || null
  })

  window.dispatchEvent(new CustomEvent(MEAL_UPDATED_EVENT, { detail: { meal: updatedMeal } }))
}

export const emitMealDeleted = (deletedMeal) => {
  if (!deletedMeal?.id || typeof window === 'undefined') return

  console.info('[CalCheck] MEAL_DELETED_REFRESH_EMITTED', {
    id: deletedMeal.id,
    local_date: deletedMeal.local_date || null,
    meal_type: deletedMeal.meal_type || null
  })

  window.dispatchEvent(new CustomEvent(MEAL_DELETED_EVENT, { detail: { meal: deletedMeal } }))
}

export const onMealSaved = (callback) => subscribeMealEvent(MEAL_SAVED_EVENT, callback)
export const onMealUpdated = (callback) => subscribeMealEvent(MEAL_UPDATED_EVENT, callback)
export const onMealDeleted = (callback) => subscribeMealEvent(MEAL_DELETED_EVENT, callback)

const subscribeMealEvent = (eventName, callback) => {
  if (typeof window === 'undefined') return () => {}

  const handler = (event) => {
    callback(event.detail?.meal || null)
  }

  window.addEventListener(eventName, handler)
  console.info('[CalCheck] MEAL_EVENTS_LISTENER_ATTACHED', { event: eventName })

  return () => window.removeEventListener(eventName, handler)
}