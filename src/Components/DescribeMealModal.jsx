import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, Loader2, Mic, Square, Trash2, X } from 'lucide-react'
import ResultsScreen from './ResultsScreen'
import { analyzeMealText, transcribeMealVoice } from '../services/ai'
import { saveMealLog, getOrCreateUserProfile } from '../services/database'
import { signInWithGoogle } from '../services/supabase'
import { emitMealSaved } from '../utils/mealEvents'
import { logAppEvent } from '../utils/appDiagnostics'
import { getErrorMessage, logSafeError } from '../utils/errorUtils'
import { trackApiRequest } from '../services/diagnostics'

const PENDING_MEAL_KEY = 'calcheck-pending-meal'
const EMPTY_TEXT = ''
const MAX_RECORDING_MS = 30000

export default function DescribeMealModal({ isOpen, onClose, user, onMealSaved }) {
  const [mode, setMode] = useState('type')
  const [description, setDescription] = useState(EMPTY_TEXT)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recordingMs, setRecordingMs] = useState(0)
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const audioChunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
  const recordingTimerRef = useRef(null)
  const analyzeInFlightRef = useRef(false)

  useEffect(() => {
    if (!isOpen) cleanupVoice()
    if (isOpen) {
      setMode('type')
      setDescription(EMPTY_TEXT)
      setResult(null)
      setError(null)
      setIsAnalyzing(false)
      setIsSaving(false)
      setIsTranscribing(false)
      setRecordingMs(0)
    }

    return () => cleanupVoice()
  }, [isOpen])

  const cleanupVoice = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      try { mediaRecorderRef.current.stop() } catch {}
    }
    mediaRecorderRef.current = null
    mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop())
    mediaStreamRef.current = null
    audioChunksRef.current = []
    setIsRecording(false)
  }

  const closeModal = () => {
    cleanupVoice()
    onClose?.()
  }

  const updateDescription = (value, source = 'type') => {
    setDescription(value)
    if (source === 'voice_edit') {
      logAppEvent('VOICE_TRANSCRIPT_EDITED', {
        level: 'info',
        screen: 'scan',
        operation: 'edit voice transcript',
        metadata: { transcript_length: value.length, source: 'voice_transcript' }
      })
    }
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported here. Use your keyboard mic or type your meal.')
      return
    }

    try {
      setError(null)
      audioChunksRef.current = []
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingStartedAtRef.current = Date.now()
      setRecordingMs(0)
      setIsRecording(true)
      logAppEvent('VOICE_RECORDING_STARTED', {
        level: 'info',
        screen: 'scan',
        operation: 'voice meal record',
        metadata: getVoiceMetadata({ source: 'voice' })
      })

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop())
        mediaStreamRef.current = null
      }
      recorder.start()
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - recordingStartedAtRef.current
        setRecordingMs(elapsed)
        if (elapsed >= MAX_RECORDING_MS && mediaRecorderRef.current?.state === 'recording') {
          stopRecording()
        }
      }, 250)
    } catch (err) {
      cleanupVoice()
      setError('Microphone access is blocked. You can type your meal instead.')
      logSafeError('VOICE_TRANSCRIPTION_FAILED', err, { screen: 'scan', operation: 'start voice recording' })
    }
  }

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state !== 'recording') return

    const stopped = new Promise((resolve) => {
      const previous = recorder.onstop
      recorder.onstop = (event) => {
        previous?.(event)
        resolve()
      }
    })
    recorder.stop()
    await stopped
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    setIsRecording(false)

    const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
    const durationMs = Date.now() - recordingStartedAtRef.current
    logAppEvent('VOICE_RECORDING_STOPPED', {
      level: 'info',
      screen: 'scan',
      operation: 'voice meal record',
      duration_ms: durationMs,
      metadata: getVoiceMetadata({ audio_size_bytes: audioBlob.size, duration_ms: durationMs, source: 'voice' })
    })
    audioChunksRef.current = []

    if (audioBlob.size < 1000) {
      setError("Couldn't understand that. Please try again or type your meal.")
      return
    }

    await transcribeAudio(audioBlob, durationMs)
  }

  const cancelRecording = () => {
    cleanupVoice()
    setRecordingMs(0)
    logAppEvent('VOICE_RECORDING_CANCELLED', {
      level: 'info',
      screen: 'scan',
      operation: 'voice meal record',
      metadata: getVoiceMetadata({ source: 'voice' })
    })
    logAppEvent('VOICE_AUDIO_DISCARDED', {
      level: 'info',
      screen: 'scan',
      operation: 'voice meal record',
      metadata: getVoiceMetadata({ source: 'voice' })
    })
  }

  const transcribeAudio = async (audioBlob, durationMs) => {
    try {
      setIsTranscribing(true)
      setError(null)
      logAppEvent('VOICE_TRANSCRIPTION_STARTED', {
        level: 'info',
        screen: 'scan',
        operation: 'voice transcription',
        duration_ms: durationMs,
        metadata: getVoiceMetadata({ audio_size_bytes: audioBlob.size, duration_ms: durationMs, source: 'voice' })
      })
      const transcript = await transcribeMealVoice(audioBlob, { source: 'voice' })
      setDescription(transcript)
      setMode('voice')
      logAppEvent('VOICE_TRANSCRIPTION_SUCCESS', {
        level: 'info',
        screen: 'scan',
        operation: 'voice transcription',
        duration_ms: durationMs,
        metadata: getVoiceMetadata({ audio_size_bytes: audioBlob.size, transcript_length: transcript.length, source: 'voice' })
      })
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't understand that. Please try again or type your meal."))
      logSafeError('VOICE_TRANSCRIPTION_FAILED', err, { screen: 'scan', operation: 'voice transcription' })
    } finally {
      setIsTranscribing(false)
      logAppEvent('VOICE_AUDIO_DISCARDED', {
        level: 'info',
        screen: 'scan',
        operation: 'voice transcription',
        metadata: getVoiceMetadata({ source: 'voice' })
      })
    }
  }

  const analyzeDescription = async () => {
    if (analyzeInFlightRef.current) return
    const trimmed = description.trim()
    if (trimmed.length < 3) {
      setError('I need a little more detail. For example: 2 rotis, dal, rice, curd.')
      return
    }

    const source = mode === 'voice' ? 'voice_transcript' : 'text'
    try {
      analyzeInFlightRef.current = true
      setIsAnalyzing(true)
      setError(null)
      logAppEvent('TEXT_MEAL_ANALYZE_STARTED', {
        level: 'info',
        screen: 'scan',
        operation: 'analyze meal description',
        metadata: { source, transcript_length: trimmed.length, is_online: navigator.onLine }
      })
      const analysis = await analyzeMealText(trimmed, { source })
      if (analysis?.loggable === false) {
        setResult(null)
        setError(analysis.message || friendlyClassificationMessage(analysis.input_type))
        logAppEvent('TEXT_MEAL_CLASSIFICATION_REJECTED', {
          level: 'info',
          screen: 'scan',
          operation: 'analyze meal description',
          metadata: { source, input_type: analysis.input_type || 'unclear_food', transcript_length: trimmed.length }
        })
        return
      }

      setResult({ ...analysis, source })
      logAppEvent('TEXT_MEAL_ANALYZE_SUCCESS', {
        level: 'info',
        screen: 'scan',
        operation: 'analyze meal description',
        metadata: { source, input_type: analysis?.input_type || 'meal', transcript_length: trimmed.length }
      })
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't analyze this meal. Please try again."))
      logSafeError('TEXT_MEAL_ANALYZE_FAILED', err, { screen: 'scan', operation: 'analyze meal description' })
    } finally {
      analyzeInFlightRef.current = false
      setIsAnalyzing(false)
    }
  }

  const persistMeal = async (mealResult) => {
    const source = mealResult?.source === 'voice_transcript' ? 'voice_transcript' : 'text'
    try {
      setIsSaving(true)
      setError(null)

      if (!user) {
        storePendingMeal({ ...mealResult, source })
        await signInWithGoogle()
        return
      }

      const savedMeal = await trackApiRequest('save text meal flow', async () => {
        await getOrCreateUserProfile(user.id, user.email)
        return saveMealLog(user.id, mealResult, { source })
      })
      emitMealSaved(savedMeal)
      onMealSaved?.(savedMeal)
      closeModal()
    } catch (err) {
      setError("Couldn't save meal. Please try again.")
      logSafeError('SAVE_MEAL_FAILED', err, { screen: 'scan', operation: 'save text meal' })
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/70 sm:items-center sm:justify-center">
        <div className="relative flex h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white sm:max-h-[90vh] sm:max-w-lg sm:rounded-3xl">
          <button type="button" onClick={() => setResult(null)} className="absolute left-4 top-4 z-10 rounded-full bg-white/90 p-2 shadow-sm" aria-label="Back">
            <X size={22} className="text-gray-900" />
          </button>
          <ResultsScreen
            result={result}
            image={null}
            onSave={persistMeal}
            onRetake={() => setResult(null)}
            user={user}
            isSaving={isSaving}
          />
          {error && <p className="px-5 pb-4 text-center text-sm font-semibold text-red-700">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 sm:items-center sm:justify-center">
      <div className="w-full rounded-t-[28px] bg-[#FFF9F2] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.24)] sm:max-w-lg sm:rounded-[28px]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-[#151A22]">Describe your meal</h2>
            <p className="mt-1 text-sm font-semibold text-[#6B7280]">Type it in, or record a quick voice note.</p>
          </div>
          <button type="button" onClick={closeModal} className="rounded-full bg-white p-2 shadow-sm" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-[18px] bg-white p-1 shadow-[0_10px_28px_rgba(21,26,34,0.06)]">
          <button type="button" onClick={() => setMode('type')} className={`flex items-center justify-center gap-2 rounded-[14px] py-2 text-sm font-black ${mode === 'type' ? 'bg-[#151A22] text-white' : 'text-[#5F6978]'}`}>
            <Keyboard size={17} /> Type
          </button>
          <button type="button" onClick={() => setMode('voice')} className={`flex items-center justify-center gap-2 rounded-[14px] py-2 text-sm font-black ${mode === 'voice' ? 'bg-[#151A22] text-white' : 'text-[#5F6978]'}`}>
            <Mic size={17} /> Voice
          </button>
        </div>

        {mode === 'voice' && (
          <div className="mb-4 rounded-[22px] border border-[rgba(21,26,34,0.08)] bg-white p-4 shadow-[0_14px_34px_rgba(21,26,34,0.06)]">
            {!isRecording ? (
              <button type="button" onClick={startRecording} disabled={isTranscribing} className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-[#151A22] px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                {isTranscribing ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
                {isTranscribing ? 'Transcribing...' : 'Tap to record'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="text-center text-2xl font-black text-[#151A22]">{formatTimer(recordingMs)}</div>
                <button type="button" onClick={stopRecording} className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-[#151A22] px-4 py-3 text-sm font-black text-white">
                  <Square size={17} /> Stop recording
                </button>
                <button type="button" onClick={cancelRecording} className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-gray-100 px-4 py-3 text-sm font-black text-gray-700">
                  <Trash2 size={17} /> Cancel
                </button>
              </div>
            )}
          </div>
        )}

        <textarea
          value={description}
          onChange={(event) => updateDescription(event.target.value, mode === 'voice' ? 'voice_edit' : 'type')}
          placeholder="Example: 2 rotis, dal, rice, curd"
          rows={5}
          className="min-h-[130px] w-full resize-none rounded-[22px] border border-[rgba(21,26,34,0.08)] bg-white p-4 text-base font-semibold text-[#151A22] shadow-[0_14px_34px_rgba(21,26,34,0.06)] placeholder:text-gray-400"
        />

        {error && <div className="mt-3 rounded-[18px] bg-[#FFF4D8] px-4 py-3 text-sm font-bold text-[#7A6849]">{error}</div>}

        <button type="button" onClick={analyzeDescription} disabled={isAnalyzing || isRecording || isTranscribing} className="mt-4 flex w-full items-center justify-center gap-2 rounded-[22px] bg-[#151A22] px-5 py-4 text-base font-black text-white shadow-[0_18px_42px_rgba(21,26,34,0.16)] disabled:opacity-60">
          {isAnalyzing ? <Loader2 size={20} className="animate-spin" /> : null}
          {isAnalyzing ? 'Analyzing meal...' : 'Analyze meal'}
        </button>
      </div>
    </div>
  )
}

const friendlyClassificationMessage = (inputType) => {
  if (inputType === 'unsafe_or_medical') return "I can help log meals, but I can't answer medical advice here."
  if (inputType === 'unclear_food') return 'I need a little more detail. For example: 2 rotis, dal, rice, curd.'
  return "I couldn't detect a meal. Try describing what you ate."
}

const formatTimer = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

const storePendingMeal = (result) => {
  sessionStorage.setItem(PENDING_MEAL_KEY, JSON.stringify({ result }))
}
const getVoiceMetadata = (metadata = {}) => ({
  ...metadata,
  is_pwa: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true),
  is_online: typeof navigator === 'undefined' ? true : navigator.onLine
})
