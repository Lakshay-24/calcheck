import { recordImageDiagnostics, recordPerformanceMetric } from '../services/diagnostics'
import { logAppEvent } from './appDiagnostics'

export const MAX_UPLOAD_IMAGE_SIZE = 1024
export const INITIAL_UPLOAD_JPEG_QUALITY = 0.78
const MIN_UPLOAD_JPEG_QUALITY = 0.55
const QUALITY_STEP = 0.08
const TARGET_UPLOAD_BYTES = 500 * 1024
const LARGE_SOURCE_BYTES = 8 * 1024 * 1024
const FALLBACK_PLANS = [
  { maxSize: 1024, quality: 0.78 },
  { maxSize: 768, quality: 0.68 },
  { maxSize: 640, quality: 0.58 }
]

export const getDataUrlByteSize = (value) => {
  const base64 = String(value || '').split(',').pop() || ''
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

export const formatBytes = (bytes) => {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '0 KB'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export const prepareImageForAnalysis = async (source, sourceLabel = 'image') => {
  const start = performance.now()
  const sourceCanvas = typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement
  const sourceIsFile = typeof File !== 'undefined' && source instanceof File
  const sourceIsBlob = typeof Blob !== 'undefined' && source instanceof Blob
  let img = null
  const canvas = document.createElement('canvas')

  try {
    try {
      img = sourceCanvas ? source : await loadImage(source, sourceLabel)
    } catch (error) {
      const metadata = getImageOperationMetadata(source, sourceLabel, { stage: 'decode' })
      logAppEvent('IMAGE_DECODE_FAILED', {
        level: 'error',
        screen: 'scan',
        operation: 'image decode',
        normalized_message: 'Could not decode image.',
        metadata
      })
      if (isLikelyLowMemoryImageError(error)) {
        logAppEvent('IMAGE_LOW_MEMORY_FALLBACK', {
          level: 'warn',
          screen: 'scan',
          operation: 'image decode',
          normalized_message: 'Image decode likely failed due to memory pressure.',
          metadata
        })
      }
      throw error
    }

    const sourceWidth = sourceCanvas ? source.width : img.width
    const sourceHeight = sourceCanvas ? source.height : img.height
    const originalBytes = sourceIsFile || sourceIsBlob
      ? source.size
      : sourceCanvas
      ? Math.round(sourceWidth * sourceHeight * 4)
      : getDataUrlByteSize(source)
    const plans = getCompressionPlans(originalBytes)
    let lastError = null

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]
      const { width, height } = fitWithinMax(sourceWidth, sourceHeight, plan.maxSize)
      let quality = plan.quality
      let blob = null

      try {
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d')
        if (!context) throw new Error('Could not allocate image canvas')
        context.drawImage(img, 0, 0, width, height)

        blob = await canvasToBlob(canvas, quality)
        while (blob.size > TARGET_UPLOAD_BYTES && quality > MIN_UPLOAD_JPEG_QUALITY) {
          quality = Math.max(MIN_UPLOAD_JPEG_QUALITY, quality - QUALITY_STEP)
          blob = await canvasToBlob(canvas, quality)
        }

        const previewUrl = URL.createObjectURL(blob)
        logAppEvent('IMAGE_OBJECT_URL_CREATED', {
          level: 'info',
          screen: 'scan',
          operation: 'image preview url',
          metadata: { source: sourceLabel, blob_size_bytes: blob.size }
        })

        const durationMs = Math.round(performance.now() - start)
        const diagnostics = {
          ...getImageOperationMetadata(source, sourceLabel, { stage: 'compress' }),
          original_size_bytes: originalBytes,
          original_size_display: formatBytes(originalBytes),
          original_width: sourceWidth,
          original_height: sourceHeight,
          upload_size_bytes: blob.size,
          upload_size_display: formatBytes(blob.size),
          upload_width: width,
          upload_height: height,
          jpeg_quality: Number(quality.toFixed(2)),
          compression_target_px: plan.maxSize,
          compression_plan_index: index,
          fallback_used: index > 0 || plan.reason !== 'default',
          target_size_bytes: TARGET_UPLOAD_BYTES,
          target_met: blob.size <= TARGET_UPLOAD_BYTES,
          compression_duration_ms: durationMs
        }

        recordImageDiagnostics(diagnostics)
        recordPerformanceMetric('IMAGE_COMPRESSION_SUCCESS', diagnostics)
        logAppEvent('IMAGE_PAYLOAD_READY', {
          level: 'info',
          screen: 'scan',
          operation: 'prepare image payload',
          metadata: diagnostics
        })
        if (diagnostics.fallback_used) {
          logAppEvent('IMAGE_COMPRESSION_FALLBACK_USED', {
            level: 'warn',
            screen: 'scan',
            operation: 'prepare image payload',
            metadata: diagnostics
          })
        }

        return {
          dataUrl: null,
          previewUrl,
          blob,
          diagnostics
        }
      } catch (error) {
        lastError = error
        const retryMetadata = getImageOperationMetadata(source, sourceLabel, {
          stage: 'compress',
          compression_target_px: plan.maxSize,
          compression_quality: plan.quality,
          compression_plan_index: index,
          next_compression_target_px: plans[index + 1]?.maxSize || null
        })
        logAppEvent('IMAGE_PROCESSING_STAGE_FAILED', {
          level: 'warn',
          screen: 'scan',
          operation: 'image compression stage',
          normalized_message: 'Image compression stage failed.',
          metadata: retryMetadata
        })
        if (index < plans.length - 1) {
          logAppEvent('IMAGE_COMPRESSION_RETRY', {
            level: 'warn',
            screen: 'scan',
            operation: 'image compression retry',
            metadata: retryMetadata
          })
        }
        canvas.width = 0
        canvas.height = 0
      }
    }

    const failureMetadata = getImageOperationMetadata(source, sourceLabel, { stage: 'compress' })
    logAppEvent('IMAGE_COMPRESSION_FAILED', {
      level: 'error',
      screen: 'scan',
      operation: 'prepare image payload',
      normalized_message: 'Image compression failed.',
      metadata: failureMetadata
    })
    if (isLikelyLowMemoryImageError(lastError)) {
      logAppEvent('IMAGE_LOW_MEMORY_FALLBACK', {
        level: 'warn',
        screen: 'scan',
        operation: 'prepare image payload',
        normalized_message: 'Image compression likely failed due to memory pressure.',
        metadata: failureMetadata
      })
    }
    throw lastError || new Error('Failed to compress image for analysis')
  } finally {
    canvas.width = 0
    canvas.height = 0
    if (sourceCanvas) {
      source.width = 0
      source.height = 0
    }
    if (!sourceCanvas && img) {
      img.onload = null
      img.onerror = null
      img.src = ''
    }
  }
}

export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    if (!blob) {
      reject(new Error('Missing image blob for analysis'))
      return
    }

    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to prepare image for analysis'))
    reader.readAsDataURL(blob)
  })

export const revokeImagePreview = (previewUrl) => {
  if (!previewUrl || !previewUrl.startsWith('blob:')) return
  URL.revokeObjectURL(previewUrl)
  recordPerformanceMetric('IMAGE_OBJECT_URL_REVOKED', { preview_url_type: 'blob' })
  logAppEvent('IMAGE_OBJECT_URL_REVOKED', {
    level: 'info',
    screen: 'scan',
    operation: 'image preview url'
  })
}

const getCompressionPlans = (sourceBytes) => {
  const conservative = shouldUseConservativeCompression(sourceBytes)
  const startIndex = conservative ? 1 : 0
  const plans = FALLBACK_PLANS.slice(startIndex)
  if (startIndex > 0) {
    plans[0] = { ...plans[0], reason: 'large-or-low-memory-source' }
  }
  return plans
}

const shouldUseConservativeCompression = (sourceBytes) => {
  if (Number(sourceBytes) > LARGE_SOURCE_BYTES) return true
  if (typeof navigator === 'undefined') return false

  const deviceMemory = Number(navigator.deviceMemory)
  const userAgent = navigator.userAgent || ''
  const isMobile = /Android|iPhone|iPad|iPod/i.test(userAgent)
  if (deviceMemory > 0 && deviceMemory <= 4) return true
  if (isMobile && !deviceMemory) return true

  return false
}

const fitWithinMax = (width, height, maxSize) => {
  if (width <= maxSize && height <= maxSize) {
    return { width, height }
  }

  const ratio = Math.min(maxSize / width, maxSize / height)
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  }
}

const loadImage = (source, sourceLabel) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    let objectUrl = null

    const releaseObjectUrl = () => {
      if (!objectUrl) return
      URL.revokeObjectURL(objectUrl)
      logAppEvent('IMAGE_OBJECT_URL_REVOKED', {
        level: 'info',
        screen: 'scan',
        operation: 'image decode url'
      })
      objectUrl = null
    }

    img.decoding = 'async'
    img.onload = () => {
      releaseObjectUrl()
      resolve(img)
    }

    img.onerror = () => {
      releaseObjectUrl()
      reject(new Error('Failed to decode image for analysis'))
    }

    const sourceIsFile = typeof File !== 'undefined' && source instanceof File
    const sourceIsBlob = typeof Blob !== 'undefined' && source instanceof Blob

    if (sourceIsFile || sourceIsBlob) {
      objectUrl = URL.createObjectURL(source)
      logAppEvent('IMAGE_OBJECT_URL_CREATED', {
        level: 'info',
        screen: 'scan',
        operation: 'image decode url',
        metadata: getImageOperationMetadata(source, sourceLabel, { stage: 'decode' })
      })
      img.src = objectUrl
    } else {
      img.src = source
    }
  })

const canvasToBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Failed to compress image for analysis'))
          }
        },
        'image/jpeg',
        quality
      )
    } catch (error) {
      reject(error)
    }
  })

const getImageOperationMetadata = (source, sourceLabel, extra = {}) => {
  const isFile = typeof File !== 'undefined' && source instanceof File
  const isBlob = typeof Blob !== 'undefined' && source instanceof Blob
  const lastModified = isFile && Number.isFinite(source.lastModified) ? source.lastModified : null
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''

  return {
    source: sourceLabel,
    stage: extra.stage || null,
    file_size_bytes: isFile || isBlob ? source.size : null,
    file_type: isFile || isBlob ? source.type || null : null,
    file_last_modified_age_ms: lastModified ? Math.max(0, Date.now() - lastModified) : null,
    viewport_width: typeof window === 'undefined' ? null : window.innerWidth,
    viewport_height: typeof window === 'undefined' ? null : window.innerHeight,
    device_memory: typeof navigator === 'undefined' ? null : navigator.deviceMemory || null,
    hardware_concurrency: typeof navigator === 'undefined' ? null : navigator.hardwareConcurrency || null,
    user_agent_family: getUserAgentFamily(userAgent),
    is_pwa: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true),
    is_online: typeof navigator === 'undefined' ? true : navigator.onLine,
    compression_target_px: extra.compression_target_px || null,
    compression_quality: extra.compression_quality || null,
    compression_plan_index: extra.compression_plan_index ?? null,
    next_compression_target_px: extra.next_compression_target_px || null
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