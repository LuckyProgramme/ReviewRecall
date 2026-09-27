import { useCallback, useEffect, useRef, useState } from 'react'

export type Clip = { blob: Blob; seconds: number; url: string }
type CaptureState = { phase: 'idle' | 'requesting' | 'recording' | 'ready' | 'error'; clip?: Clip; secondsLeft: number; error?: string }
const maxSeconds = 60

export function createFinalizer() {
  let finished = false
  return () => {
    if (finished) return false
    finished = true
    return true
  }
}

export function useRecallRecorder() {
  const [state, setState] = useState<CaptureState>({ phase: 'idle', secondsLeft: maxSeconds })
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const deadline = useRef(0)
  const started = useRef(0)
  const generation = useRef(0)
  const clipUrl = useRef<string | null>(null)

  const stopTracks = () => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
  }
  const clear = useCallback(() => {
    generation.current++
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
    recorder.current = null
    stopTracks()
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current)
    clipUrl.current = null
    setState({ phase: 'idle', secondsLeft: maxSeconds })
  }, [])
  useEffect(() => () => {
    generation.current++
    if (recorder.current?.state !== 'inactive') recorder.current?.stop()
    stopTracks()
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current)
  }, [])

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])
  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState({ phase: 'error', secondsLeft: maxSeconds, error: 'This browser cannot record audio. Try an updated browser with microphone access.' })
      return
    }
    const token = ++generation.current
    setState({ phase: 'requesting', secondsLeft: maxSeconds })
    try {
      const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {}
      const audio: MediaTrackConstraints = {
        ...(supported.noiseSuppression && { noiseSuppression: true }),
        ...(supported.echoCancellation && { echoCancellation: true }),
        ...(supported.autoGainControl && { autoGainControl: true }),
      }
      const acquired = await navigator.mediaDevices.getUserMedia({ audio })
      if (token !== generation.current) { acquired.getTracks().forEach((track) => track.stop()); return }
      stream.current = acquired
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'].find((mime) => MediaRecorder.isTypeSupported(mime))
      if (!preferred) {
        stopTracks()
        setState({ phase: 'error', secondsLeft: maxSeconds, error: 'This browser cannot record a supported audio format. Try a browser that supports WebM or Ogg recording.' })
        return
      }
      const active = new MediaRecorder(acquired, preferred ? { mimeType: preferred } : undefined)
      recorder.current = active
      const chunks: BlobPart[] = []
      const finalize = createFinalizer()
      active.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      active.onerror = () => {
        if (token !== generation.current || !finalize()) return
        stopTracks()
        setState({ phase: 'error', secondsLeft: maxSeconds, error: 'Recording failed. Please try again.' })
      }
      active.onstop = () => {
        stopTracks()
        if (token !== generation.current || !finalize()) return
        const seconds = Math.max(0, (Date.now() - started.current) / 1000)
        const blob = new Blob(chunks, { type: preferred.split(';')[0] })
        if (!blob.size) {
          setState({ phase: 'error', secondsLeft: maxSeconds, error: 'No audio was captured. Please record again.' })
          return
        }
        const url = URL.createObjectURL(blob)
        clipUrl.current = url
        setState({ phase: 'ready', secondsLeft: 0, clip: { blob, seconds, url } })
      }
      active.start(250)
      started.current = Date.now()
      deadline.current = started.current + maxSeconds * 1000
      setState({ phase: 'recording', secondsLeft: maxSeconds })
      timer.current = window.setInterval(() => {
        const remaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))
        setState((previous) => previous.phase === 'recording' ? { ...previous, secondsLeft: remaining } : previous)
        if (remaining === 0 && active.state === 'recording') active.stop()
      }, 250)
    } catch (error) {
      if (token !== generation.current) return
      stopTracks()
      const name = error instanceof DOMException ? error.name : ''
      setState({ phase: 'error', secondsLeft: maxSeconds, error: name === 'NotAllowedError' ? 'Microphone access was denied. Allow access in your browser and try again.' : name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' : 'Could not start the microphone. Please try again.' })
    }
  }, [])
  return { ...state, start, stop, clear }
}
