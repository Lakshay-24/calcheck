import React, { useState, useEffect } from 'react'
import { X, RotateCw } from 'lucide-react'
import { useCamera } from '../hooks/useCamera'
import { analyzeFood } from '../services/gemini'
import { saveMealLog, incrementScanCount, getScanCountToday, getUserProfile } from '../services/database'
import { signInWithGoogle } from '../services/supabase'
import AnalysisScreen from './AnalysisScreen'
import ResultsScreen from './ResultsScreen'

export default function CameraModal({ isOpen, onClose, user, onMealSaved }) {
  const [stage, setStage] = useState('camera') // camera, analysis, results
  const [capturedImage, setCapturedImage] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [error, setError] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const [userProfile, setUserProfile] = useState(null)

  const { videoRef, canvasRef, isActive, setIsActive, capturePhoto, hasPermission, requestPermission } = useCamera()

  // Check permissions and load user data on modal open
  useEffect(() => {
    if (isOpen) {
      setError(null)
      if (hasPermission === null) {
        requestPermission()
      }
      setStage('camera')
      setCapturedImage(null)
      setAnalysisResult(null)

      // Check scan count if user exists
      if (user?.id) {
        loadUserData()
      }
    } else {
      setIsActive(false)
    }
  }, [isOpen])

  const loadUserData = async () => {
    try {
      const profile = await getUserProfile(user.id)
      setUserProfile(profile)
      const count = await getScanCountToday(user.id)
      setScanCount(count)
    } catch (error) {
      console.error('Error loading user data:', error)
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

  const analyzePhoto = async (base64Image) => {
    try {
      setStage('analysis')
      const result = await analyzeFood(base64Image)
      setAnalysisResult(result)
      setStage('results')
    } catch (err) {
      setError(err.message)
      setStage('camera')
      setCapturedImage(null)
    }
  }

  const handleSaveMeal = async () => {
    try {
      if (!user) {
        // Prompt to login
        await signInWithGoogle()
        return
      }

      // Check free tier limit
      if (userProfile?.subscription_status === 'free' && scanCount >= 3) {
        setError('Free tier limit reached (3 scans/day). Upgrade to premium for unlimited scans.')
        return
      }

      // Save meal
      await saveMealLog(user.id, analysisResult)

      // Increment scan count
      await incrementScanCount(user.id)

      // Close modal and refresh parent
      onMealSaved?.()
      handleClose()
    } catch (err) {
      setError('Failed to save meal. Please try again.')
      console.error('Save error:', err)
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
      {/* Modal Container */}
      <div className="w-full h-[90vh] sm:h-auto sm:max-h-[90vh] sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl flex flex-col relative">
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 bg-white/80 hover:bg-white p-2 rounded-full transition-colors"
        >
          <X size={24} className="text-gray-900" />
        </button>

        {/* Content */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {stage === 'camera' && (
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

          {stage === 'analysis' && <AnalysisScreen />}

          {stage === 'results' && (
            <ResultsScreen
              result={analysisResult}
              image={capturedImage}
              onSave={handleSaveMeal}
              onRetake={handleRetake}
              user={user}
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

// Camera View Component
function CameraView({ videoRef, canvasRef, isActive, setIsActive, hasPermission, requestPermission, onCapture }) {
  useEffect(() => {
    if (hasPermission === false) {
      setIsActive(false)
    } else if (hasPermission === true && !isActive) {
      setIsActive(true)
    }
  }, [hasPermission])

  if (hasPermission === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">📷</span>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-2">Camera Access Needed</h3>
        <p className="text-gray-600 mb-6">Allow camera access to scan food</p>
        <button
          onClick={requestPermission}
          className="bg-green-500 text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-600"
        >
          Enable Camera
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-black relative">
      <canvas ref={canvasRef} className="hidden" />

      {/* Video Stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
        style={{
          transform: 'scaleX(-1)' // Mirror effect
        }}
      />

      {/* Overlay Grid */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 border-2 border-white/30 rounded-2xl"></div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-6 flex justify-center items-end gap-4">
        {/* Shutter Button */}
        <button
          onClick={onCapture}
          className="w-20 h-20 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95"
        >
          <div className="w-16 h-16 border-4 border-white rounded-full"></div>
        </button>
      </div>
    </div>
  )
}
