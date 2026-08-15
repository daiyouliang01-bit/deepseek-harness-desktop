/** Task 3.4 — custom instructions (system prompt) management. */

export interface CustomInstructions {
  /** User-authored system prompt, included in every new conversation. */
  systemPrompt: string
  /** Whether custom instructions are enabled. */
  enabled: boolean
}

export const DEFAULT_INSTRUCTIONS: CustomInstructions = { systemPrompt: '', enabled: false }

const KEY = 'custom-instructions'

export function loadInstructions(getSetting: (key: string) => string | null): CustomInstructions {
  const raw = getSetting(KEY)
  if (!raw) return DEFAULT_INSTRUCTIONS
  try {
    return { ...DEFAULT_INSTRUCTIONS, ...(JSON.parse(raw) as Partial<CustomInstructions>) }
  } catch {
    return DEFAULT_INSTRUCTIONS
  }
}

export function saveInstructions(
  setSetting: (key: string, value: string) => void,
  instructions: CustomInstructions
): void {
  setSetting(KEY, JSON.stringify(instructions))
}

/** Compose the effective system prompt for a conversation. */
export function effectiveSystemPrompt(
  instructions: CustomInstructions,
  conversationTitle?: string
): string {
  if (!instructions.enabled || !instructions.systemPrompt.trim()) return ''
  const title = conversationTitle?.trim()
  return title ? `${instructions.systemPrompt}\n\n(Conversation: ${title})` : instructions.systemPrompt
}
