export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const deck = [...items]
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export function drawConcept<T extends { concept_id: string }>(concepts: readonly T[], remaining: readonly T[], previousId?: string, random = Math.random) {
  const deck = remaining.length ? [...remaining] : shuffled(concepts, random)
  // Avoid an immediate repeat across cycles without losing any concept.
  if (!remaining.length && deck.length > 1 && deck[0].concept_id === previousId) {
    ;[deck[0], deck[1]] = [deck[1], deck[0]]
  }
  return { active: deck[0] as T | undefined, remaining: deck.slice(1) }
}
