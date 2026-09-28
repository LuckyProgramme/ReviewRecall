import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/conceptDeck.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { shuffled, drawConcept } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const concepts = ['A', 'B', 'C', 'D'].map(concept_id => ({ concept_id }))

test('every exhaustion cycle contains each concept exactly once and never mutates the source', () => {
  let remaining = []
  let previous
  for (let cycle = 0; cycle < 20; cycle++) {
    const seen = []
    for (let i = 0; i < concepts.length; i++) {
      const draw = drawConcept(concepts, remaining, previous)
      if (!i && previous) assert.notEqual(draw.active.concept_id, previous)
      seen.push(draw.active.concept_id)
      previous = draw.active.concept_id
      remaining = draw.remaining
    }
    assert.deepEqual(seen.sort(), ['A', 'B', 'C', 'D'])
    assert.equal(remaining.length, 0)
  }
  assert.deepEqual(concepts.map(c => c.concept_id), ['A', 'B', 'C', 'D'])
})

test('empty and single-concept topics are safe', () => {
  assert.equal(drawConcept([], []).active, undefined)
  assert.deepEqual(drawConcept([concepts[0]], [], 'A'), { active: concepts[0], remaining: [] })
})

test('Fisher-Yates uses fresh arrays and supports deterministic verification', () => {
  const copy = shuffled(concepts, () => 0)
  assert.notEqual(copy, concepts)
  assert.deepEqual(copy.map(c => c.concept_id), ['B', 'C', 'D', 'A'])
})
