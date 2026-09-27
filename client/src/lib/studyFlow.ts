import type { StudyRun } from '../types/study'

export type RunPhase = 'concept' | 'feedback' | 'summary'

export function isCurrentGeneration(current: number, responseGeneration: number) {
  return current === responseGeneration
}

export function currentRunPhase(run: StudyRun): RunPhase {
  if (run.status === 'completed' || run.current_item_id === null) return 'summary'
  const current = run.items.find((item) => item.item_id === run.current_item_id)
  return current?.latest_result ? 'feedback' : 'concept'
}
