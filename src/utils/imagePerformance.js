import { recordImageDiagnostics, recordPerformanceMetric } from '../services/diagnostics'

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
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export const prepareImageForAnalysis = async (source, sourceLabel = 'image') => {
  const start = performance.now()
  const sourceCanvas = typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement
  const img = sourceCanvas ? source : await loadImage(source)
  const sourceWidth = sourceCanvas ? source.width : img.width
  const sourceHeight = sourceCanvas ? source.height : img.height
  const { width, height } = fitWithinMax(sourceWidth, sourceHeight, MAX_UPLOAD_IMAGE_SIZE)
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(img, 0, 0, width, height)

  const sourceIsFile = typeof File !== 'undefined' && source instanceof File
  const sourceIsBlob = typeof Blob !== 'undefined' && source instanceof Blob
  const originalBytes = sourceIsFile || sourceIsBlob
    ? source.size
    : sourceCanvas
    ? getDataUrlByteSize(source.toDataURL('image/jpeg', 1))
    : getDataUrlByteSize(source)

  let quality = INITIAL_UPLOAD_JPEG_QUALITY
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  let uploadBytes = getDataUrlByteSize(dataUrl)

  while (uploadBytes > TARGET_UPLOAD_BYTES && quality > MIN_UPLOAD_JPEG_QUALITY) {
    quality = Math.max(MIN_UPLOAD_JPEG_QUALITY, quality - QUALITY_STEP)
    dataUrl = canvas.toDataURL('image/jpeg', quality)
    uploadBytes = getDataUrlByteSize(dataUrl)
  }

  const blob = await canvasToBlob(canvas, quality)
  const previewUrl = URL.createObjectURL(blob)
  const durationMs = Math.round(performance.now() - start)
  const diagnostics = {
    source: sourceLabel,
    original_size_bytes: originalBytes,
    original_size_display: formatBytes(originalBytes),
    original_width: sourceWidth,
    original_height: sourceHeight,
    upload_size_bytes: uploadBytes,
    upload_size_display: formatBytes(uploadBytes),
    upload_width: width,
    upload_height: height,
    jpeg_quality: Number(quality.toFixed(2)),
    target_size_bytes: TARGET_UPLOAD_BYTES,
    target_met: uploadBytes <= TARGET_UPLOAD_BYTES,
    compression_duration_ms: durationMs
  }

  recordImageDiagnostics(diagnostics)
  recordPerformanceMetric('image compression', diagnostics)

  return {
    dataUrl,
    previewUrl,
    diagnostics
  }
}

export const revokeImagePreview = (previewUrl) => {
  if (!previewUrl || !previewUrl.startsWith('blob:')) return
  URL.revokeObjectURL(previewUrl)
  recordPerformanceMetric('image preview revoked', { preview_url_type: 'blob' })
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

    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      resolve(img)
    }

    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image for analysis'))
    }

    const sourceIsFile = typeof File !== 'undefined' && source instanceof File
    const sourceIsBlob = typeof Blob !== 'undefined' && source instanceof Blob

    if (sourceIsFile || sourceIsBlob) {
      objectUrl = URL.createObjectURL(source)
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
