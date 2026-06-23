import React, { useMemo, useState } from 'react'
import { ImageIcon, Loader2, Share2, X } from 'lucide-react'
import { formatLocalTime, getUserTimezone, parseDatabaseTimestamp } from '../utils/timezone'
import { getErrorMessage, logSafeError } from '../utils/errorUtils'

export function MealCard({ meal, timezone = getUserTimezone(), onClick, compact = false }) {
  const imageSrc = getMealImageSrc(meal)
  const dateLabel = formatMealDateTime(meal, timezone)

  return (
    <button
      type="button"
      onClick={() => onClick?.(meal)}
      className={`w-full bg-white border border-gray-200 rounded-2xl text-left hover:border-brand-300 hover:shadow-sm active:scale-[0.99] transition-all ${compact ? 'p-3' : 'p-4'}`}
    >
      <div className="flex gap-3">
        <MealImage src={imageSrc} className={compact ? 'w-14 h-14' : 'w-16 h-16'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{meal?.food_name || 'Saved meal'}</p>
              <p className="text-xs text-gray-500 mt-1">{dateLabel}</p>
            </div>
            <p className="shrink-0 text-sm font-bold text-brand-700">{formatNumber(meal?.calories)} kcal</p>
          </div>
          <p className="text-xs text-gray-500 mt-2 truncate">
            {formatNumber(meal?.protein)}g protein
            {meal?.carbs != null ? ` • ${formatNumber(meal.carbs)}g carbs` : ''}
            {meal?.fat != null ? ` • ${formatNumber(meal.fat)}g fat` : ''}
          </p>
        </div>
      </div>
    </button>
  )
}

export function MealDetailSheet({ meal, user, timezone = getUserTimezone(), onClose }) {
  const [shareState, setShareState] = useState({ loading: false, error: null, notice: null })
  const username = getShareUsername(user)
  const shareText = useMemo(() => getMealShareText(meal), [meal])

  if (!meal) return null

  const imageSrc = getMealImageSrc(meal)

  const handleShare = async () => {
    setShareState({ loading: true, error: null, notice: null })

    try {
      const blob = await generateMealShareCard(meal, { imageSrc, username })
      const file = new File([blob], 'calcheck-meal.png', { type: 'image/png' })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: meal.food_name || 'CalCheck meal',
          text: shareText
        })
        setShareState({ loading: false, error: null, notice: 'Shared' })
        return
      }

      if (navigator.share) {
        await navigator.share({
          title: meal.food_name || 'CalCheck meal',
          text: shareText,
          url: 'https://calcheck.app'
        })
        downloadBlob(blob, 'calcheck-meal.png')
        setShareState({ loading: false, error: null, notice: 'Image downloaded' })
        return
      }

      downloadBlob(blob, 'calcheck-meal.png')
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText)
      }
      setShareState({ loading: false, error: null, notice: 'Image downloaded' })
    } catch (error) {
      logSafeError('APP_ERROR_NORMALIZED', error, { operation: 'share meal card' })
      setShareState({
        loading: false,
        error: getErrorMessage(error, 'Could not share this meal.'),
        notice: null
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center sm:justify-center">
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-gray-400">Meal details</p>
            <h2 className="text-lg font-bold text-gray-900 truncate">{meal.food_name || 'Saved meal'}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label="Close meal details"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <MealImage src={imageSrc} className="w-full aspect-[4/3]" large />

          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Calories" value={`${formatNumber(meal.calories)} kcal`} />
            <MetricCard label="Protein" value={`${formatNumber(meal.protein)}g`} />
            <MetricCard label="Carbs" value={meal.carbs != null ? `${formatNumber(meal.carbs)}g` : 'N/A'} />
            <MetricCard label="Fat" value={meal.fat != null ? `${formatNumber(meal.fat)}g` : 'N/A'} />
          </div>

          <div className="rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            <DetailRow label="Portion" value={meal.portion_size} />
            <DetailRow label="Estimated grams" value={meal.estimated_grams ? `~${Math.round(meal.estimated_grams)}g` : null} />
            <DetailRow label="Confidence" value={meal.confidence != null ? `${Math.round(meal.confidence * 100)}%` : null} />
            <DetailRow label="Source" value={getMealSource(meal)} />
            <DetailRow label="Saved" value={formatMealDateTime(meal, timezone)} />
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleShare}
              disabled={shareState.loading}
              className="w-full bg-gray-900 text-white rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {shareState.loading ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
              <span>{shareState.loading ? 'Creating card...' : 'Share'}</span>
            </button>
            {shareState.notice && (
              <p className="text-center text-xs font-semibold text-brand-700">{shareState.notice}</p>
            )}
            {shareState.error && (
              <p className="text-center text-xs font-semibold text-red-600">{shareState.error}</p>
            )}
            <p className="text-center text-xs text-gray-400">Share card includes CalCheck branding.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl bg-gray-50 border border-gray-100 p-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900 text-right">{value || 'N/A'}</span>
    </div>
  )
}

function MealImage({ src, className, large = false }) {
  if (src) {
    return (
      <div className={`${className} shrink-0 rounded-2xl bg-gray-100 overflow-hidden`}>
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          onError={() => {
            console.warn('[CalCheck] MEAL_IMAGE_RENDER_FAILED', {
              source_type: getImageSourceType(src),
              src
            })
          }}
        />
      </div>
    )
  }

  return (
    <div className={`${className} shrink-0 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-50 border border-gray-200 flex items-center justify-center`}>
      {large ? <ImageIcon size={42} className="text-gray-300" /> : <ImageIcon size={22} className="text-gray-300" />}
    </div>
  )
}

function getImageSourceType(src) {
  if (typeof src !== 'string') return 'unknown'
  if (src.startsWith('blob:')) return 'blob'
  if (src.startsWith('data:')) return 'data-url'
  if (src.includes('/storage/v1/object/public/meal-images/')) return 'meal-images-public-url'
  return 'url'
}

function getMealImageSrc(meal) {
  const sources = [
    ['thumbnail_url', meal?.thumbnail_url],
    ['image_url', meal?.image_url],
    ['photo_url', meal?.photo_url],
    ['image', meal?.image],
    ['imageData', meal?.imageData]
  ]
  const selected = sources.find(([, value]) => Boolean(value))

  console.info('[CalCheck] MEAL_IMAGE_RENDER_SOURCE', {
    meal_id: meal?.id || null,
    source: selected?.[0] || 'placeholder'
  })

  return selected?.[1] || null
}

function getMealSource(meal) {
  return meal?.source || meal?.meal_source || meal?.input_source || null
}

function formatMealDateTime(meal, timezone) {
  const timestamp = meal?.timestamp
  if (!timestamp) return meal?.local_date || 'Saved meal'

  const date = parseDatabaseTimestamp(timestamp)
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    timeZone: meal?.timezone || timezone,
    month: 'short',
    day: 'numeric'
  }).format(date)

  return `${dateLabel} • ${formatLocalTime(timestamp, meal?.timezone || timezone)}`
}

function formatNumber(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

function getShareUsername(user) {
  const rawName = user?.user_metadata?.user_name || user?.user_metadata?.name || user?.email?.split('@')[0]
  const safeName = String(rawName || '').trim().replace(/\s+/g, '')
  return safeName ? `@${safeName.replace(/^@/, '')}` : null
}

function getMealShareText(meal) {
  const foodName = meal?.food_name || 'my meal'
  return `Logged my meal on CalCheck: ${foodName} - ${formatNumber(meal?.calories)} kcal, ${formatNumber(meal?.protein)}g protein. calcheck.app`
}

async function generateMealShareCard(meal, { imageSrc, username }) {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const ctx = canvas.getContext('2d')
  const footer = username ? `${username} · calcheck.app` : 'CalCheck · calcheck.app'

  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  roundRect(ctx, 70, 70, 940, 1210, 44, '#ffffff')

  if (imageSrc) {
    const image = await loadCanvasImage(imageSrc).catch(() => null)
    if (image) {
      drawCoverImage(ctx, image, 110, 110, 860, 610, 34)
    } else {
      drawImagePlaceholder(ctx, 110, 110, 860, 610)
    }
  } else {
    drawImagePlaceholder(ctx, 110, 110, 860, 610)
  }

  ctx.fillStyle = '#111827'
  ctx.font = '700 58px Arial'
  wrapText(ctx, meal?.food_name || 'Saved meal', 110, 810, 860, 68, 2)

  ctx.font = '700 48px Arial'
  ctx.fillStyle = '#0f766e'
  ctx.fillText(`${formatNumber(meal?.calories)} kcal`, 110, 990)
  ctx.fillStyle = '#2563eb'
  ctx.fillText(`${formatNumber(meal?.protein)}g protein`, 540, 990)

  ctx.font = '500 34px Arial'
  ctx.fillStyle = '#4b5563'
  const macroText = [
    meal?.carbs != null ? `${formatNumber(meal.carbs)}g carbs` : null,
    meal?.fat != null ? `${formatNumber(meal.fat)}g fat` : null
  ].filter(Boolean).join(' · ')
  if (macroText) ctx.fillText(macroText, 110, 1070)

  ctx.font = '700 34px Arial'
  ctx.fillStyle = '#111827'
  ctx.fillText('Tracked with CalCheck', 110, 1170)

  ctx.font = '500 30px Arial'
  ctx.fillStyle = '#6b7280'
  ctx.fillText(footer, 110, 1225)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not create share image.'))
    }, 'image/png')
  })
}

function drawImagePlaceholder(ctx, x, y, width, height) {
  roundRect(ctx, x, y, width, height, 34, '#eef2f7')
  ctx.fillStyle = '#9ca3af'
  ctx.font = '700 42px Arial'
  ctx.fillText('CalCheck meal', x + 60, y + height / 2)
}

function roundRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
  ctx.fillStyle = fillStyle
  ctx.fill()
}

function drawCoverImage(ctx, image, x, y, width, height, radius) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
  ctx.clip()

  const scale = Math.max(width / image.width, height / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
  ctx.restore()
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(' ')
  let line = ''
  let lines = 0

  words.forEach((word, index) => {
    const testLine = line ? `${line} ${word}` : word
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight)
      line = word
      lines += 1
    } else {
      line = testLine
    }

    if (index === words.length - 1 && lines < maxLines) {
      ctx.fillText(line, x, y + lines * lineHeight)
    }
  })
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
