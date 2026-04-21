export type InterruptionReason = "pause" | "rollback" | "new_message" | "aborted"

export interface InterruptedMessage {
  nodeName: string
  roleName: string
  beforeMessage: string
  receivedMessage: string
  timestamp: Date
  reason: InterruptionReason
}

export enum MessageReceiveState {
  IDLE = "IDLE",
  WAITING_PROMPT_RESPONSE = "WAITING_PROMPT_RESPONSE",
  EXPECTING_NEXT_MESSAGE = "EXPECTING_NEXT_MESSAGE",
  RECEIVED_INTERRUPTION = "RECEIVED_INTERRUPTION",
}

export type WaitPhase = "waiting_user" | "waiting_assistant"

export interface WaitContext {
  phase: WaitPhase
  startedAt: number
  baselineUserMessageId: string | null
  baselineAssistantMessageId: string | null
  resumedUserMessageId: string | null
}

export class AbortError extends Error {
  constructor() {
    super("Session aborted by user (ESC)")
    this.name = "AbortError"
  }
}