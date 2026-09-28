import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/shuffleLogic.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { runDecelerationLoop, ShuffleSoundEffects } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

function setup(t, mode = 'running') {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const voices = []
  class FakeContext {
    state = mode
    destination = {}
    get currentTime() { return Date.now() / 1000 }
    resume() { return mode === 'blocked' ? new Promise(() => {}) : Promise.reject(new Error('Audio unavailable')) }
    close() { this.state = 'closed'; return Promise.resolve() }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }
    }
    createOscillator() {
      let timer
      const voice = {
        type: '', onended: null, disconnected: false, pitch: null, endPitch: null,
        frequency: {
          setValueAtTime(value) { voice.pitch = value },
          exponentialRampToValueAtTime(value) { voice.endPitch = value },
        },
        connect() {}, disconnect() { voice.disconnected = true }, start() {},
        stop: (when = this.currentTime) => {
          clearTimeout(timer)
          // Simulate the ended event arriving slightly after scheduled playback.
          timer = setTimeout(() => voice.onended?.(), Math.max(0, (when - this.currentTime) * 1000) + 20)
        },
      }
      voices.push(voice)
      return voice
    }
  }
  const original = globalThis.window
  globalThis.window = mode === 'unsupported'
    ? { setTimeout, clearTimeout }
    : { AudioContext: FakeContext, setTimeout, clearTimeout }
  t.after(() => { globalThis.window = original })
  const sound = new ShuffleSoundEffects()
  t.after(() => sound.dispose())
  async function advance(ms) {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      t.mock.timers.tick(Math.min(10, ms - elapsed))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    }
  }
  return { sound, voices, advance }
}

test('the recursive loop applies 1.15 friction, ticks on every swap, and locks on the ding', async t => {
  const { sound, voices, advance } = setup(t)
  const ticks = []
  const completions = []
  let resolved = false
  const result = runDecelerationLoop(['A', 'B', 'C'], value => ticks.push({ time: Date.now(), value }), value => completions.push(value), {
    finalConcept: 'C', random: () => 0, soundEffects: sound,
  }).then(value => { resolved = true; return value })
  while (!voices.some(voice => voice.type === 'sine')) await advance(10)
  assert.equal(voices.filter(voice => voice.type === 'triangle').length, 18)
  assert.equal(voices[0].pitch, 278)
  assert.equal(voices[0].endPitch, 98)
  assert.equal(voices.at(-1).pitch, 661)
  assert.equal(ticks.at(-1).value, 'C')
  assert.deepEqual(completions, ['C'])
  assert.ok(ticks[17].time - ticks[16].time > ticks[1].time - ticks[0].time)
  await advance(800)
  assert.equal(resolved, false, 'keep controls locked until the ding actually ends')
  await advance(30)
  assert.equal(await result, 'C')
  assert.ok(voices.every(voice => voice.disconnected))
})

test('cancellation stops previews and disconnects active sound without completing a draw', async t => {
  const { sound, voices, advance } = setup(t)
  let ticks = 0
  const controller = new AbortController()
  const result = runDecelerationLoop(['A', 'B'], () => ticks++, () => {}, { signal: controller.signal, soundEffects: sound })
  await advance(200)
  controller.abort()
  const atCancel = ticks
  await advance(4000)
  assert.equal(await result, null)
  assert.equal(ticks, atCancel)
  assert.ok(voices.every(voice => voice.disconnected))
})

for (const mode of ['unsupported', 'blocked', 'suspended']) {
  test(`${mode} audio falls back to a complete silent shuffle`, async t => {
    const { sound, advance } = setup(t, mode)
    let ticks = 0
    const result = runDecelerationLoop(['A', 'B'], () => ticks++, () => {}, { soundEffects: sound })
    await advance(5000)
    assert.ok(['A', 'B'].includes(await result))
    assert.equal(ticks, 19)
  })
}

test('disposing during the ding cancels the sequence and releases its voice', async t => {
  const { sound, voices, advance } = setup(t)
  const controller = new AbortController()
  const result = runDecelerationLoop(['A'], () => {}, () => {}, { signal: controller.signal, soundEffects: sound })
  while (!voices.some(voice => voice.type === 'sine')) await advance(10)
  controller.abort()
  sound.dispose()
  await advance(20)
  assert.equal(await result, null)
  assert.ok(voices.every(voice => voice.disconnected))
})
