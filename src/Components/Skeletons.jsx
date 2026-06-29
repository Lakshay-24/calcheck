import React from 'react'

const shimmer = "relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent before:content-[''] motion-safe:before:animate-[shimmer_1.8s_ease-in-out_infinite]"

export function ScreenSkeleton({ titleWidth = 'w-36' }) {
  return (
    <div className="h-full w-full overflow-hidden bg-[#FFF9F2] text-[#151A22]">
      <div className="border-b border-[rgba(21,26,34,0.08)] bg-[#FFF9F2]/95 px-5 py-4 backdrop-blur-xl">
        <SkeletonBlock className={`h-8 ${titleWidth} rounded-2xl`} />
        <SkeletonBlock className="mt-2 h-4 w-48 rounded-xl" />
      </div>
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
        <CardSkeleton className="h-36" />
        <CardSkeleton className="h-24" />
        <MealCardSkeleton />
      </div>
    </div>
  )
}

export function ScanSkeleton() {
  return (
    <div className="h-full w-full overflow-hidden bg-[#FFF9F2] pb-24 text-[#151A22]">
      <div className="border-b border-[rgba(21,26,34,0.08)] bg-[#FFF9F2]/95 px-5 py-4 backdrop-blur-xl">
        <SkeletonBlock className="h-8 w-36 rounded-2xl" />
        <SkeletonBlock className="mt-2 h-4 w-48 rounded-xl" />
      </div>
      <div className="mx-auto max-w-3xl space-y-5 px-5 py-5">
        <SkeletonBlock className="h-14 rounded-[24px] bg-[#151A22]/10" />
        <SkeletonBlock className="h-14 rounded-[24px]" />
        <CardSkeleton className="h-56" />
        <MealCardSkeleton />
      </div>
    </div>
  )
}

export function ProfileSkeleton() {
  return (
    <div className="h-full w-full overflow-hidden bg-[#FFF9F2] pb-24 text-[#151A22]">
      <div className="border-b border-[rgba(21,26,34,0.08)] bg-[#FFF9F2]/95 px-5 py-4 backdrop-blur-xl">
        <SkeletonBlock className="h-8 w-28 rounded-2xl" />
        <SkeletonBlock className="mt-2 h-4 w-44 rounded-xl" />
      </div>
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
        <CardSkeleton className="h-32" />
        <CardSkeleton className="h-40" />
        <CardSkeleton className="h-28" />
      </div>
    </div>
  )
}

export function ProgressSkeleton() {
  return (
    <div className="h-full w-full overflow-y-auto bg-[#FFF9F2] pb-24 text-[#151A22]">
      <div className="border-b border-[rgba(21,26,34,0.08)] bg-[#FFF9F2]/95 px-5 py-4 backdrop-blur-xl">
        <SkeletonBlock className="h-8 w-32 rounded-2xl" />
        <SkeletonBlock className="mt-2 h-4 w-44 rounded-xl" />
      </div>
      <div className="mx-auto max-w-3xl space-y-5 px-5 py-5">
        <CardSkeleton className="h-48" />
        <CardSkeleton className="h-40" />
        <div className="space-y-3">
          <SkeletonBlock className="h-5 w-36 rounded-xl" />
          <MealCardSkeleton />
          <MealCardSkeleton />
        </div>
      </div>
    </div>
  )
}

export function CardSkeleton({ className = 'h-24' }) {
  return (
    <div className={`${className} rounded-[28px] border border-[rgba(21,26,34,0.08)] bg-white/90 p-5 shadow-[0_18px_50px_rgba(21,26,34,0.07)]`}>
      <SkeletonBlock className="h-4 w-24 rounded-xl" />
      <SkeletonBlock className="mt-4 h-8 w-36 rounded-2xl" />
      <SkeletonBlock className="mt-5 h-3 w-full rounded-xl" />
      <SkeletonBlock className="mt-2 h-3 w-2/3 rounded-xl" />
    </div>
  )
}

export function MealCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-[24px] border border-[rgba(21,26,34,0.08)] bg-white/90 p-4 shadow-[0_14px_36px_rgba(21,26,34,0.06)]">
      <SkeletonBlock className="h-16 w-16 shrink-0 rounded-[20px]" />
      <div className="min-w-0 flex-1 space-y-3 py-1">
        <SkeletonBlock className="h-4 w-40 max-w-full rounded-xl" />
        <SkeletonBlock className="h-3 w-24 rounded-xl" />
        <SkeletonBlock className="h-3 w-52 max-w-full rounded-xl" />
      </div>
    </div>
  )
}

function SkeletonBlock({ className = '' }) {
  return <div className={`${shimmer} bg-[#ECE7DD] ${className}`} />
}
