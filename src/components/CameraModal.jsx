import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useCamera } from '../hooks/useCamera'
import { analyzeFood } from '../services/ai'
import { saveMealLog, getOrCreateUserProfile } from '../services/database'
import { signInWithGoogle } from '../services/supabase'
import AnalysisScreen from './AnalysisScreen'
import ResultsScreen from './ResultsScreen'

const PENDING_MEAL_KEY = 'calcheck-pending-meal'

export const getPendingMeal = () => {
  try {
    const raw = sessionStorage.getItem(PENDING_MEAL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const clearPendingMeal = () => {
  sessionStorage.removeItem(PENDING_MEAL_KEY)
}

export const storePendingMeal = (result, image) => {
  sessionStorage.setItem(PENDING_MEAL_KEY, JSON.stringify({ result, image }))
}

export default function CameraModal({ isOpen, onClose, user, onMealSaved, pendingImage = null }) {
  const [stage, setStage] = useState('camera')
  const [capturedImage, setCapturedImage] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [error, setError] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  const { videoRef, canvasRef, isActive, setIsActive, capturePhoto, hasPermission, requestPermission } = useCamera()

  useEffect(() => {
    if (!isOpen) {
      setIsActive(false)
      return
    }

    setError(null)
    setStage('camera')
    setCapturedImage(null)
    setAnalysisResult(null)

    if (pendingImage) {
      setCapturedImage(pendingImage)
      analyzePhoto(pendingImage)
      return
    }

    if (hasPermission === null) {
      requestPermission()
    }
  }, [isOpen, pendingImage])

  const analyzePhoto = async (base64Image) => {
    try {
      setError(null)
      setStage('analysis')
      const result = await analyzeFood(base64Image)
      setAnalysisResult(result)
      setStage('results')
    } catch (err) {
      setError(err.message || 'Failed to analyze food image. Please try again.')
      setStage('camera')
      setCapturedImage(null)
    }
  }

  const handleCapture = () => {
    const photo = capturePhoto()
    if (photo) {
      setCapturedImage(photo)
      setIsActive(false)
      analyzePhoto(photo)
    }
  }

  const persistMeal = async (mealResult) => {
    await getOrCreateUserProfile(user.id, user.email)
    await saveMealLog(user.id, mealResult)
    clearPendingMeal()
    onMealSaved?.()
    handleClose()
  }

  const handleSaveMeal = async () => {
    if (!analysisResult) return

    try {
      setIsSaving(true)
      setError(null)

      if (!user) {
        storePendingMeal(analysisResult, capturedImage)
        await signInWithGoogle()
        return
      }

      await persistMeal(analysisResult)
    } catch (err) {
      setError('Failed to save meal. Please try again.')
      console.error('Save error:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    setStage('camera')
    setCapturedImage(null)
    setAnalysisResult(null)
    setError(null)
    setIsActive(false)
    onClose()
  }

  const handleRetake = () => {
    setCapturedImage(null)
    setAnalysisResult(null)
    setError(null)
    setStage('camera')
    setIsActive(true)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="w-full h-[90vh] sm:h-auto sm:max-h-[90vh] sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl flex flex-col relative">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white p-2 rounded-full transition-colors"
        >
          <X size={24} className="text-gray-900" />
        </button>

        <div className="flex-1 overflow-y-auto flex flex-col">
          {stage === 'camera' && !pendingImage && (
            <CameraView
              videoRef={videoRef}
              canvasRef={canvasRef}
              isActive={isActive}
              setIsActive={setIsActive}
              hasPermission={hasPermission}
              requestPermission={requestPermission}
              onCapture={handleCapture}
            />
          )}

          {stage === 'camera' && pendingImage && error && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-[40vh]">
              <p className="text-gray-900 font-semibold mb-2">Analysis failed</p>
              <p className="text-sm text-gray-600 mb-6">{error}</p>
              <button
                onClick={handleClose}
                className="bg-green-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-green-600"
              >
                Try another image
              </button>
            </div>
          )}

          {stage === 'analysis' && <AnalysisScreen />}

          {stage === 'results' && (
            <ResultsScreen
              result={analysisResult}
              image={capturedImage}
              onSave={handleSaveMeal}
              onRetake={handleRetake}
              user={user}
              isSaving={isSaving}
            />
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 m-4 p-3 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export async function restorePendingMeal(user, onMealSaved) {
  const pending = getPendingMeal()
  if (!pending?.result || !user) return false

  try {
    await getOrCreateUserProfile(user.id, user.email)
    await saveMealLog(user.id, pending.result)
    clearPendingMeal()
    onMealSaved?.()
    return true
  } catch (error) {
    console.error('Failed to restore pending meal:', error)
    return false
  }
}

function CameraView({ videoRef, canvasRef, isActive, setIsActive, hasPermission, requestPermission, onCapture }) {
  useEffect(() => {
    if (hasPermission === false) {
      setIsActive(false)
    } else if (hasPermission === true && !isActive) {
      setIsActive(true)
    }
  }, [hasPermission, isActive, setIsActive])

  if (hasPermission === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-[60vh]">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">📷</span>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">Camera Access Needed</h3>
        <p className="text-gray-600 mb-6">Allow camera access to scan food, or use Upload Image on the home screen.</p>
        <button
          onClick={requestPermission}
          className="bg-green-500 text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-600"
        >
          Enable Camera
        </button>
      </div>
    )
  }

  if (hasPermission === null) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-black relative min-h-[60vh]">
      <canvas ref={canvasRef} className="hidden" />

      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 border-2 border-white/30 rounded-2xl" />
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-6 flex justify-center items-end">
        <button
          onClick={onCapture}
          className="w-20 h-20 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95"
        >
          <div className="w-16 h-16 border-4 border-white rounded-full" />
        </button>
      </div>
    </div>
  )
}
