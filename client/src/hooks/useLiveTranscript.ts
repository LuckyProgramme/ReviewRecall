import { useEffect, useState } from 'react'

type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string
  start: () => void; abort: () => void
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }

// Preview only. The server independently transcribes the audio used for evaluation.
export function useLiveTranscript(recording: boolean) {
  const [text, setText] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    if (!recording) return
    const speechWindow = window as SpeechWindow
    const Constructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Constructor) return
    const speech = new Constructor()
    let disposed = false
    let failed = false
    let settled = ''
    let segment = ''
    queueMicrotask(() => { if (!disposed) { setText(''); setUnavailable(false) } })
    speech.continuous = true
    speech.interimResults = true
    speech.lang = navigator.language || 'en-US'
    speech.onresult = (event) => {
      if (disposed) return
      segment = Array.from(event.results).map(result => result[0].transcript).join(' ')
      setText(`${settled} ${segment}`.trim())
    }
    speech.onerror = (event) => {
      if (disposed || event.error === 'no-speech' || event.error === 'aborted') return
      failed = true
      setUnavailable(true)
    }
    speech.onend = () => {
      if (disposed || failed) return
      settled = `${settled} ${segment}`.trim()
      segment = ''
      try { speech.start() } catch { setUnavailable(true) }
    }
    try { speech.start() } catch { queueMicrotask(() => { if (!disposed) setUnavailable(true) }) }
    return () => {
      disposed = true
      speech.onend = null
      speech.onresult = null
      speech.onerror = null
      speech.abort()
    }
  }, [recording])
  const speechWindow = window as SpeechWindow
  return { text, available: !unavailable && !!(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition) }
}
