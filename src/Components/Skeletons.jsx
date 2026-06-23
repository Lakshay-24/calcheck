import React from 'react'

export function ScreenSkeleton({ titleWidth = 'w-36' }) {
  return (
    <div className="h-full w-full bg-white overflow-hidden">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className={`h-8 ${titleWidth} rounded-xl bg-gray-100 animate-pulse`} />
        <div className="mt-2 h-4 w-48 rounded-lg bg-gray-100 animate-pulse" />
      </div>
      <div className="px-6 py-6 space-y-4">
        <CardSkeleton className="h-36" />
        <CardSkeleton className="h-24" />
        <MealCardSkeleton />
      </div>
    </div>
  )
}

export function CardSkeleton({ className = 'h-24' }) {
  return (
    <div className={`${className} rounded-2xl border border-gray-100 bg-gray-50 p-4 animate-pulse`}>
      <div className="h-4 w-24 rounded bg-gray-200" />
      <div className="mt-4 h-7 w-32 rounded bg-gray-200" />
    </div>
  )
}

export function MealCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 flex gap-3 animate-pulse">
      <div className="h-16 w-16 rounded-2xl bg-gray-100" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="h-4 w-40 rounded bg-gray-100" />
        <div className="h-3 w-24 rounded bg-gray-100" />
        <div className="h-3 w-52 rounded bg-gray-100" />
      </div>
    </div>
  )
}

export function ProgressSkeleton() {
  return (
    <div className="h-full w-full bg-white overflow-y-auto pb-24">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="h-8 w-32 rounded-xl bg-gray-100 animate-pulse" />
        <div className="mt-2 h-4 w-44 rounded-lg bg-gray-100 animate-pulse" />
      </div>
      <div className="px-6 py-6 space-y-6">
        <CardSkeleton className="h-48" />
        <CardSkeleton className="h-40" />
        <CardSkeleton className="h-32" />
      </div>
    </div>
  )
}
