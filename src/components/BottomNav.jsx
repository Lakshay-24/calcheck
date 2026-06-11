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
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-0">
      <div className="flex justify-around items-center h-20 max-w-2xl mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = isActive(tab.path)

          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-all duration-300 relative group ${
                active
                  ? 'text-green-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {/* Icon */}
              <div className="relative">
                <Icon
                  size={28}
                  className={`transition-all duration-300 ${
                    active ? 'scale-110' : 'scale-100'
                  }`}
                  fill={active ? 'currentColor' : 'none'}
                />
                {/* Active indicator dot */}
                {active && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-green-600 rounded-full"></div>
                )}
              </div>

              {/* Label */}
              <span
                className={`text-xs font-semibold transition-all duration-300 ${
                  active ? 'opacity-100' : 'opacity-70'
                }`}
              >
                {tab.label}
              </span>

              {/* Active background indicator */}
              {active && (
                <div className="absolute inset-0 bg-green-50 -z-10 rounded-2xl opacity-0"></div>
              )}
            </button>
          )
        })}
      </div>

      {/* Safe area for devices with notches/home indicators */}
      <div className="h-safe-bottom bg-white"></div>
    </nav>
  )
}
