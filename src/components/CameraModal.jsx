import React, { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
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
  const [cameraError, setCameraError] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const analysisRequestRef = useRef(0)

  useEffect(() => {
    if (!isOpen) {
      analysisRequestRef.current += 1
      stopDesktopCamera()
      return
    }

    setError(null)
    setCameraError(null)
    setStage('camera')
    setCapturedImage(null)
    setAnalysisResult(null)

    if (pendingImage) {
      setCapturedImage(pendingImage)
      analyzePhoto(pendingImage)
      return
    }

    startDesktopCamera()

    return stopDesktopCamera
  }, [isOpen, pendingImage])

  const startDesktopCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not available in this browser. Use Upload Image instead.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      })

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      console.error('Camera access denied:', err)
      setCameraError('Camera access was blocked. Allow camera access or use Upload Image.')
    }
  }

  const stopDesktopCamera = () => {
    if (!streamRef.current) return

    streamRef.current.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const analyzePhoto = async (base64Image) => {
    const requestId = analysisRequestRef.current + 1
    analysisRequestRef.current = requestId

    try {
      setError(null)
      setStage('analysis')
      const result = await withTimeout(
        analyzeFood(base64Image),
        45000,
        'Analysis is taking too long. Please try again.'
      )

      if (analysisRequestRef.current !== requestId) return

      setAnalysisResult(result)
      setStage('results')
    } catch (err) {
      if (analysisRequestRef.current !== requestId) return

      setError(err.message || 'Failed to analyze food image. Please try again.')
      setStage('camera')
      setCapturedImage(null)
    }
  }

  const persistMeal = async (mealResult) => {
    console.info('[CalCheck] CameraModal persistMeal', {
      user_id: user?.id,
      food_name: mealResult?.food_name,
      timezone: mealResult?.timezone,
      local_date: mealResult?.local_date,
      meal_type: mealResult?.meal_type
    })

    await getOrCreateUserProfile(user.id, user.email)
    const savedMeal = await saveMealLog(user.id, mealResult)
    console.info('[CalCheck] CameraModal persistMeal saved', {
      id: savedMeal?.id,
      timezone: savedMeal?.timezone,
      local_date: savedMeal?.local_date,
      meal_type: savedMeal?.meal_type
    })
    clearPendingMeal()
    onMealSaved?.(savedMeal)
    handleClose()
  }

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const photo = canvas.toDataURL('image/jpeg', 0.92)
    setCapturedImage(photo)
    stopDesktopCamera()
    analyzePhoto(photo)
  }

  const handleSaveMeal = async (selectedMealResult = analysisResult) => {
    if (!selectedMealResult) return

    console.info('[CalCheck] CameraModal handleSaveMeal', {
      hasUser: Boolean(user),
      food_name: selectedMealResult?.food_name,
      timezone: selectedMealResult?.timezone,
      local_date: selectedMealResult?.local_date,
      meal_type: selectedMealResult?.meal_type
    })

    try {
      setIsSaving(true)
      setError(null)

      if (!user) {
        storePendingMeal(selectedMealResult, capturedImage)
        await signInWithGoogle()
        return
      }

      await persistMeal(selectedMealResult)
    } catch (err) {
      setError('Failed to save meal. Please try again.')
      console.error('Save error:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    analysisRequestRef.current += 1
    setStage('camera')
    setCapturedImage(null)
    setAnalysisResult(null)
    setError(null)
    setCameraError(null)
    stopDesktopCamera()
    onClose()
  }

  const handleRetake = () => {
    analysisRequestRef.current += 1
    setCapturedImage(null)
    setAnalysisResult(null)
    setError(null)
    setStage('camera')
    if (pendingImage) {
      onClose()
      return
    }

    startDesktopCamera()
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
            <DesktopCameraView
              videoRef={videoRef}
              canvasRef={canvasRef}
              error={cameraError}
              onCapture={handleCapture}
              onClose={handleClose}
            />
          )}

          {stage === 'camera' && pendingImage && error && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-[40vh]">
              <p className="text-gray-900 font-semibold mb-2">Analysis failed</p>
              <p className="text-sm text-gray-600 mb-6">{error}</p>
              <button
                onClick={handleClose}
                className="bg-gradient-to-r from-brand-400 to-brand-500 text-brand-900 px-6 py-3 rounded-xl font-semibold hover:from-brand-500 hover:to-brand-400"
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

const withTimeout = (promise, ms, message) => {
  let timeoutId

  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId)
  })
}

export async function restorePendingMeal(user, onMealSaved) {
  const pending = getPendingMeal()
  if (!pending?.result || !user) return false

  try {
    console.info('[CalCheck] restorePendingMeal save path', {
      user_id: user?.id,
      food_name: pending.result?.food_name,
      timezone: pending.result?.timezone,
      local_date: pending.result?.local_date,
      meal_type: pending.result?.meal_type
    })
    await getOrCreateUserProfile(user.id, user.email)
    const savedMeal = await saveMealLog(user.id, pending.result)
    console.info('[CalCheck] restorePendingMeal saved', {
      id: savedMeal?.id,
      timezone: savedMeal?.timezone,
      local_date: savedMeal?.local_date,
      meal_type: savedMeal?.meal_type
    })
    clearPendingMeal()
    onMealSaved?.(savedMeal)
    return true
  } catch (error) {
    console.error('Failed to restore pending meal:', error)
    return false
  }
}

function DesktopCameraView({ videoRef, canvasRef, error, onCapture, onClose }) {
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-[60vh]">
        <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mb-4">
          <CameraGlyph />
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">Camera unavailable</h3>
        <p className="text-gray-600 mb-6">{error}</p>
        <button
          onClick={onClose}
          className="bg-gradient-to-r from-brand-400 to-brand-500 text-brand-900 px-6 py-2 rounded-lg font-semibold hover:from-brand-500 hover:to-brand-400"
        >
          Back to Scan
        </button>
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
        muted
        className="w-full h-full object-cover"
      />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 border-2 border-white/30 rounded-2xl" />
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-6 flex justify-center items-end">
        <button
          onClick={onCapture}
          className="w-20 h-20 bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 rounded-full flex items-center justify-center shadow-brand transition-all active:scale-95"
        >
          <div className="w-16 h-16 border-4 border-white rounded-full" />
        </button>
      </div>
    </div>
  )
}

function CameraGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.4-1.8A2 2 0 0 1 11 3.5h2a2 2 0 0 1 1.6.7L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
        stroke="rgb(var(--color-brand-deep))"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        stroke="rgb(var(--color-brand-deep))"
        strokeWidth="1.8"
      />
    </svg>
  )
}
