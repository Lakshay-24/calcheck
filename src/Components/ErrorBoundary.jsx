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
      <div className="h-screen w-screen bg-white flex items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-500">Reload CalCheck</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
