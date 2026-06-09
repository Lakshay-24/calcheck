import React, { useState, useEffect } from 'react'
import { Camera, Upload } from 'lucide-react'
import CameraModal from '../components/CameraModal'
import { getMealLogsToday, calculateDailyTotals } from '../services/database'

export default function ScanScreen({ user }) {
  const [meals, setMeals] = useState([])
  const [totals, setTotals] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [goals] = useState({ calories: 2500, protein: 150 })
  const [cameraOpen, setCameraOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // Fetch today's meals if user is logged in
  useEffect(() => {
    if (user?.id) {
      loadTodaysMeals()
    }
  }, [user])

  const loadTodaysMeals = async () => {
    try {
      setLoading(true)
      const mealLogs = await getMealLogsToday(user.id)
      setMeals(mealLogs)
      setTotals(calculateDailyTotals(mealLogs))
    } catch (error) {
      console.error('Error loading meals:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleMealSaved = () => {
    // Reload meals after saving
    if (user?.id) {
      loadTodaysMeals()
    }
  }

  const caloriePercent = Math.round((totals.calories / goals.calories) * 100)
  const proteinPercent = Math.round((totals.protein / goals.protein) * 100)

  return (
    <div className="h-full w-full bg-white overflow-y-auto pb-24">
      {/* Camera Modal */}
      <CameraModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        user={user}
        onMealSaved={handleMealSaved}
      />

      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 z-10">
        <h1 className="text-2xl font-bold text-gray-900">Scan Food</h1>
        <p className="text-sm text-gray-500 mt-1">Track your nutrition instantly</p>
      </div>

      {/* Main Content */}
      <div className="px-6 py-6 space-y-6">
        {/* CTA Buttons Section */}
        <div className="space-y-3">
          {/* Primary CTA: Open Camera */}
          <button
            onClick={() => setCameraOpen(true)}
            className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-4 px-6 rounded-2xl shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-center gap-3 active:scale-95"
          >
            <Camera size={24} />
            <span>Open Camera</span>
          </button>

          {/* Secondary CTA: Upload Image */}
          <label className="w-full bg-gray-50 hover:bg-gray-100 border-2 border-gray-200 text-gray-900 font-semibold py-4 px-6 rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 cursor-pointer active:scale-95">
            <Upload size={24} />
            <span>Upload Image</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                // Handle file upload
                const file = e.target.files?.[0]
                if (file) {
                  const reader = new FileReader()
                  reader.onload = (event) => {
                    // Could trigger camera modal with image
                    setCameraOpen(true)
                  }
                  reader.readAsDataURL(file)
                }
              }}
            />
          </label>
        </div>

        {/* Today's Progress Card */}
        <div className="bg-gradient-to-br from-green-50 to-transparent border border-green-100 rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Today's Progress</h2>
            <span className="text-xs font-semibold text-green-600 bg-green-100 px-3 py-1 rounded-full">
              {new Date().toLocaleDateString('en-IN', { weekday: 'short' })}
            </span>
          </div>

          {/* Calories */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Calories</span>
              <span className="text-sm font-bold text-gray-900">
                {totals.calories} / {goals.calories}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-green-400 to-green-600 h-full transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(caloriePercent, 100)}%` }}
              ></div>
            </div>
            <p className="text-xs text-gray-500">
              {goals.calories - totals.calories > 0
                ? `${goals.calories - totals.calories} kcal remaining`
                : `${Math.abs(goals.calories - totals.calories)} kcal over`}
            </p>
          </div>

          {/* Protein */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Protein</span>
              <span className="text-sm font-bold text-gray-900">
                {totals.protein}g / {goals.protein}g
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all duration-500 rounded-full"
                style={{ width: `${Math.min(proteinPercent, 100)}%` }}
              ></div>
            </div>
            <p className="text-xs text-gray-500">
              {goals.protein - totals.protein > 0
                ? `${goals.protein - totals.protein}g more`
                : `Goal met!`}
            </p>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-green-200">
            <div className="space-y-1">
              <p className="text-xs text-gray-600">Carbs</p>
              <p className="text-lg font-bold text-gray-900">{totals.carbs}g</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-600">Fat</p>
              <p className="text-lg font-bold text-gray-900">{totals.fat}g</p>
            </div>
          </div>
        </div>

        {/* Empty State or Meals List */}
        {meals.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="text-3xl">📷</span>
            </div>
            <p className="text-gray-600 font-medium mb-1">No meals today yet</p>
            <p className="text-sm text-gray-500">Tap "Open Camera" to start tracking</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Today's Meals</h3>
            {meals.map((meal) => (
              <div
                key={meal.id}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between hover:border-green-300 transition-colors"
              >
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{meal.food_name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {meal.calories} kcal • {meal.protein}g protein
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">{meal.meal_score}</div>
                  <div className="text-xs text-gray-500">score</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
