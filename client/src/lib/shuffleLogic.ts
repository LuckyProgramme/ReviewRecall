export const shuffleConfig = {
  tickStartPitch: 278,
  tickDecayPitch: 98,
  tickDuration: 0.04,
  dingPitch: 661,
  dingDecayDuration: 0.8,
  startDelay: 35,
  friction: 1.15,
  maxDelay: 400,
} as const

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = window.setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}

export class ShuffleSoundEffects {
  private ctx: AudioContext | null = null
  private voices = new Map<OscillatorNode, () => void>()

  async init(signal?: AbortSignal) {
    try {
      const AudioContextClass = window.AudioContext || (window as AudioWindow).webkitAudioContext
      if (!AudioContextClass) return false
      this.ctx ??= new AudioContextClass()
      if (this.ctx.state === 'suspended') {
        const resumeTimeout = new AbortController()
        const abortTimeout = () => resumeTimeout.abort()
        signal?.addEventListener('abort', abortTimeout, { once: true })
        try {
          await Promise.race([this.ctx.resume(), wait(500, resumeTimeout.signal)])
        } finally {
          resumeTimeout.abort()
          signal?.removeEventListener('abort', abortTimeout)
        }
      }
      return !signal?.aborted && this.ctx.state === 'running'
    } catch {
      return false
    }
  }

  private playTone(type: OscillatorType, startPitch: number, endPitch: number, duration: number, volume: number, floor: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return null
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const now = ctx.currentTime
    osc.type = type
    osc.frequency.setValueAtTime(startPitch, now)
    if (startPitch !== endPitch) osc.frequency.exponentialRampToValueAtTime(endPitch, now + duration)
    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(floor, now + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)

    const ended = new Promise<void>(resolve => {
      const clean = () => {
        osc.onended = null
        osc.disconnect()
        gain.disconnect()
        this.voices.delete(osc)
        resolve()
      }
      osc.onended = clean
      this.voices.set(osc, clean)
    })
    osc.start(now)
    osc.stop(now + duration)
    return ended
  }

  playTick() {
    const config = shuffleConfig
    return this.playTone('triangle', config.tickStartPitch, config.tickDecayPitch, config.tickDuration, 0.35, 0.001)
  }

  playDing() {
    const config = shuffleConfig
    return this.playTone('sine', config.dingPitch, config.dingPitch, config.dingDecayDuration, 0.5, 0.0001)
  }

  stop() {
    for (const [voice, clean] of this.voices) {
      try { voice.stop() } catch { /* The voice already ended. */ }
      clean()
    }
  }

  dispose() {
    this.stop()
    const ctx = this.ctx
    this.ctx = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {})
  }
}

export const sfx = new ShuffleSoundEffects()

type ShuffleOptions<T> = {
  finalConcept?: T
  random?: () => number
  signal?: AbortSignal
  soundEffects?: ShuffleSoundEffects
}

/** Runs the brief's recursive friction loop and keeps the caller locked until the ding ends. */
export async function runDecelerationLoop<T>(
  conceptPool: readonly T[],
  onTextSwap: (concept: T) => void,
  onComplete: (concept: T) => void,
  options: ShuffleOptions<T> = {},
) {
  if (!conceptPool.length) return null
  const random = options.random ?? Math.random
  const finalConcept = options.finalConcept ?? conceptPool[Math.floor(random() * conceptPool.length)]
  const soundEffects = options.soundEffects ?? sfx
  const { signal } = options
  const audible = await soundEffects.init(signal)
  if (signal?.aborted) return null

  return new Promise<T | null>(resolve => {
    let delay = shuffleConfig.startDelay
    let timer: number | undefined
    let settled = false

    const finish = (result: T | null) => {
      if (settled) return
      settled = true
      if (timer !== undefined) window.clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      resolve(result)
    }
    const cancel = () => {
      soundEffects.stop()
      finish(null)
    }
    const loop = () => {
      if (signal?.aborted) { cancel(); return }
      if (delay > shuffleConfig.maxDelay) {
        onTextSwap(finalConcept)
        const ding = audible ? soundEffects.playDing() : null
        onComplete(finalConcept)
        // The concept locks when the ding begins; interaction unlocks after its decay.
        if (ding) void ding.then(() => finish(finalConcept))
        else timer = window.setTimeout(() => finish(finalConcept), shuffleConfig.dingDecayDuration * 1000)
        return
      }

      onTextSwap(conceptPool[Math.floor(random() * conceptPool.length)])
      if (audible) soundEffects.playTick()
      delay *= shuffleConfig.friction
      timer = window.setTimeout(loop, delay)
    }

    signal?.addEventListener('abort', cancel, { once: true })
    loop()
  })
}
