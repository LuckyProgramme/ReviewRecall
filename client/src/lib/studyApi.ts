import { request, ResponseError } from './api'
import type { Attempt, Reviewer, ReviewerStatus, RunSummary, StudyRun, Topic } from '../types/study'

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResponseError('The service returned unexpected data.')
  return value as Record<string, unknown>
}
const array = <T>(value: unknown): T[] => {
  if (!Array.isArray(value)) throw new ResponseError('The service returned an unexpected list.')
  return value as T[]
}
const id = (value: string) => encodeURIComponent(value)
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const authorized = (guestId: string, options: RequestInit = {}): RequestInit => ({ ...options, headers: { ...options.headers, 'X-Guest-Id': guestId } })
const studyRequest = (guestId: string, path: string, options?: RequestInit) => request(path, authorized(guestId, options))

export async function listReviewers(guestId: string): Promise<Reviewer[]> {
  const response = await studyRequest(guestId, `/api/sessions/${id(guestId)}/reviewers`)
  return array<Reviewer>(response.reviewers).map((value) => {
    const row = object(value)
    if (typeof row.reviewer_id !== 'string' || typeof row.file_name !== 'string' || typeof row.status !== 'string') throw new ResponseError('Invalid reviewer.')
    return value
  })
}
export async function completeReviewer(guestId: string, reviewerId: string): Promise<Reviewer> {
  return studyRequest(guestId, '/api/uploads/complete', json({ reviewer_id: reviewerId })) as Promise<Reviewer>
}
export async function reviewerStatus(guestId: string, reviewerId: string): Promise<{ status: ReviewerStatus; error_code?: string; retryable?: boolean }> {
  const row = await studyRequest(guestId, `/api/reviewers/${id(reviewerId)}/status`)
  if (typeof row.status !== 'string') throw new ResponseError('Invalid reviewer status.')
  return row as { status: ReviewerStatus; error_code?: string; retryable?: boolean }
}
export async function listTopics(guestId: string, reviewerId: string): Promise<Topic[]> {
  const row = await studyRequest(guestId, `/api/reviewers/${id(reviewerId)}/topics`)
  return array<Topic>(row.topics).map((value) => {
    const topic = object(value)
    if (typeof topic.topic_id !== 'string' || typeof topic.label !== 'string' || typeof topic.concept_count !== 'number') throw new ResponseError('Invalid topic.')
    return value
  })
}
export async function startRun(guestId: string, topicId: string): Promise<StudyRun> {
  const row = await studyRequest(guestId, `/api/topics/${id(topicId)}/runs`, json({}))
  return parseRun(row.run)
}
export async function getRun(guestId: string, runId: string): Promise<StudyRun> {
  const row = await studyRequest(guestId, `/api/runs/${id(runId)}`)
  return parseRun(row.run)
}
export async function advanceRun(guestId: string, runId: string, itemId: string): Promise<StudyRun> {
  const row = await studyRequest(guestId, `/api/runs/${id(runId)}/advance`, json({ item_id: itemId }))
  return parseRun(row.run)
}
export async function skipItem(guestId: string, runId: string, itemId: string): Promise<StudyRun> {
  const row = await studyRequest(guestId, `/api/runs/${id(runId)}/items/${id(itemId)}/skip`, json({}))
  return parseRun(row.run)
}
function parseRun(value: unknown): StudyRun {
  const row = object(value)
  if (typeof row.run_id !== 'string' || typeof row.topic_id !== 'string' || typeof row.current_index !== 'number' || !Array.isArray(row.items) || (row.status !== 'active' && row.status !== 'completed')) throw new ResponseError('Invalid study run.')
  return value as StudyRun
}
export async function signAttempt(guestId: string, runId: string, itemId: string, fileType: string, fileSize: number, durationSeconds: number, attemptId?: string) {
  const row = await studyRequest(guestId, `/api/runs/${id(runId)}/items/${id(itemId)}/attempts/sign`, json({ file_type: fileType, file_size: fileSize, duration_seconds: durationSeconds, ...(attemptId ? { attempt_id: attemptId } : {}) }))
  if (typeof row.attempt_id !== 'string' || typeof row.path !== 'string' || typeof row.token !== 'string') throw new ResponseError('Invalid audio upload permission.')
  return row as { attempt_id: string; path: string; token: string }
}
export async function completeAttempt(guestId: string, attemptId: string): Promise<Attempt> {
  const row = await studyRequest(guestId, `/api/attempts/${id(attemptId)}/complete`, json({}))
  return object(row.attempt) as Attempt
}
export async function cancelAttempt(guestId: string, attemptId: string): Promise<Attempt> {
  const row = await studyRequest(guestId, `/api/attempts/${id(attemptId)}/cancel`, json({}))
  return object(row.attempt) as Attempt
}
export async function getAttempt(guestId: string, attemptId: string): Promise<Attempt> {
  const row = await studyRequest(guestId, `/api/attempts/${id(attemptId)}`)
  return object(row.attempt) as Attempt
}
export async function getSummary(guestId: string, runId: string): Promise<RunSummary> {
  const row = await studyRequest(guestId, `/api/runs/${id(runId)}/summary`)
  return object(row.summary) as RunSummary
}
export async function downloadReference(guestId: string, reviewerId: string, topicId: string): Promise<string> {
  const base = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '')
  let response: Response
  try { response = await fetch(`${base}/api/reviewers/${id(reviewerId)}/reference?topic_id=${id(topicId)}`, { headers: { 'X-Guest-Id': guestId } }) }
  catch { throw new Error('Could not reach the reference service.') }
  if (!response.ok) throw new Error('Could not download the reference.')
  return response.text()
}
