import { useState, useRef, useEffect } from 'react'

export const useCamera = () => {
  const [hasPermission, setHasPermission] = useState(null)
  const [isActive, setIsActive] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    if (isActive && !streamRef.current) {
      startCamera()
    }
    return () => {
      if (streamRef.current) {
        stopCamera()
      }
    }
  }, [isActive])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setHasPermission(true)
    } catch (err) {
      console.error('Camera access denied:', err)
      setHasPermission(false)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return null

    const context = canvasRef.current.getContext('2d')
    const video = videoRef.current

    canvasRef.current.width = video.videoWidth
    canvasRef.current.height = video.videoHeight
    context.drawImage(video, 0, 0)

    return canvasRef.current.toDataURL('image/jpeg', 0.8)
  }

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      })
      stream.getTracks().forEach(track => track.stop())
      setHasPermission(true)
    } catch (err) {
      setHasPermission(false)
    }
  }

  return {
    videoRef,
    canvasRef,
    hasPermission,
    isActive,
    setIsActive,
    capturePhoto,
    requestPermission
  }
}
