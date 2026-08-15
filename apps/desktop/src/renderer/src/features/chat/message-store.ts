/** Task 3.2 — message store (in-memory; persistence lands in Task 3.3). */

import type { AgentEvent } from '@dshd/protocol'
import { initialState, reduceEvent, type ChatState } from './event-reducer'

type Listener = (state: ChatState) => void

export class MessageStore {
  private state: ChatState = initialState
  private listeners = new Set<Listener>()

  getState(): ChatState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Feed a protocol event through the reducer and notify listeners. */
  dispatch(event: AgentEvent): void {
    this.state = reduceEvent(this.state, event)
    for (const l of this.listeners) l(this.state)
  }

  /** Replay a batch (reconnect recovery / fixture). */
  replay(events: AgentEvent[]): void {
    for (const e of events) this.dispatch(e)
  }
}

/** App-wide singleton for the current session. */
export const messageStore = new MessageStore()
