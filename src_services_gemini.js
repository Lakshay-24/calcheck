// Google Gemini Vision API integration
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

if (!GEMINI_API_KEY) {
  throw new Error('Missing GEMINI_API_KEY environment variable')
}

// Compress image to reduce size before sending to Gemini
const compressImage = async (base64Image) => {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let width = img.width
      let height = img.height

      // Scale down if too large
      const maxWidth = 1024
      const maxHeight = 1024
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height)
        width *= ratio
        height *= ratio
      }

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1])
    }
    img.src = base64Image
  })
}

export const analyzeFood = async (imageData) => {
  try {
    const compressedBase64 = await compressImage(imageData)

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Analyze this food image and provide exact nutritional information for a typical serving.
                  
Return ONLY a valid JSON object with these exact fields (no other text):
{
  "food_name": "Name of the food",
  "calories": number (total calories for serving),
  "protein": number (grams of protein),
  "carbs": number (grams of carbs),
  "fat": number (grams of fat),
  "meal_score": number (0-100, where 100 = perfect macro balance),
  "protein_level": "High" (>30g) or "Medium" (15-30g) or "Low" (<15g),
  "recommended_for": "Fat Loss" or "Muscle Gain" or "Maintenance"
}

Rules:
- Be realistic with portion sizes (assume medium serving)
- For Indian cuisine, account for typical oil/ghee usage
- Only return JSON, no markdown or extra text
- Ensure valid JSON format`
                },
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: compressedBase64
                  }
                }
              ]
            }
          ]
        })
      }
    )

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`)
    }

    const data = await response.json()
    const textContent = data.candidates[0].content.parts[0].text

    // Extract JSON from response (handle potential markdown formatting)
    const jsonMatch = textContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate response format
    const required = ['food_name', 'calories', 'protein', 'carbs', 'fat', 'meal_score', 'protein_level', 'recommended_for']
    for (const field of required) {
      if (!(field in parsed)) {
        throw new Error(`Missing required field: ${field}`)
      }
    }

    // Ensure numeric values
    parsed.calories = Number(parsed.calories)
    parsed.protein = Number(parsed.protein)
    parsed.carbs = Number(parsed.carbs)
    parsed.fat = Number(parsed.fat)
    parsed.meal_score = Math.min(100, Math.max(0, Number(parsed.meal_score)))

    return parsed
  } catch (error) {
    console.error('Food analysis error:', error)
    throw new Error('Failed to analyze food image. Please try again.')
  }
}
