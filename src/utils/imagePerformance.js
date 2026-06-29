import { recordImageDiagnostics, recordPerformanceMetric } from '../services/diagnostics'
import { logAppEvent } from './appDiagnostics'

export const MAX_UPLOAD_IMAGE_SIZE = 1024
export const INITIAL_UPLOAD_JPEG_QUALITY = 0.78
const MIN_UPLOAD_JPEG_QUALITY = 0.55
const QUALITY_STEP = 0.08
const TARGET_UPLOAD_BYTES = 500 * 1024
const LARGE_SOURCE_BYTES = 6 * 1024 * 1024
const VERY_LARGE_SOURCE_BYTES = 8 * 1024 * 1024
const NORMAL_PLANS = [
  { maxSize: 1024, quality: 0.78, reason: 'normal' },
  { maxSize: 768, quality: 0.68, reason: 'fallback' },
  { maxSize: 640, quality: 0.6, reason: 'final-fallback' }
]
const MOBILE_PLANS = [
  { maxSize: 768, quality: 0.68, reason: 'mobile-or-pwa' },
  { maxSize: 640, quality: 0.6, reason: 'mobile-fallback' }
]
const LOW_MEMORY_PLANS = [
  { maxSize: 640, quality: 0.6, reason: 'low-memory-or-large-source' }
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
  const originalBytes = sourceIsFile || sourceIsBlob
    ? source.size
    : sourceCanvas
    ? Math.round(source.width * source.height * 4)
    : getDataUrlByteSize(source)
  const planInfo = getCompressionPlanInfo(source, originalBytes)
  const plans = planInfo.plans
  const canvas = document.createElement('canvas')
  let decodedImage = null
  let imageInfo = null

  if (sourceIsFile || sourceIsBlob) {
    logAppEvent('IMAGE_ORIGINAL_PREVIEW_SKIPPED', {
      level: 'info',
      screen: 'scan',
      operation: 'prepare image payload',
      metadata: getImageOperationMetadata(source, sourceLabel, { stage: 'select' })
    })
  }

  if (planInfo.lowMemoryMode) {
    logAppEvent('IMAGE_LOW_MEMORY_MODE_ENABLED', {
      level: 'info',
      screen: 'scan',
      operation: 'prepare image payload',
      metadata: {
        ...getImageOperationMetadata(source, sourceLabel, { stage: 'select' }),
        is_mobile: planInfo.isMobile,
        chosen_max_dimension: plans[0]?.maxSize || null,
        chosen_quality: plans[0]?.quality || null,
        mode_reason: planInfo.reason
      }
    })
  }

  try {
    try {
      imageInfo = await decodeImageForCompression(source, sourceLabel, plans[0]?.maxSize || MAX_UPLOAD_IMAGE_SIZE, sourceCanvas)
      decodedImage = imageInfo.drawable
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

    const sourceWidth = imageInfo.width
    const sourceHeight = imageInfo.height
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
        context.drawImage(decodedImage, 0, 0, width, height)

        blob = await canvasToBlob(canvas, quality)
        while (blob.size > TARGET_UPLOAD_BYTES && quality > MIN_UPLOAD_JPEG_QUALITY) {
          quality = Math.max(MIN_UPLOAD_JPEG_QUALITY, quality - QUALITY_STEP)
          blob = await canvasToBlob(canvas, quality)
        }

        const previewUrl = URL.createObjectURL(blob)
        logAppEvent('IMAGE_COMPRESSED_PREVIEW_CREATED', {
          level: 'info',
          screen: 'scan',
          operation: 'image preview url',
          metadata: {
            source: sourceLabel,
            compressed_size_bytes: blob.size,
            compression_target_px: plan.maxSize,
            decode_method: imageInfo.decodeMethod
          }
        })
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
          original_width: imageInfo.originalWidth || sourceWidth,
          original_height: imageInfo.originalHeight || sourceHeight,
          decoded_width: sourceWidth,
          decoded_height: sourceHeight,
          decode_method: imageInfo.decodeMethod,
          upload_size_bytes: blob.size,
          upload_size_display: formatBytes(blob.size),
          upload_width: width,
          upload_height: height,
          jpeg_quality: Number(quality.toFixed(2)),
          compression_target_px: plan.maxSize,
          compression_plan_index: index,
          fallback_used: planInfo.lowMemoryMode || index > 0,
          low_memory_mode: planInfo.lowMemoryMode,
          low_memory_mode_reason: planInfo.reason,
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
    imageInfo?.close?.()
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

const getCompressionPlanInfo = (source, sourceBytes) => {
  const env = getImageEnvironment(source, sourceBytes)
  if (env.isVeryLarge || env.lowDeviceMemory) {
    return { ...env, plans: LOW_MEMORY_PLANS, lowMemoryMode: true, reason: env.isVeryLarge ? 'very-large-source' : 'low-device-memory' }
  }
  if (env.isMobile || env.isPwa || env.isLarge || env.unknownMobileMemory) {
    return { ...env, plans: MOBILE_PLANS, lowMemoryMode: true, reason: env.isLarge ? 'large-source' : 'mobile-or-pwa' }
  }
  return { ...env, plans: NORMAL_PLANS, lowMemoryMode: false, reason: 'normal' }
}

const getImageEnvironment = (_source, sourceBytes) => {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  const deviceMemory = typeof navigator === 'undefined' ? null : Number(navigator.deviceMemory)
  const isMobileUa = /Android|iPhone|iPad|iPod/i.test(userAgent)
  const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches
  const isMobile = Boolean(isMobileUa || coarsePointer)
  const isPwa = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true)
  const hasDeviceMemory = Number.isFinite(deviceMemory) && deviceMemory > 0

  return {
    isMobile,
    isPwa,
    isLarge: Number(sourceBytes) > LARGE_SOURCE_BYTES,
    isVeryLarge: Number(sourceBytes) > VERY_LARGE_SOURCE_BYTES,
    lowDeviceMemory: hasDeviceMemory && deviceMemory <= 4,
    unknownMobileMemory: isMobile && !hasDeviceMemory,
    deviceMemory: hasDeviceMemory ? deviceMemory : null
  }
}

const decodeImageForCompression = async (source, sourceLabel, maxDecodeDimension, sourceCanvas) => {
  if (sourceCanvas) {
    return {
      drawable: source,
      width: source.width,
      height: source.height,
      originalWidth: source.width,
      originalHeight: source.height,
      decodeMethod: 'canvas',
      close: null
    }
  }

  const sourceIsFile = typeof File !== 'undefined' && source instanceof File
  const sourceIsBlob = typeof Blob !== 'undefined' && source instanceof Blob
  if ((sourceIsFile || sourceIsBlob) && typeof createImageBitmap === 'function') {
    const dimensions = await readImageDimensions(source).catch(() => null)
    const targetSize = dimensions
      ? fitWithinMax(dimensions.width, dimensions.height, maxDecodeDimension)
      : { width: maxDecodeDimension, height: maxDecodeDimension }

    try {
      const bitmap = await createImageBitmap(source, {
        resizeWidth: targetSize.width,
        resizeHeight: targetSize.height,
        resizeQuality: 'high'
      })
      logAppEvent('IMAGE_BITMAP_RESIZE_DECODE_USED', {
        level: 'info',
        screen: 'scan',
        operation: 'image decode',
        metadata: {
          ...getImageOperationMetadata(source, sourceLabel, {
            stage: 'decode',
            compression_target_px: maxDecodeDimension
          }),
          decoded_width: bitmap.width,
          decoded_height: bitmap.height,
          original_width: dimensions?.width || null,
          original_height: dimensions?.height || null
        }
      })
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        originalWidth: dimensions?.width || bitmap.width,
        originalHeight: dimensions?.height || bitmap.height,
        decodeMethod: 'createImageBitmap-resize',
        close: () => {
          bitmap.close?.()
          logAppEvent('IMAGE_BITMAP_CLOSED', {
            level: 'info',
            screen: 'scan',
            operation: 'image decode',
            metadata: { source: sourceLabel }
          })
        }
      }
    } catch (error) {
      logAppEvent('IMAGE_BITMAP_RESIZE_DECODE_FAILED', {
        level: 'warn',
        screen: 'scan',
        operation: 'image decode',
        normalized_message: 'Resized bitmap decode failed; falling back.',
        metadata: getImageOperationMetadata(source, sourceLabel, {
          stage: 'decode',
          compression_target_px: maxDecodeDimension
        })
      })
    }
  }

  const img = await loadImage(source, sourceLabel)
  return {
    drawable: img,
    width: img.width,
    height: img.height,
    originalWidth: img.width,
    originalHeight: img.height,
    decodeMethod: 'html-image',
    close: () => {
      img.onload = null
      img.onerror = null
      img.src = ''
    }
  }
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

const readImageDimensions = async (blob) => {
  const header = new DataView(await blob.slice(0, 262144).arrayBuffer())
  const png = header.byteLength >= 24 &&
    header.getUint32(0) === 0x89504e47 &&
    header.getUint32(4) === 0x0d0a1a0a
  if (png) {
    return { width: header.getUint32(16), height: header.getUint32(20) }
  }

  const jpeg = header.byteLength >= 4 && header.getUint16(0) === 0xffd8
  if (jpeg) {
    let offset = 2
    while (offset + 9 < header.byteLength) {
      if (header.getUint8(offset) !== 0xff) break
      const marker = header.getUint8(offset + 1)
      const blockLength = header.getUint16(offset + 2)
      if (blockLength < 2) break
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: header.getUint16(offset + 5),
          width: header.getUint16(offset + 7)
        }
      }
      offset += 2 + blockLength
    }
  }

  return null
}

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