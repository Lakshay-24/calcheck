import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, LogOut } from 'lucide-react'
import { InstallProfileCard } from '../components/InstallApp'
import { getUserProfile, isUserPro } from '../services/database'
import {
  cancelSubscription,
  createSubscription,
  openRazorpaySubscriptionCheckout,
  syncSubscription
} from '../services/subscriptions'
import { getDiagnosticsSnapshot, recordPerformanceMetric } from '../services/diagnostics'
import { signOut } from '../services/supabase'

export default function ProfileScreen({ user }) {
  const [signingOut, setSigningOut] = useState(false)
  const [profile, setProfile] = useState(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState(null)
  const [subscriptionNotice, setSubscriptionNotice] = useState(null)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [cancelStep, setCancelStep] = useState(null)
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false)
  const [diagnosticsTapCount, setDiagnosticsTapCount] = useState(0)
  const [diagnostics, setDiagnostics] = useState(() => getDiagnosticsSnapshot())

  useEffect(() => {
    if (!user?.id) return

    getUserProfile(user.id)
      .then(setProfile)
      .catch((error) => {
        console.error('Profile subscription load error:', error)
      })
  }, [user?.id])

  useEffect(() => {
    const refreshDiagnostics = () => setDiagnostics(getDiagnosticsSnapshot())

    window.addEventListener('calcheck-diagnostics-updated', refreshDiagnostics)
    window.addEventListener('online', refreshDiagnostics)
    window.addEventListener('offline', refreshDiagnostics)

    return () => {
      window.removeEventListener('calcheck-diagnostics-updated', refreshDiagnostics)
      window.removeEventListener('online', refreshDiagnostics)
      window.removeEventListener('offline', refreshDiagnostics)
    }
  }, [])

  const handleDiagnosticsTap = () => {
    const nextCount = diagnosticsTapCount + 1
    setDiagnosticsTapCount(nextCount)

    if (nextCount >= 5) {
      setDiagnosticsVisible((visible) => !visible)
      setDiagnosticsTapCount(0)
      setDiagnostics(getDiagnosticsSnapshot())
    }
  }

  const handleSignOut = async () => {
    try {
      setSigningOut(true)
      await signOut()
    } catch (error) {
      console.error('Sign out error:', error)
    } finally {
      setSigningOut(false)
    }
  }

  const handleSubscribe = async () => {
    if (!user?.id) return

    try {
      setSubscriptionLoading(true)
      setSubscriptionError(null)
      setSubscriptionNotice('Preparing secure checkout...')
      const flowStartedAt = performance.now()
      const flowId = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      recordPerformanceMetric('razorpay checkout timing', {
        step: 'UPGRADE_BUTTON_PRESSED',
        flowId,
        elapsedMs: 0
      })

      const checkoutPayload = await createSubscription({ flowId, flowStartedAt })
      if (checkoutPayload?.already_pro) {
        setProfile(checkoutPayload.profile)
        setSubscriptionNotice('CalCheck Pro is active.')
        return
      }

      await openRazorpaySubscriptionCheckout({
        keyId: checkoutPayload.key_id,
        subscriptionId: checkoutPayload.subscription_id,
        user,
        flowId,
        flowStartedAt,
        onAuthorized: async () => {
          setSubscriptionLoading(true)
          setSubscriptionNotice('Payment authorized. Confirming subscription...')

          try {
            const confirmedProfile = await waitForProConfirmation(user.id)
            setProfile(confirmedProfile)
            setSubscriptionNotice('CalCheck Pro is active.')
          } catch (error) {
            setSubscriptionError(error?.message || 'Subscription confirmation is still pending.')
          } finally {
            setSubscriptionLoading(false)
          }
        },
        onDismiss: () => {
          setSubscriptionNotice(null)
          setSubscriptionLoading(false)
        }
      })
    } catch (error) {
      console.error('Subscription checkout error:', error)
      setSubscriptionError(error?.message || 'Could not start subscription.')
      setSubscriptionNotice(null)
    } finally {
      setSubscriptionLoading(false)
    }
  }

  const handleManageSubscription = async () => {
    try {
      setSubscriptionLoading(true)
      setSubscriptionError(null)
      const result = await syncSubscription()
      if (result?.profile) setProfile(result.profile)
      setSubscriptionNotice('Subscription status refreshed.')
    } catch (error) {
      setSubscriptionError(error?.message || 'Could not refresh subscription.')
    } finally {
      setSubscriptionLoading(false)
    }
  }

  const handleCancelSubscription = async () => {
    try {
      setSubscriptionLoading(true)
      setSubscriptionError(null)
      const result = await cancelSubscription()
      if (result?.profile) setProfile(result.profile)
      setSubscriptionNotice('Subscription will cancel at the end of the billing period.')
    } catch (error) {
      setSubscriptionError(error?.message || 'Could not cancel subscription.')
    } finally {
      setSubscriptionLoading(false)
      setCancelStep(null)
    }
  }

  return (
    <div className="h-full w-full bg-white overflow-y-auto pb-24">
      <SignOutConfirmModal
        isOpen={showSignOutConfirm}
        loading={signingOut}
        onStay={() => setShowSignOutConfirm(false)}
        onSignOut={handleSignOut}
      />

      <CancelSubscriptionStepOneModal
        isOpen={cancelStep === 'intro'}
        onKeepPro={() => setCancelStep(null)}
        onContinue={() => setCancelStep('confirm')}
      />

      <CancelSubscriptionStepTwoModal
        isOpen={cancelStep === 'confirm'}
        loading={subscriptionLoading}
        onStayPro={() => setCancelStep(null)}
        onCancelSubscription={handleCancelSubscription}
      />

      <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <button
          type="button"
          onClick={handleDiagnosticsTap}
          className="text-sm text-gray-500 mt-1"
          aria-label="Your account"
        >
          Your account
        </button>
      </div>

      <div className="px-6 py-6 space-y-6">
        <div className="bg-gradient-to-br from-brand-50 to-white border border-brand-300/50 rounded-2xl p-6">
          <div className="w-16 h-16 bg-gradient-to-br from-brand-400 to-brand-500 rounded-full flex items-center justify-center text-brand-900 text-2xl font-bold mb-4 shadow-brand">
            {user?.email?.[0]?.toUpperCase() || '?'}
          </div>
          <p className="text-sm text-gray-500">Signed in as</p>
          <p className="text-lg font-semibold text-gray-900 break-all">{user?.email}</p>
        </div>

        <InstallProfileCard />

        <SubscriptionCard
          profile={profile}
          loading={subscriptionLoading}
          error={subscriptionError}
          notice={subscriptionNotice}
          onSubscribe={handleSubscribe}
          onManage={handleManageSubscription}
          onCancel={() => setCancelStep('intro')}
        />

        {diagnosticsVisible && <DiagnosticsPanel diagnostics={diagnostics} />}

        <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Account</p>
          <p className="text-sm text-gray-500">
            Meals are saved to your account and synced across sessions.
          </p>
        </div>

        <InfoLinksCard />

        <button
          onClick={() => setShowSignOutConfirm(true)}
          disabled={signingOut}
          className="w-full flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-4 px-6 rounded-2xl transition-all active:scale-95 disabled:opacity-70"
        >
          <LogOut size={20} />
          {signingOut ? 'Signing out...' : 'Sign Out'}
        </button>
      </div>
    </div>
  )
}

function DiagnosticsPanel({ diagnostics }) {
  const recentRequests = diagnostics.requests || []
  const startupSteps = diagnostics.startup || []
  const lifecycleEvents = diagnostics.lifecycle || []
  const lastFailed = diagnostics.lastFailedRequest
  const lastImage = diagnostics.lastImage

  return (
    <div className="bg-gray-950 text-gray-100 rounded-2xl p-4 space-y-4">
      <div>
        <p className="text-sm font-bold">Diagnostics</p>
        <p className="text-xs text-gray-400 mt-1">
          {diagnostics.online ? 'Online' : 'Offline'} - v{diagnostics.appVersion}
        </p>
        <p className="text-xs text-gray-400 mt-1 break-all">
          Build: {formatDiagnosticDate(diagnostics.buildTimestamp)}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-gray-400">Startup report</p>
        <div className="mt-2 space-y-2">
          {startupSteps.length === 0 ? (
            <p className="text-xs text-gray-500">No startup timings logged yet.</p>
          ) : (
            startupSteps.slice(0, 8).map((step) => (
              <div key={`${step.name}-${step.timestamp}`} className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-gray-100">{step.name}</span>
                  <span className={step.success ? 'text-brand-300' : 'text-red-300'}>
                    {step.timedOut ? 'timeout' : step.success ? 'success' : 'failed'}
                  </span>
                </div>
                <p className="mt-1 text-gray-400">
                  {step.durationMs}ms - blocks render: {step.blocksRender ? 'yes' : 'no'}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-gray-400">Last API durations</p>
        <div className="mt-2 space-y-2">
          {recentRequests.length === 0 ? (
            <p className="text-xs text-gray-500">No requests logged yet.</p>
          ) : (
            recentRequests.slice(0, 6).map((request) => (
              <div key={request.id} className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-gray-100">{request.requestName}</span>
                  <span className={request.success ? 'text-brand-300' : 'text-red-300'}>
                    {request.success ? 'success' : 'failed'}
                  </span>
                </div>
                <p className="mt-1 text-gray-400">
                  {request.durationMs}ms - {formatDiagnosticDate(request.endTime)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-gray-400">Lifecycle report</p>
        <div className="mt-2 space-y-2">
          {lifecycleEvents.length === 0 ? (
            <p className="text-xs text-gray-500">No lifecycle events logged yet.</p>
          ) : (
            lifecycleEvents.slice(0, 8).map((event) => (
              <div key={`${event.name}-${event.timestamp}`} className="rounded-xl bg-white/5 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-gray-100">{event.name}</span>
                  <span className="text-gray-400">{formatDiagnosticDate(event.timestamp)}</span>
                </div>
                <p className="mt-1 text-gray-400">
                  pending: {event.pendingRequests?.length || 0}
                  {event.source ? ` - source: ${event.source}` : ''}
                  {event.state ? ` - state: ${event.state}` : ''}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-gray-400">Last failed request</p>
        {lastFailed ? (
          <div className="mt-2 rounded-xl bg-red-950/40 border border-red-900 p-3 text-xs">
            <p className="font-semibold text-red-200">{lastFailed.requestName}</p>
            <p className="mt-1 text-red-100 break-words">{lastFailed.message}</p>
            <p className="mt-1 text-red-300">{formatDiagnosticDate(lastFailed.timestamp)}</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-500">No failed requests logged.</p>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase text-gray-400">Last image upload</p>
        {lastImage ? (
          <div className="mt-2 rounded-xl bg-white/5 p-3 text-xs text-gray-300">
            <p>
              Original: {lastImage.original_size_display} - {lastImage.original_width}x{lastImage.original_height}
            </p>
            <p className="mt-1">
              Upload: {lastImage.upload_size_display} - {lastImage.upload_width}x{lastImage.upload_height}
            </p>
            <p className="mt-1 text-gray-500">{formatDiagnosticDate(lastImage.timestamp)}</p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-500">No image diagnostics logged yet.</p>
        )}
      </div>
    </div>
  )
}

function formatDiagnosticDate(value) {
  if (!value || value === 'development') return value || 'Unknown'

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function InfoLinksCard() {
  const links = [
    { to: '/info/terms', label: 'Terms & Conditions' },
    { to: '/info/privacy', label: 'Privacy Policy' },
    { to: '/info/about', label: 'About Us' }
  ]

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4">
      <p className="text-sm font-semibold text-gray-700">Legal and Help</p>
      <div className="mt-3 divide-y divide-gray-100">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center justify-between py-3 text-sm font-semibold text-gray-700 hover:text-gray-900"
          >
            <span>{link.label}</span>
            <span className="text-gray-400">View</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function SignOutConfirmModal({ isOpen, loading, onStay, onSignOut }) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title="Sign out of CalCheck?"
      body="You can sign back in anytime with your Google account."
      loading={loading}
      primaryLabel="Stay Signed In"
      secondaryLabel="Sign Out"
      secondaryLoadingLabel="Signing out..."
      onPrimary={onStay}
      onSecondary={onSignOut}
      secondaryTone="danger"
    />
  )
}

function CancelSubscriptionStepOneModal({ isOpen, onKeepPro, onContinue }) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title="Leave CalCheck Pro?"
      body={
        <>
          <p>Your subscription will remain active until your current billing period ends.</p>
          <p className="mt-3">You won't be charged again after cancellation.</p>
        </>
      }
      primaryLabel="Keep Pro"
      secondaryLabel="Continue"
      onPrimary={onKeepPro}
      onSecondary={onContinue}
    />
  )
}

function CancelSubscriptionStepTwoModal({ isOpen, loading, onStayPro, onCancelSubscription }) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      title="We'll miss you 👋"
      body={
        <>
          <p>You'll lose access to:</p>
          <div className="mt-4 space-y-2">
            <p>• Unlimited food scans</p>
            <p>• Future premium nutrition features</p>
            <p>• Pro member benefits</p>
          </div>
          <p className="mt-4">
            Your Pro access will remain active until the end of your current billing period.
          </p>
          <p className="mt-4 font-semibold text-gray-900">Are you sure you want to cancel?</p>
        </>
      }
      loading={loading}
      primaryLabel="Stay Pro"
      secondaryLabel="Cancel Subscription"
      secondaryLoadingLabel="Cancelling..."
      onPrimary={onStayPro}
      onSecondary={onCancelSubscription}
      secondaryTone="danger"
    />
  )
}

function ConfirmModal({
  isOpen,
  title,
  body,
  loading = false,
  primaryLabel,
  secondaryLabel,
  secondaryLoadingLabel,
  onPrimary,
  onSecondary,
  secondaryTone = 'neutral'
}) {
  if (!isOpen) return null

  const secondaryClass = secondaryTone === 'danger'
    ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-100'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-900'

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center sm:justify-center px-0 sm:px-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-[0_-18px_50px_rgba(16,42,42,0.18)]">
        <h2 className="text-2xl font-bold text-gray-900 pr-8">{title}</h2>
        <div className="text-sm leading-6 text-gray-600 mt-3">
          {typeof body === 'string' ? <p>{body}</p> : body}
        </div>

        <div className="mt-7 space-y-3">
          <button
            type="button"
            onClick={onPrimary}
            disabled={loading}
            className="w-full bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-70 disabled:cursor-not-allowed text-brand-900 font-bold py-3 px-5 rounded-2xl shadow-brand"
          >
            {primaryLabel}
          </button>

          <button
            type="button"
            onClick={onSecondary}
            disabled={loading}
            className={`w-full disabled:opacity-70 disabled:cursor-not-allowed font-semibold py-3 px-5 rounded-2xl flex items-center justify-center gap-2 ${secondaryClass}`}
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            <span>{loading ? (secondaryLoadingLabel || secondaryLabel) : secondaryLabel}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

async function waitForProConfirmation(userId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const syncResult = await syncSubscription().catch(() => null)
    const latestProfile = syncResult?.profile || await getUserProfile(userId).catch(() => null)

    if (latestProfile?.is_pro) return latestProfile
    await new Promise((resolve) => window.setTimeout(resolve, 1500))
  }

  throw new Error('Payment authorized. Pro access will unlock after Razorpay confirms the subscription.')
}

function SubscriptionCard({ profile, loading, error, notice, onSubscribe, onManage, onCancel }) {
  const pro = isUserPro(profile)
  const status = profile?.subscription_status || 'free'
  const renewalDate = formatDate(profile?.current_period_end)
  const billingAmount = formatBillingAmount(profile)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-[0_14px_34px_rgba(16,42,42,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-500">Current Plan</p>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">
            {pro ? 'CalCheck Pro' : 'Free'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {pro ? 'Unlimited AI calorie scans' : '2 Free Scans'}
          </p>
        </div>

        {pro && (
          <div className="w-10 h-10 rounded-full bg-brand-50 border border-brand-300/70 flex items-center justify-center">
            <Check size={20} className="text-brand-700" />
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-500">Status</span>
          <span className="font-semibold text-gray-900 capitalize">{status}</span>
        </div>

        {pro && (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500">Renewal Date</span>
              <span className="font-semibold text-gray-900">{renewalDate || 'Pending'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-500">Billing Amount</span>
              <span className="font-semibold text-gray-900">{billingAmount}</span>
            </div>
          </>
        )}
      </div>

      {notice && (
        <div className="mt-4 rounded-xl bg-brand-50 border border-brand-300/60 p-3 text-sm font-semibold text-brand-700">
          {notice}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm font-semibold text-red-800">
          {error}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {!pro ? (
          <button
            type="button"
            onClick={onSubscribe}
            disabled={loading}
            className="w-full bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-500 hover:to-brand-400 disabled:opacity-70 disabled:cursor-not-allowed text-brand-900 font-bold py-3 px-5 rounded-2xl flex items-center justify-center gap-2 shadow-brand"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            <span>{loading ? 'Preparing secure checkout...' : 'Upgrade to Pro'}</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onManage}
              disabled={loading}
              className="w-full bg-gray-100 hover:bg-gray-200 disabled:opacity-70 text-gray-900 font-semibold py-3 px-5 rounded-2xl flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              <span>Manage Subscription</span>
            </button>
            {!profile?.subscription_cancel_at_period_end && (
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="w-full text-gray-600 hover:text-gray-900 disabled:opacity-70 font-semibold py-3 px-5 rounded-2xl"
              >
                Cancel Subscription
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function formatDate(value) {
  if (!value) return ''

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value))
}

function formatBillingAmount(profile) {
  if (profile?.subscription_currency === 'USD') return '$1.99/month'
  return '₹69/month'
}
