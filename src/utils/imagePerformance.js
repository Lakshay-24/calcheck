import { recordImageDiagnostics, recordPerformanceMetric } from '../services/diagnostics'
import { logAppEvent } from './appDiagnostics'

export const MAX_UPLOAD_IMAGE_SIZE = 1024
export const INITIAL_UPLOAD_JPEG_QUALITY = 0.8
const MIN_UPLOAD_JPEG_QUALITY = 0.55
const QUALITY_STEP = 0.08
const TARGET_UPLOAD_BYTES = 500 * 1024

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
  const img = sourceCanvas ? source : await loadImage(source)
  const sourceWidth = sourceCanvas ? source.width : img.width
  const sourceHeight = sourceCanvas ? source.height : img.height
  const originalBytes = sourceIsFile || sourceIsBlob
    ? source.size
    : sourceCanvas
    ? Math.round(sourceWidth * sourceHeight * 4)
    : getDataUrlByteSize(source)
  const { width, height } = fitWithinMax(sourceWidth, sourceHeight, MAX_UPLOAD_IMAGE_SIZE)
  const canvas = document.createElement('canvas')

  let blob = null
  let quality = INITIAL_UPLOAD_JPEG_QUALITY

  try {
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img, 0, 0, width, height)

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
      metadata: { source: sourceLabel, blob_size: blob.size }
    })

    const durationMs = Math.round(performance.now() - start)
    const diagnostics = {
      source: sourceLabel,
      original_size_bytes: originalBytes,
      original_size_display: formatBytes(originalBytes),
      original_width: sourceWidth,
      original_height: sourceHeight,
      upload_size_bytes: blob.size,
      upload_size_display: formatBytes(blob.size),
      upload_width: width,
      upload_height: height,
      jpeg_quality: Number(quality.toFixed(2)),
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

    return {
      dataUrl: null,
      previewUrl,
      blob,
      diagnostics
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
    if (sourceCanvas) {
      source.width = 0
      source.height = 0
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

const loadImage = (source) =>
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

    img.onload = () => {
      releaseObjectUrl()
      resolve(img)
    }

    img.onerror = () => {
      releaseObjectUrl()
      reject(new Error('Failed to load image for analysis'))
    }

    const sourceIsFile = typeof File !== 'undefined' && source instanceof File
    const sourceIsBlob = typeof Blob !== 'undefined' && source instanceof Blob

    if (sourceIsFile || sourceIsBlob) {
      objectUrl = URL.createObjectURL(source)
      logAppEvent('IMAGE_OBJECT_URL_CREATED', {
        level: 'info',
        screen: 'scan',
        operation: 'image decode url',
        metadata: { source_size_bytes: source.size, source_type: source.type || null }
      })
      img.src = objectUrl
    } else {
      img.src = source
    }
  })

const canvasToBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
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
  })