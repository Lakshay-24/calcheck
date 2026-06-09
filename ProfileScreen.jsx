import React from 'react'

export default function ProfileScreen({ user }) {
  return (
    <div className="h-full w-full p-4 bg-white">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Profile</h1>
      <p className="text-gray-500">{user?.email}</p>
    </div>
  )
}
