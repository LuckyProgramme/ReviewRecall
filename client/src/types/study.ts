export type Session = { id: string; expiresAt: number }

export type ReviewerStatus = 'awaiting_upload' | 'queued' | 'extracting' | 'generating' | 'ready' | 'failed'
export type Reviewer = { reviewer_id: string; file_name: string; status: ReviewerStatus; error_code?: string; retryable?: boolean }
export type Topic = { topic_id: string; label: string; summary: string; concept_count: number }
export type Reference = {
  definition: string
  essential_ideas: string[]
  essential_idea_details?: Array<{ idea_id: string; text: string }>
  analogies: string[]
  examples: string[]
  source_locations: Array<{ page: number; heading?: string }>
  source_passages?: Array<{ block_id: string; page: number; heading?: string; text: string; claim_kinds: string[] }>
}
export type Verdict = 'Pass' | 'Partial' | 'Fail'
export type Concept = { concept_id: string; name: string; reference: Reference }
export type EvaluationDetails = {
  matched_idea_ids: string[]
  missing_idea_ids: string[]
  contradictions: Array<{ idea_id: string; student_claim: string; explanation: string }>
}
export type LatestResult = {
  verdict: Verdict
  reason: 'evaluated' | 'skipped' | 'silent'
  feedback: string
  completed_at: string
  transcript?: string
  details?: EvaluationDetails
}
export type RunItem = {
  item_id: string
  concept_id: string
  concept_name: string
  reference: Reference
  latest_result: LatestResult | null
  pending_attempt_id?: string
  pending_attempt_status?: 'awaiting_upload' | 'queued' | 'transcribing' | 'evaluating'
}
export type StudyRun = {
  run_id: string
  topic_id: string
  status: 'active' | 'completed'
  current_item_id: string | null
  current_index: number
  items: RunItem[]
}
export type Attempt = {
  attempt_id: string
  status: 'awaiting_upload' | 'queued' | 'transcribing' | 'evaluating' | 'completed' | 'unclear' | 'failed' | 'cancelled'
  transcript?: string
  verdict?: Verdict
  feedback?: string
  details?: EvaluationDetails
  error_code?: string
  retryable?: boolean
}
export type RunSummary = {
  run_id: string
  counts: Record<Verdict, number>
  concepts: Array<{ item_id: string; concept_id: string; concept_name: string; verdict: Verdict; reason: string; feedback: string }>
}
