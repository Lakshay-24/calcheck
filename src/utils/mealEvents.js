const MEAL_SAVED_EVENT = 'calcheck:meal-saved'

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

export const onMealSaved = (callback) => {
  if (typeof window === 'undefined') return () => {}

  const handler = (event) => {
    callback(event.detail?.meal || null)
  }

  window.addEventListener(MEAL_SAVED_EVENT, handler)
  console.info('[CalCheck] MEAL_EVENTS_LISTENER_ATTACHED', { event: MEAL_SAVED_EVENT })

  return () => window.removeEventListener(MEAL_SAVED_EVENT, handler)
}
