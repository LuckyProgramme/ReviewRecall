import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import type { Clip } from '../../hooks/useRecallRecorder'
import { useRecallRecorder } from '../../hooks/useRecallRecorder'

export function RecallScreen({ conceptName, submitting, notice, onSubmit, onBack, onDiscard }: { conceptName: string; submitting: boolean; notice?: string; onSubmit: (clip: Clip) => void; onBack: () => Promise<boolean>; onDiscard: () => Promise<boolean> }) {
  const capture = useRecallRecorder()
  const [checking, setChecking] = useState(false)
  const [level, setLevel] = useState(0)
  const [checkError, setCheckError] = useState('')
  const checkStream = useRef<MediaStream | null>(null)
  const checkFrame = useRef(0)
  const checkAudio = useRef<AudioContext | null>(null)
  const checkGeneration = useRef(0)
  function endCheck() {
    checkGeneration.current++
    cancelAnimationFrame(checkFrame.current)
    checkStream.current?.getTracks().forEach((track) => track.stop())
    checkStream.current = null
    void checkAudio.current?.close()
    checkAudio.current = null
    setChecking(false)
    setLevel(0)
  }
  useEffect(() => () => {
    checkGeneration.current++
    cancelAnimationFrame(checkFrame.current)
    checkStream.current?.getTracks().forEach((track) => track.stop())
    void checkAudio.current?.close()
  }, [])
  async function startCheck() {
    setCheckError('')
    const token = ++checkGeneration.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (token !== checkGeneration.current) { stream.getTracks().forEach((track) => track.stop()); return }
      checkStream.current = stream
      const context = new AudioContext()
      checkAudio.current = context
      const analyzer = context.createAnalyser()
      analyzer.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyzer)
      const data = new Uint8Array(analyzer.fftSize)
      setChecking(true)
      function read() {
        analyzer.getByteTimeDomainData(data)
        const rms = Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length)
        setLevel(Math.min(100, Math.round(rms * 220)))
        checkFrame.current = requestAnimationFrame(read)
      }
      read()
    } catch { setCheckError('Could not access the microphone for a check. You can still try recording.') }
  }
  const nearEnd = capture.phase === 'recording' && capture.secondsLeft <= 10
  return <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-10">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-action">Recall</p>
    <h1 className="mt-3 font-display text-4xl">Explain {conceptName}</h1>
    <p className="mt-3 text-muted">Speak naturally in English, Filipino, or both. You have up to one minute.</p>
    <div className="mt-8 rounded-2xl border border-divider bg-paper p-6 shadow-upload sm:p-8">
      {notice && <p role="status" className="mb-5 rounded-lg bg-canvas p-3 text-sm">{notice}</p>}
      {capture.phase === 'idle' && <>
        <p className="text-sm leading-relaxed text-muted">Try a quiet place if you can. Browser noise controls may help with background sound, but overlapping voices can still affect transcription.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={submitting} onClick={() => void (checking ? endCheck() : startCheck())}>{checking ? 'Stop microphone check' : 'Optional microphone check'}</Button>{checking && <div className="w-24" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}><div className="h-2 rounded-full bg-divider"><div className="h-2 rounded-full bg-action" style={{ width: `${level}%` }} /></div></div>}</div>
        {checkError && <p role="alert" className="mt-2 text-sm text-danger">{checkError}</p>}
        <Button className="mt-6" disabled={submitting} onClick={() => { endCheck(); void capture.start() }}>Start recording</Button>
      </>}
      {capture.phase === 'requesting' && <p role="status">Waiting for microphone permission…</p>}
      {capture.phase === 'recording' && <>
        <p role="status" className="font-display text-3xl">Recording</p>
        <p className="mt-3 text-muted">{capture.secondsLeft} seconds remaining</p>
        <p aria-live="polite" className="sr-only">{nearEnd ? 'Ten seconds or less remain.' : ''}</p>
        <Button className="mt-6" onClick={capture.stop}>Stop recording</Button>
      </>}
      {capture.phase === 'ready' && capture.clip && <>
        <h2 className="font-display text-2xl">Listen before submitting</h2>
        <p role="status" className="sr-only">Recording complete. Your audio preview is ready.</p>
        <p className="mt-2 text-sm text-muted">{Math.ceil(capture.clip.seconds)} seconds recorded</p>
        <audio className="mt-5 w-full" controls src={capture.clip.url} aria-label="Your recorded explanation" />
        <div className="mt-6 flex flex-wrap gap-3"><Button disabled={submitting} onClick={() => capture.clip && onSubmit(capture.clip)}>{submitting ? 'Preparing feedback…' : 'Get feedback'}</Button><Button variant="secondary" disabled={submitting} onClick={async () => { if (await onDiscard()) { capture.clear(); void capture.start() } }}>Record again</Button><Button variant="utility" disabled={submitting} onClick={async () => { if (await onDiscard()) capture.clear() }}>Discard recording</Button></div>
      </>}
      {capture.phase === 'error' && <div role="alert"><p className="text-danger">{capture.error}</p><Button className="mt-4" onClick={capture.clear}>Try again</Button></div>}
    </div>
    <Button variant="utility" className="mt-5" disabled={submitting} onClick={async () => { if (await onBack()) { endCheck(); capture.clear() } }}>Back to concept</Button>
  </main>
}
