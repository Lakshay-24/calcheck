import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Camera, BarChart3, User } from 'lucide-react'

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  const tabs = [
    { path: '/', icon: Camera, label: 'Scan', id: 'scan' },
    { path: '/progress', icon: BarChart3, label: 'Progress', id: 'progress' },
    { path: '/profile', icon: User, label: 'Profile', id: 'profile' }
  ]

  const isActive = (path) => location.pathname === path

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-[rgba(21,26,34,0.08)] bg-[#FFF9F2]/95 px-3 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-2xl items-center justify-around gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = isActive(tab.path)

          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[22px] py-3 transition-all duration-300 ${
                active
                  ? 'bg-white text-[#151A22] shadow-[0_10px_28px_rgba(21,26,34,0.08)]'
                  : 'text-[#5F6978] hover:text-[#151A22]'
              }`}
            >
              {/* Icon */}
              <div className="relative">
                <Icon
                  size={24}
                  className={`transition-all duration-300 ${
                    active ? 'scale-105' : 'scale-100'
                  }`}
                  
                />
              </div>

              {/* Label */}
              <span
                className={`text-xs font-semibold transition-all duration-300 ${
                  active ? 'opacity-100' : 'opacity-70'
                }`}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Safe area for devices with notches/home indicators */}
      <div className="h-safe-bottom bg-[#FFF9F2]"></div>
    </nav>
  )
}
