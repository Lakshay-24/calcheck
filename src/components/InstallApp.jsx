import React, { useState } from 'react'
import { Download, Plus, Smartphone, X } from 'lucide-react'
import { INSTALL_PROMPT_SEEN_KEY, usePwaInstall } from '../hooks/usePwaInstall'

export function InstallButton({ compact = false, className = '' }) {
  const install = useInstallController()

  if (install.isInstalled) return null

  return (
    <>
      <button
        type="button"
        onClick={install.handleInstall}
        className={`bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 text-white font-semibold rounded-full shadow-[0_10px_24px_rgba(17,245,246,0.24)] flex items-center justify-center gap-2 active:scale-95 ${compact ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-sm'} ${className}`}
      >
        <Smartphone size={compact ? 16 : 18} className="text-white" />
        <span>Install App</span>
      </button>
      <InstallSheet {...install.sheetProps} />
    </>
  )
}

export function InstallProfileCard() {
  const install = useInstallController()

  if (install.isInstalled) return null

  return (
    <>
      <div className="bg-gradient-to-br from-brand-50 via-white to-white border border-brand-300/50 rounded-2xl p-5 shadow-[0_14px_34px_rgba(16,42,42,0.06)]">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center shadow-brand">
            <Smartphone size={23} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900">Install CalCheck</h2>
            <p className="text-sm text-gray-500 mt-1">
              Get faster access from your home screen.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={install.handleInstall}
          className="mt-5 w-full bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 text-white font-bold py-3 px-5 rounded-2xl shadow-[0_12px_28px_rgba(17,245,246,0.24)] active:scale-95 flex items-center justify-center gap-2"
        >
          <Download size={18} className="text-white" />
          <span>Install App</span>
        </button>
      </div>
      <InstallSheet {...install.sheetProps} />
    </>
  )
}

export function SmartInstallPrompt({ isOpen, onDismiss }) {
  const install = useInstallController()

  if (!isOpen || install.isInstalled) return null

  const handleMaybeLater = () => {
    localStorage.setItem(INSTALL_PROMPT_SEEN_KEY, 'true')
    onDismiss?.()
  }

  const handleInstall = async () => {
    localStorage.setItem(INSTALL_PROMPT_SEEN_KEY, 'true')
    await install.handleInstall()
    onDismiss?.()
  }

  return (
    <>
      <div className="bg-white border border-brand-300/50 rounded-2xl p-4 shadow-[0_14px_34px_rgba(16,42,42,0.08)] flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-300 to-brand-500 flex items-center justify-center shrink-0">
          <Smartphone size={21} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">Install CalCheck for faster access.</p>
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={handleInstall}
              className="bg-brand-900 text-white text-sm font-semibold rounded-full px-4 py-2"
            >
              Install App
            </button>
            <button
              type="button"
              onClick={handleMaybeLater}
              className="text-sm font-semibold text-gray-500"
            >
              Maybe Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleMaybeLater}
          className="self-start p-1.5 rounded-full hover:bg-gray-100"
          aria-label="Dismiss install prompt"
        >
          <X size={16} className="text-gray-500" />
        </button>
      </div>
      <InstallSheet {...install.sheetProps} />
    </>
  )
}

function useInstallController() {
  const { canUseNativePrompt, isInstalled, platform, promptInstall } = usePwaInstall()
  const [sheet, setSheet] = useState(null)

  const handleInstall = async () => {
    if (isInstalled) return

    if (platform.isMetaInAppBrowser) {
      setSheet('external-browser')
      return
    }

    if (canUseNativePrompt) {
      const result = await promptInstall()
      if (result?.outcome !== 'unavailable') return
    }

    if (platform.isIos) {
      setSheet(platform.isEmbeddedBrowser ? 'ios-embedded' : 'ios')
      return
    }

    setSheet('fallback')
  }

  return {
    canUseNativePrompt,
    isInstalled,
    platform,
    handleInstall,
    sheetProps: {
      type: sheet,
      platform,
      onClose: () => setSheet(null)
    }
  }
}

function InstallSheet({ type, platform, onClose }) {
  if (!type) return null

  if (type === 'external-browser') {
    return <ExternalBrowserSheet platform={platform} onClose={onClose} />
  }

  const isIos = type === 'ios' || type === 'ios-embedded'

  return (
    <div className="fixed inset-0 bg-black/55 z-50 flex items-end sm:items-center sm:justify-center px-0 sm:px-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-[0_-18px_50px_rgba(16,42,42,0.18)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Install CalCheck</h2>
            <p className="text-sm text-gray-600 mt-2">
              {isIos
                ? 'Add CalCheck to your home screen for faster access and a full-screen app experience.'
                : 'Use your browser menu to install CalCheck for faster access.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label="Close install instructions"
          >
            <X size={20} className="text-gray-700" />
          </button>
        </div>

        {type === 'ios-embedded' && (
          <div className="mt-5 rounded-2xl bg-brand-50 border border-brand-300/60 p-4">
            <p className="text-sm font-semibold text-gray-900">
              To install CalCheck, open this page in Safari first.
            </p>
          </div>
        )}

        {isIos ? <IosSteps embedded={type === 'ios-embedded'} /> : <FallbackSteps platform={platform} />}
      </div>
    </div>
  )
}

function ExternalBrowserSheet({ platform, onClose }) {
  const isIos = platform.isIos
  const browserName = isIos ? 'Safari' : 'Chrome'

  const handleOpenBrowser = () => {
    openExternalBrowser(platform)
  }

  return (
    <div className="fixed inset-0 bg-black/55 z-50 flex items-end sm:items-center sm:justify-center px-0 sm:px-4">
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-[0_-18px_50px_rgba(16,42,42,0.18)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Open in {browserName}</h2>
            <p className="text-sm text-gray-600 mt-2">
              To install CalCheck, open this page in {browserName}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100"
            aria-label="Close install message"
          >
            <X size={20} className="text-gray-700" />
          </button>
        </div>

        <p className="mt-5 text-xs font-semibold text-gray-500">
          Installation is only available in Safari or Chrome.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenBrowser}
            className="flex-1 bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 text-white font-bold py-3 px-5 rounded-2xl shadow-[0_12px_28px_rgba(17,245,246,0.24)] active:scale-95"
          >
            Open {browserName}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-2xl border border-gray-200 text-gray-600 font-bold active:scale-95"
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  )
}

function openExternalBrowser(platform) {
  if (typeof window === 'undefined') return

  const currentUrl = window.location.href

  if (platform.isAndroid) {
    const url = new URL(currentUrl)
    const intentUrl = `intent://${url.host}${url.pathname}${url.search}${url.hash}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;end`
    window.location.href = intentUrl
    return
  }

  window.open(currentUrl, '_blank', 'noopener,noreferrer')
}

function IosSteps({ embedded }) {
  return (
    <div className="mt-6 space-y-4">
      <InstallStep
        number="1"
        icon={<IosShareGlyph />}
        text={embedded ? 'Open in Safari, then tap the Share button' : 'Tap the Share button'}
      />
      <InstallStep
        number="2"
        icon={<IosHomeScreenGlyph />}
        text='Find "Add to Home Screen"'
      />
      <InstallStep
        number="3"
        icon={<Plus size={24} className="text-brand-900" />}
        text="Tap Add"
      />

      <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4">
        <p className="text-sm font-bold text-gray-900">Can't find it?</p>
        <p className="text-sm text-gray-600 mt-2">• Scroll down in the Share menu</p>
        <p className="text-sm text-gray-600 mt-1">• Or tap More</p>
      </div>
    </div>
  )
}

function FallbackSteps({ platform }) {
  return (
    <div className="mt-6 space-y-4">
      <InstallStep
        number="1"
        icon={<Download size={24} className="text-brand-900" />}
        text={platform.isAndroid ? 'Open the browser menu' : 'Open your browser menu'}
      />
      <InstallStep
        number="2"
        icon={<Smartphone size={24} className="text-brand-900" />}
        text='Choose "Install App" or "Add to Home Screen"'
      />
      <InstallStep
        number="3"
        icon={<Plus size={24} className="text-brand-900" />}
        text="Confirm the installation"
      />
    </div>
  )
}

function InstallStep({ number, icon, text }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-300/60 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Step {number}</p>
        <p className="text-base font-semibold text-gray-900 mt-0.5">{text}</p>
      </div>
    </div>
  )
}

function IosShareGlyph() {
  return (
    <svg width="25" height="25" viewBox="0 0 25 25" fill="none" aria-hidden="true">
      <path d="M8.2 10.2H6.5a2 2 0 0 0-2 2v6.3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.3a2 2 0 0 0-2-2h-1.7" stroke="rgb(var(--color-brand-deep))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 15.1V4.5" stroke="rgb(var(--color-brand-deep))" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.9 8.1 12.5 4.5l3.6 3.6" stroke="rgb(var(--color-brand-deep))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IosHomeScreenGlyph() {
  return (
    <svg width="25" height="25" viewBox="0 0 25 25" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="16" height="16" rx="4" stroke="rgb(var(--color-brand-deep))" strokeWidth="1.8" />
      <path d="M9 9h7M9 12.5h7M9 16h4.5" stroke="rgb(var(--color-brand-deep))" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
