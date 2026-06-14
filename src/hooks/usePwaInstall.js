import { useCallback, useEffect, useSyncExternalStore } from 'react'

const APP_INSTALLED_EVENT = 'calcheck:pwa-install-state'

let deferredPrompt = null
let installed = detectInstalled()
let snapshot = buildSnapshot()

const subscribers = new Set()

const notify = () => {
  installed = detectInstalled()
  snapshot = buildSnapshot()
  subscribers.forEach((callback) => callback())
}

const subscribe = (callback) => {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

const getSnapshot = () => snapshot

const getServerSnapshot = () => ({
  canUseNativePrompt: false,
  isInstalled: false,
  platform: {
    isIos: false,
    isAndroid: false,
    isSafari: false,
    isChrome: false,
    isEdge: false,
    isInstagramBrowser: false,
    isFacebookBrowser: false,
    isMessengerBrowser: false,
    isMetaInAppBrowser: false,
    isEmbeddedBrowser: false
  }
})

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })

  window.addEventListener('focus', notify)
  window.addEventListener('pageshow', notify)

  const standaloneQuery = window.matchMedia?.('(display-mode: standalone)')
  standaloneQuery?.addEventListener?.('change', notify)
  standaloneQuery?.addListener?.(notify)
}

export function usePwaInstall() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    notify()
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return { outcome: 'unavailable' }
    }

    const promptEvent = deferredPrompt
    deferredPrompt = null
    notify()

    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    notify()
    return choice
  }, [])

  return {
    ...state,
    promptInstall
  }
}

function detectInstalled() {
  if (typeof window === 'undefined') return false

  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator?.standalone === true
  )
}

function getPlatformInfo() {
  if (typeof window === 'undefined') {
    return getServerSnapshot().platform
  }

  const userAgent = window.navigator.userAgent || ''
  const vendor = window.navigator.vendor || ''
  const isIpadOS = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1
  const isIos = /iPad|iPhone|iPod/.test(userAgent) || isIpadOS
  const isAndroid = /Android/i.test(userAgent)
  const isCriOS = /CriOS/i.test(userAgent)
  const isFxiOS = /FxiOS/i.test(userAgent)
  const isEdgiOS = /EdgiOS/i.test(userAgent)
  const isChrome = (/Chrome|CriOS/i.test(userAgent) && !/Edg|EdgiOS|OPR|SamsungBrowser/i.test(userAgent)) || /Chrome/i.test(vendor)
  const isEdge = /Edg|EdgiOS/i.test(userAgent)
  const isSafari = isIos && /Safari/i.test(userAgent) && /Apple/i.test(vendor) && !isCriOS && !isFxiOS && !isEdgiOS
  const isInstagramBrowser = /Instagram/i.test(userAgent)
  const isFacebookBrowser = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|FB_IAB\/FB4A/i.test(userAgent)
  const isMessengerBrowser = /Messenger|FB_IAB\/Messenger|FBAN\/Messenger|FBAN\/Orca|FBAV\/Orca/i.test(userAgent)
  const isMetaInAppBrowser = isInstagramBrowser || isFacebookBrowser || isMessengerBrowser
  const isEmbeddedBrowser = isMetaInAppBrowser || (isIos && (
    /GSA|Line|Twitter|LinkedInApp|WhatsApp/i.test(userAgent) ||
    (!isSafari && !isCriOS && !isFxiOS && !isEdgiOS)
  ))

  return {
    isIos,
    isAndroid,
    isSafari,
    isChrome,
    isEdge,
    isInstagramBrowser,
    isFacebookBrowser,
    isMessengerBrowser,
    isMetaInAppBrowser,
    isEmbeddedBrowser
  }
}

function buildSnapshot() {
  return {
    canUseNativePrompt: Boolean(deferredPrompt),
    isInstalled: installed,
    platform: getPlatformInfo()
  }
}

export const INSTALL_PROMPT_SEEN_KEY = 'calcheck-install-smart-prompt-seen'
