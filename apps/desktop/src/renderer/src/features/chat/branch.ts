/** Task 3.4 — conversation branching: regenerate / edit / branch switching. */

import type { ChatMessage } from '../chat/event-reducer'

export interface BranchPoint {
  /** message id where the branch diverges */
  anchorId: string
  /** alternate continuations (each a full message list starting after anchor) */
  branches: ChatMessage[][]
  /** currently selected branch index */
  selected: number
}

export type BranchState = Record<string, BranchPoint>

/**
 * Regenerate: keep messages up to (and including) the anchor, clear everything
 * after it, and open a fresh branch slot for the new continuation.
 * Returns the new state and the anchor id to start streaming into.
 */
export function regenerate(
  state: BranchState,
  messages: ChatMessage[],
  anchorId: string
): { branchState: BranchState; messages: ChatMessage[]; anchorId: string } {
  const idx = messages.findIndex((m) => m.id === anchorId)
  if (idx < 0) return { branchState: state, messages, anchorId }
  const kept = messages.slice(0, idx + 1)
  const existing = state[anchorId]
  const point: BranchPoint = existing
    ? { ...existing, selected: existing.branches.length }
    : { anchorId, branches: [], selected: 0 }
  // start a new empty branch
  point.branches = [...point.branches, []]
  point.selected = point.branches.length - 1
  return {
    branchState: { ...state, [anchorId]: point },
    messages: kept,
    anchorId
  }
}

/**
 * Append a message to the currently selected branch of an anchor.
 * When no branch state exists yet (first continuation), creates branch 0.
 */
export function appendToBranch(
  state: BranchState,
  anchorId: string,
  message: ChatMessage
): BranchState {
  const point = state[anchorId]
  if (!point) {
    return { ...state, [anchorId]: { anchorId, branches: [[message]], selected: 0 } }
  }
  const branches = point.branches.map((b, i) => (i === point.selected ? [...b, message] : b))
  return { ...state, [anchorId]: { ...point, branches } }
}

/** Switch the active branch for an anchor. */
export function selectBranch(state: BranchState, anchorId: string, index: number): BranchState {
  const point = state[anchorId]
  if (!point || index < 0 || index >= point.branches.length) return state
  return { ...state, [anchorId]: { ...point, selected: index } }
}

/**
 * Materialize the current view of a conversation given the branch state:
 * base messages with the selected branch continuation appended after each
 * anchor. Anchors may nest (a branched message can itself be an anchor).
 */
export function materialize(messages: ChatMessage[], state: BranchState): ChatMessage[] {
  const out: ChatMessage[] = []
  const queue = [...messages]
  while (queue.length > 0) {
    const m = queue.shift() as ChatMessage
    out.push(m)
    const point = state[m.id]
    if (point && point.branches.length > 0) {
      const branch = point.branches[point.selected] ?? []
      queue.unshift(...branch)
    }
  }
  return out
}

/** Edit a message: replace its content in place (branch structure preserved). */
export function editMessage(messages: ChatMessage[], id: string, content: string): ChatMessage[] {
  return messages.map((m) => (m.id === id ? { ...m, content } : m))
}
