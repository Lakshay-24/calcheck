import React from 'react'
import { logSafeError } from '../utils/errorUtils'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    logSafeError('APP_RENDER_ERROR_BOUNDARY', error, {
      componentStack: info?.componentStack || null
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#FFF9F2] px-6 text-[#151A22]">
        <div className="w-full max-w-sm rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white/90 p-6 text-center shadow-[0_18px_50px_rgba(21,26,34,0.08)]">
          <h1 className="text-xl font-black text-[#151A22]">Something went wrong</h1>
          <p className="mt-2 text-sm font-semibold text-[#6B7280]">Reload CalCheck and try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-[18px] bg-[#151A22] px-4 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(21,26,34,0.14)]"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
