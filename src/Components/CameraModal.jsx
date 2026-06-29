import React, { useState, useEffect, useRef } from 'react'
import { Loader2, X } from 'lucide-react'
import { analyzeFood } from '../services/ai'
import { saveMealLog, getOrCreateUserProfile } from '../services/database'
import { recordPerformanceMetric, trackApiRequest } from '../services/diagnostics'
import { logAppEvent } from '../utils/appDiagnostics'
import { signInWithGoogle } from '../services/supabase'
import { blobToDataUrl, prepareImageForAnalysis, revokeImagePreview } from '../utils/imagePerformance'
import { getErrorMessage, logSafeError } from '../utils/errorUtils'
import { emitMealSaved } from '../utils/mealEvents'
import AnalysisScreen from './AnalysisScreen'
import ResultsScreen from './ResultsScreen'

const PENDING_MEAL_KEY = 'calcheck-pending-meal'
const PHOTO_COMPRESSION_TIMEOUT_MS = 8000
const ANALYSIS_TIMEOUT_MS = 30000

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

export const storePendingMeal = (result) => {
  sessionStorage.setItem(PENDING_MEAL_KEY, JSON.stringify({ result }))
}

export default function CameraModal({
  isOpen,
  onClose,
  user,
  onMealSaved,
  pendingImage = null,
  onPendingImageConsumed,
  onAnalysisComplete
}) {
  const [stage, setStage] = useState('camera')
  const [capturedImage, setCapturedImage] = useState(null)
  const [analysisResult, setAnalysisResult] = useState(null)
  const [error, setError] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [requestNotice, setRequestNotice] = useState(null)
  const [flowStatus, setFlowStatus] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const analysisRequestRef = useRef(0)
  const uploadImageRef = useRef(null)
  const previewUrlRef = useRef(null)
  const retryImageSourceRef = useRef(null)
  const retrySourceLabelRef = useRef(null)
  const openedWithPendingImageRef = useRef(false)
  const processingRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      analysisRequestRef.current += 1
      clearPreviewUrl()
      uploadImageRef.current = null
      stopDesktopCamera()
      return
    }

    setError(null)
    setRequestNotice(null)
    setCameraError(null)
    setFlowStatus(null)
    setStage('camera')
    setCapturedImage(null)
    setAnalysisResult(null)

    if (pendingImage) {
      openedWithPendingImageRef.current = true
      prepareAndAnalyzePhoto(pendingImage, 'upload')
      onPendingImageConsumed?.()
      return
    }

    startDesktopCamera()

    return () => {
      clearPreviewUrl()
      uploadImageRef.current = null
      stopDesktopCamera()
    }
  }, [isOpen])

  const startDesktopCamera = async () => {
    logAppEvent('CAMERA_OPEN_REQUESTED', {
      level: 'info',
      screen: 'scan',
      operation: 'open camera',
      metadata: { source: 'desktop-camera' }
    })
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

  const clearPreviewUrl = () => {
    if (!previewUrlRef.current) return
    logAppEvent('IMAGE_OBJECT_URL_REVOKED', {
      level: 'info',
      screen: 'scan',
      operation: 'clear prepared image'
    })
    revokeImagePreview(previewUrlRef.current)
    previewUrlRef.current = null
  }

  const setPreviewUrl = (previewUrl) => {
    clearPreviewUrl()
    previewUrlRef.current = previewUrl
    setCapturedImage(previewUrl)
  }

  const prepareAndAnalyzePhoto = async (imageSource, sourceLabel) => {
    if (processingRef.current) {
      logAppEvent('CAMERA_ANALYSIS_DUPLICATE_PREVENTED', {
        level: 'warn',
        screen: 'scan',
        operation: 'prepare and analyze photo',
        metadata: { source: sourceLabel }
      })
      return
    }

    processingRef.current = true
    const requestId = analysisRequestRef.current + 1
    analysisRequestRef.current = requestId
    retryImageSourceRef.current = imageSource
    retrySourceLabelRef.current = sourceLabel
    let currentPhase = 'photo-compression'

    try {
      setError(null)
      setRequestNotice(null)
      setFlowStatus('Preparing photo...')
      setStage('preparing')
      console.info('[CalCheck] CAMERA_OK_TAPPED', { source: sourceLabel })
      console.info('[CalCheck] IMAGE_COMPRESSION_START', { source: sourceLabel })
      recordPerformanceMetric('CAMERA_OK_TAPPED', { source: sourceLabel })
      recordPerformanceMetric('IMAGE_COMPRESSION_START', { source: sourceLabel })

      const preparedImage = await withTimeout(
        prepareImageForAnalysis(imageSource, sourceLabel),
        PHOTO_COMPRESSION_TIMEOUT_MS,
        'Preparing photo took too long. Please retry or retake the photo.'
      )

      if (analysisRequestRef.current !== requestId) {
        revokeImagePreview(preparedImage.previewUrl)
        recordPerformanceMetric('ANALYSIS_FLOW_ABORTED', {
          source: sourceLabel,
          stage: 'photo-compression',
          reason: 'stale-request'
        })
        return
      }

      uploadImageRef.current = preparedImage
      retryImageSourceRef.current = preparedImage.blob
      setPreviewUrl(preparedImage.previewUrl)
      console.info('[CalCheck] IMAGE_COMPRESSION_SUCCESS', {
        source: sourceLabel,
        diagnostics: preparedImage.diagnostics
      })
      console.info('[CalCheck] PHOTO_HANDOFF_TO_SCAN', {
        source: sourceLabel,
        upload_size_bytes: preparedImage.diagnostics?.upload_size_bytes
      })
      recordPerformanceMetric('IMAGE_COMPRESSION_SUCCESS', {
        source: sourceLabel,
        upload_size_bytes: preparedImage.diagnostics?.upload_size_bytes,
        durationMs: preparedImage.diagnostics?.compression_duration_ms
      })
      recordPerformanceMetric('PHOTO_HANDOFF_TO_SCAN', {
        source: sourceLabel,
        upload_size_bytes: preparedImage.diagnostics?.upload_size_bytes
      })

      setFlowStatus('Analyzing meal...')
      setStage('analysis')
      console.info('[CalCheck] ANALYSIS_FLOW_STARTED', { source: sourceLabel })
      console.info('[CalCheck] ANALYSIS_START', { source: sourceLabel })
      recordPerformanceMetric('ANALYSIS_FLOW_STARTED', { source: sourceLabel })
      recordPerformanceMetric('ANALYSIS_START', { source: sourceLabel })
      currentPhase = 'analysis'
      let analysisDataUrl = null
      let result
      try {
        analysisDataUrl = await blobToDataUrl(preparedImage.blob)
        logAppEvent('IMAGE_BASE64_CREATED_FOR_ANALYSIS', {
          level: 'info',
          screen: 'scan',
          operation: 'analyze food',
          metadata: { source: sourceLabel, upload_size_bytes: preparedImage.blob?.size || null }
        })
        result = await withTimeout(
          trackApiRequest('analyze-food flow', () => analyzeFood(analysisDataUrl), {
            onLongRequest: (message) => setRequestNotice(message)
          }),
          ANALYSIS_TIMEOUT_MS,
          'Analysis is taking too long. Please try again.'
        )
      } finally {
        analysisDataUrl = null
        logAppEvent('IMAGE_BASE64_RELEASED', {
          level: 'info',
          screen: 'scan',
          operation: 'analyze food',
          metadata: { source: sourceLabel }
        })
      }

      if (analysisRequestRef.current !== requestId) return

      console.info('[CalCheck] ANALYSIS_SUCCESS', { source: sourceLabel })
      recordPerformanceMetric('ANALYSIS_SUCCESS', { source: sourceLabel })
      setAnalysisResult(result)
      setRequestNotice(null)
      setFlowStatus(null)
      onAnalysisComplete?.()
      setStage('results')
    } catch (err) {
      if (analysisRequestRef.current !== requestId) return

      const failedDuringCompression = currentPhase === 'photo-compression'
      const lowMemoryFallback = failedDuringCompression && isLikelyLowMemoryImageError(err)
      const message = lowMemoryFallback
        ? 'This photo was too large to process. Try a smaller photo or retake it.'
        : getErrorMessage(err, "Couldn't analyze this meal. Please try again.")
      const timeoutStage = message.includes('took too long') ? 'photo-compression' : 'analysis'
      logSafeError(failedDuringCompression ? 'IMAGE_COMPRESSION_FAILED' : 'ANALYZE_FOOD_FAILED', err, {
        source: sourceLabel,
        screen: 'scan',
        operation: failedDuringCompression ? 'compress image' : 'analyze food'
      })
      logAppEvent(failedDuringCompression ? 'IMAGE_COMPRESSION_FAILED' : 'ANALYZE_FOOD_FAILED', {
        level: 'error',
        screen: 'scan',
        operation: failedDuringCompression ? 'compress image' : 'analyze food',
        normalized_message: message,
        metadata: getImageFailureMetadata(imageSource, sourceLabel, failedDuringCompression ? 'compress' : 'analyze')
      })
      if (lowMemoryFallback) {
        logAppEvent('IMAGE_LOW_MEMORY_FALLBACK', {
          level: 'warn',
          screen: 'scan',
          operation: 'compress image',
          normalized_message: message,
          metadata: getImageFailureMetadata(imageSource, sourceLabel, failedDuringCompression ? 'compress' : 'analyze')
        })
      }
      console.error('[CalCheck] ANALYSIS_FLOW_ABORTED', {
        source: sourceLabel,
        stage: failedDuringCompression ? 'photo-compression' : 'analysis',
        error: err
      })
      recordPerformanceMetric(failedDuringCompression ? 'IMAGE_COMPRESSION_FAILED' : 'ANALYSIS_FAILED', {
        source: sourceLabel,
        error: message
      })
      recordPerformanceMetric('ANALYSIS_FLOW_ABORTED', {
        source: sourceLabel,
        stage: failedDuringCompression ? 'photo-compression' : 'analysis',
        error: message
      })
      if (message.includes('too long')) {
        recordPerformanceMetric('ANALYSIS_FLOW_TIMEOUT', {
          source: sourceLabel,
          stage: timeoutStage,
          timeoutMs: failedDuringCompression ? PHOTO_COMPRESSION_TIMEOUT_MS : ANALYSIS_TIMEOUT_MS
        })
      }
      setError(message)
      setRequestNotice(null)
      setFlowStatus(null)
      setStage('error')
      clearPreviewUrl()
      uploadImageRef.current = null
      if (failedDuringCompression) {
        retryImageSourceRef.current = null
        retrySourceLabelRef.current = null
      }
    } finally {
      processingRef.current = false
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

    const savedMeal = await trackApiRequest(
      'save meal flow',
      async () => {
        await getOrCreateUserProfile(user.id, user.email)
        return saveMealLog(user.id, mealResult, {
          image: uploadImageRef.current,
          source: retrySourceLabelRef.current
        })
      },
      {
        onLongRequest: (message) => setRequestNotice(message)
      }
    )
    console.info('[CalCheck] CameraModal persistMeal saved', {
      id: savedMeal?.id,
      timezone: savedMeal?.timezone,
      local_date: savedMeal?.local_date,
      meal_type: savedMeal?.meal_type
    })
    emitMealSaved(savedMeal)
    clearPendingMeal()
    onMealSaved?.(savedMeal)
    handleClose()
  }

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) {
      console.warn('[CalCheck] CAMERA_OK_NOOP_PREVENTED', {
        source: 'camera-capture',
        reason: 'missing-video-or-canvas'
      })
      recordPerformanceMetric('CAMERA_OK_NOOP_PREVENTED', {
        source: 'camera-capture',
        reason: 'missing-video-or-canvas'
      })
      setError('Camera is not ready yet. Please try again.')
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    stopDesktopCamera()
    prepareAndAnalyzePhoto(canvas, 'camera-capture')
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
      setRequestNotice(null)

      if (!user) {
        storePendingMeal(selectedMealResult)
        await signInWithGoogle()
        return
      }

      await persistMeal(selectedMealResult)
      setRequestNotice(null)
    } catch (err) {
      setError("Couldn't save meal. Please try again.")
      setRequestNotice(null)
      logSafeError('SAVE_MEAL_FAILED', err, { screen: 'scan', operation: 'save meal' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    analysisRequestRef.current += 1
    processingRef.current = false
    setStage('camera')
    setCapturedImage(null)
    setAnalysisResult(null)
    setError(null)
    setRequestNotice(null)
    setCameraError(null)
    setFlowStatus(null)
    uploadImageRef.current = null
    openedWithPendingImageRef.current = false
    retryImageSourceRef.current = null
    retrySourceLabelRef.current = null
    clearPreviewUrl()
    stopDesktopCamera()
    onClose()
  }

  const handleRetake = () => {
    analysisRequestRef.current += 1
    processingRef.current = false
    setCapturedImage(null)
    setAnalysisResult(null)
    setError(null)
    setRequestNotice(null)
    setFlowStatus(null)
    uploadImageRef.current = null
    clearPreviewUrl()
    setStage('camera')
    if (openedWithPendingImageRef.current || pendingImage) {
      onClose()
      return
    }

    startDesktopCamera()
  }

  const handleRetry = () => {
    const source = retryImageSourceRef.current
    const sourceLabel = retrySourceLabelRef.current || 'retry'

    if (!source) {
      console.warn('[CalCheck] CAMERA_OK_NOOP_PREVENTED', {
        source: sourceLabel,
        reason: 'missing-retry-image'
      })
      recordPerformanceMetric('CAMERA_OK_NOOP_PREVENTED', {
        source: sourceLabel,
        reason: 'missing-retry-image'
      })
      logAppEvent('IMAGE_PROCESSING_STAGE_FAILED', {
        level: 'warn',
        screen: 'scan',
        operation: 'retry image analysis',
        normalized_message: 'Retry image source was unavailable.',
        metadata: { source: sourceLabel, stage: 'retry' }
      })
      setError('Photo is no longer available. Please retake it.')
      return
    }

    prepareAndAnalyzePhoto(source, sourceLabel)
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
            <FailureView error={error} onRetry={handleRetry} onRetake={handleRetake} />
          )}

          {stage === 'preparing' && <PreparingView status={flowStatus || 'Preparing photo...'} />}

          {stage === 'analysis' && <AnalysisScreen />}

          {stage === 'error' && (
            <FailureView error={error} onRetry={handleRetry} onRetake={handleRetake} />
          )}

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

          {requestNotice && (
            <div className="bg-yellow-50 border border-yellow-200 mx-4 mb-4 p-3 rounded-lg">
              <p className="text-sm font-semibold text-yellow-800">{requestNotice}</p>
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

const isLikelyLowMemoryImageError = (error) => {
  const message = String(error?.message || error || '').toLowerCase()
  return (
    message.includes('memory') ||
    message.includes('allocation') ||
    message.includes('too large') ||
    message.includes('decode') ||
    message.includes('load image') ||
    message.includes('compress image') ||
    message.includes('canvas')
  )
}

const getImageFailureMetadata = (source, sourceLabel, stage = 'unknown') => {
  const isFile = typeof File !== 'undefined' && source instanceof File
  const isBlob = typeof Blob !== 'undefined' && source instanceof Blob
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  return {
    source: sourceLabel,
    stage,
    file_size_bytes: isFile || isBlob ? source.size : null,
    file_type: isFile || isBlob ? source.type || null : null,
    file_last_modified_age_ms: isFile && Number.isFinite(source.lastModified) ? Math.max(0, Date.now() - source.lastModified) : null,
    viewport_width: typeof window === 'undefined' ? null : window.innerWidth,
    viewport_height: typeof window === 'undefined' ? null : window.innerHeight,
    device_memory: typeof navigator === 'undefined' ? null : navigator.deviceMemory || null,
    hardware_concurrency: typeof navigator === 'undefined' ? null : navigator.hardwareConcurrency || null,
    user_agent_family: getUserAgentFamily(userAgent),
    is_pwa: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true),
    is_online: typeof navigator === 'undefined' ? true : navigator.onLine
  }
}

const getUserAgentFamily = (userAgent) => {
  if (/SamsungBrowser/i.test(userAgent)) return 'samsung-browser'
  if (/EdgA|EdgiOS|Edg\//i.test(userAgent)) return 'edge'
  if (/CriOS|Chrome/i.test(userAgent)) return 'chrome'
  if (/Firefox|FxiOS/i.test(userAgent)) return 'firefox'
  if (/Safari/i.test(userAgent)) return 'safari'
  return 'unknown'
}

function PreparingView({ status }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-brand-50 to-white min-h-[60vh] text-center">
      <Loader2 size={34} className="animate-spin text-brand-700 mb-4" />
      <h2 className="text-2xl font-bold text-ink mb-2">{status}</h2>
      <p className="text-sm text-gray-500">Keep CalCheck open while the photo is prepared.</p>
    </div>
  )
}

function FailureView({ error, onRetry, onRetake }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-[60vh]">
      <p className="text-gray-900 font-semibold mb-2">Analysis did not start</p>
      <p className="text-sm text-gray-600 mb-6">{error || 'Please retry or retake the photo.'}</p>
      <div className="w-full max-w-xs space-y-3">
        <button
          type="button"
          onClick={onRetry}
          className="w-full bg-gradient-to-r from-brand-400 to-brand-500 text-brand-900 px-6 py-3 rounded-xl font-semibold hover:from-brand-500 hover:to-brand-400"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onRetake}
          className="w-full bg-gray-100 text-gray-900 px-6 py-3 rounded-xl font-semibold hover:bg-gray-200"
        >
          Retake
        </button>
      </div>
    </div>
  )
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
    emitMealSaved(savedMeal)
    clearPendingMeal()
    onMealSaved?.(savedMeal)
    return true
  } catch (error) {
    logSafeError('SUPABASE_OPERATION_FAILED', error, { operation: 'restore pending meal' })
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
