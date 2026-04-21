import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type {
  InterruptionReason,
  InterruptedMessage,
  MessageReceiveState,
  WaitContext,
} from "./types"
import { MessageReceiveState as State, AbortError } from "./types"
import { logger, consoleAndLogFile } from "../../src/logger"

const IGNORED_EVENTS = new Set([
  "server.heartbeat",
  "sync",
  "message.part.delta",
  "session.diff",
  "session.updated",
])

export class OpenCodeSessionAdapter {
  id: string
  private client: OpencodeClient
  private directory: string
  private messageHistory: Array<{ role: string; content: string }> = []
  private eventSource: AbortController | null = null
  private interruptionCallback: ((msg: InterruptedMessage) => void) | null = null
  private messageCallback: ((msg: { role: string; content: string }) => void) | null = null

  private currentNodeName: string = ""
  private currentRoleName: string = ""
  private lastReceivedMessageContent: string = ""

  private receiveState: MessageReceiveState = State.IDLE
  private pendingMessageContent: string = ""
  private lastUserMessageId: string | null = null
  private lastAssistantMessageId: string | null = null
  private messageRoles = new Map<string, string>()
  private messageTextById = new Map<string, string>()

  private pendingInterruption: InterruptedMessage | null = null
  private interruptionResolve: ((value: string) => void) | null = null
  private waitContext: WaitContext | null = null
  private waitForUserMessagePromise: Promise<string> | null = null

  constructor(client: OpencodeClient, sessionId: string, directory: string) {
    this.client = client
    this.id = sessionId
    this.directory = directory
  }

  onInterruption(callback: (msg: InterruptedMessage) => void): void {
    this.interruptionCallback = callback
  }

  onMessage(callback: (msg: { role: string; content: string }) => void): void {
    this.messageCallback = callback
  }

  setCurrentContext(nodeName: string, roleName: string): void {
    this.currentNodeName = nodeName
    this.currentRoleName = roleName
    consoleAndLogFile.info(`[状态] 设置上下文 -> node=${nodeName}, role=${roleName}, state=${this.receiveState}`)
  }

  getReceiveState(): MessageReceiveState {
    return this.receiveState
  }

  async startEventListener(): Promise<void> {
    this.eventSource = new AbortController()
    logger.info(`[事件监听] 已订阅事件, sessionId: ${this.id}`)

    ;(async () => {
      try {
        const events = await this.client.global.event()
        logger.info(`[事件监听] 订阅成功`)
        let eventCount = 0
        for await (const event of events.stream) {
          eventCount++
          const payload = (event as any).payload
          const type = payload?.type
          const sessionId = payload?.properties?.sessionID ?? payload?.properties?.info?.sessionID

          if (IGNORED_EVENTS.has(type)) {
            continue
          }

          const isMySession = sessionId === this.id

          if (type === "session.error") {
            logger.info(`[事件!] #${eventCount} session.error: ${JSON.stringify(payload.error)}`)
          } else if (type === "session.status" || type === "session.idle") {
            logger.info(`[事件] #${eventCount} ${type}: ${payload.properties.status?.type ?? payload.properties.sessionID}`)
          } else if (type === "message.updated" || type === "message.created") {
            if (isMySession) {
              const role = payload.properties?.info?.role
              logger.info(`[事件!] #${eventCount} ${type}: role=${role ?? "unknown"}`)
            }
          }
          await this.handleEvent(event)
        }
      } catch (e) {
        logger.error("[事件监听] 错误:", e)
      }
    })()
  }

  private async handleEvent(event: any): Promise<void> {
    const payload = event.payload
    if (!payload) return

    const type = payload.type
    const props = payload.properties ?? payload
    const sessionId = props?.sessionID ?? props?.info?.sessionID
    if (sessionId && sessionId !== this.id) return

    switch (type) {
      case "session.status": {
        break
      }

      case "message.updated": {
        this.handleMessageUpdated(props)
        break
      }

      case "message.created": {
        this.handleMessageCreated(props)
        break
      }

      case "message.part.updated": {
        await this.handleMessagePartUpdated(props)
        break
      }

      case "session.error": {
        this.handleSessionError(props)
        break
      }

      case "session.idle": {
        if (props?.sessionID === this.id && this.receiveState === State.EXPECTING_NEXT_MESSAGE) {
          logger.info(`[事件] 会话空闲，等待用户消息...`)
        }
        break
      }

      case "tui.command.execute": {
        this.handleCommandExecute(props)
        break
      }
    }
  }

  private handleMessageUpdated(props: any): void {
    const info = props?.info
    if (!info) return
    if (info.sessionID !== this.id) return

    if (info.role === "user") {
      this.messageRoles.set(info.id, info.role)
      logger.info(
        `[事件-DEBUG] 用户消息, state=${this.receiveState}, role=${info.role}, waitPhase=${this.waitContext?.phase ?? "none"}, baselineUser=${this.waitContext?.baselineUserMessageId ?? "none"}, currentId=${info.id}`,
      )
      logger.info(`[事件-DEBUG] 用户消息等待 part.updated 提供文本`)
    } else if (info.role === "assistant") {
      this.messageRoles.set(info.id, info.role)
      logger.info(
        `[事件-DEBUG] 助手消息, state=${this.receiveState}, role=${info.role}, waitPhase=${this.waitContext?.phase ?? "none"}, baselineAssistant=${this.waitContext?.baselineAssistantMessageId ?? "none"}, currentId=${info.id}, pendingReason=${this.pendingInterruption?.reason || "none"}`,
      )
      logger.info(`[事件-DEBUG] 助手消息等待 part.updated 提供文本`)
    }
  }

  private handleMessageCreated(props: any): void {
    const info = props?.info
    if (!info) return
    if (info.sessionID !== this.id) return

    if (info.role === "user") {
      this.messageRoles.set(info.id, info.role)
      logger.info(
        `[事件-DEBUG] 用户消息(created), state=${this.receiveState}, role=${info.role}, waitPhase=${this.waitContext?.phase ?? "none"}, baselineUser=${this.waitContext?.baselineUserMessageId ?? "none"}, currentId=${info.id}`,
      )
      logger.info(`[事件-DEBUG] 用户消息(created)等待 part.updated 提供文本`)
    }
  }

  private async handleMessagePartUpdated(props: any): Promise<void> {
    const part = props?.part
    if (!part) return
    if (part.sessionID !== this.id) return
    if (part.type !== "text") return
    if (part.ignored) return

    const role = this.messageRoles.get(part.messageID)
    if (!role) {
      logger.info(`[事件-DEBUG] part.updated 未知角色, messageId=${part.messageID}, partId=${part.id}`)
      return
    }

    this.messageTextById.set(part.messageID, part.text)
    logger.info(
      `[事件-DEBUG] part.updated role=${role}, state=${this.receiveState}, waitPhase=${this.waitContext?.phase ?? "none"}, messageId=${part.messageID}, partId=${part.id}, textEnd=${part.time?.end ?? "none"}, text="${part.text.substring(0, 30)}..."`,
    )

    if (role === "user") {
      this.lastUserMessageId = part.messageID
      if (this.receiveState === State.EXPECTING_NEXT_MESSAGE && this.isResumedUserMessage(part.messageID)) {
        this.pendingInterruption = {
          nodeName: this.currentNodeName,
          roleName: this.currentRoleName,
          beforeMessage: this.pendingMessageContent,
          receivedMessage: part.text,
          timestamp: new Date(),
          reason: "new_message",
        }

        if (this.waitContext) {
          this.waitContext.phase = "waiting_assistant"
          this.waitContext.resumedUserMessageId = part.messageID
        }

        logger.info(`[事件] 新用户消息(part): "${part.text.substring(0, 30)}..."`)
        if (this.interruptionCallback) {
          this.interruptionCallback(this.pendingInterruption)
        }
      }
      return
    }

    this.lastAssistantMessageId = part.messageID
    if (!part.time?.end) return
    if (this.receiveState !== State.EXPECTING_NEXT_MESSAGE) return
    if (this.waitContext?.phase !== "waiting_assistant") return
    if (!this.isResumedAssistantMessage(part.messageID)) return

    this.pendingInterruption = {
      nodeName: this.currentNodeName,
      roleName: this.currentRoleName,
      beforeMessage: this.pendingMessageContent,
      receivedMessage: part.text,
      timestamp: new Date(),
      reason: "rollback",
    }

    this.waitContext = null
    logger.info(`[事件] 助手新消息(part): "${part.text.substring(0, 30)}..."`)
    if (this.interruptionCallback) {
      this.interruptionCallback(this.pendingInterruption)
    }
  }

  private handleSessionError(props: any): void {
    const error = props?.error
    if (!error) return

    const errorName = error.name
    if (errorName === "MessageAbortedError") {
      logger.info(`[事件] ESC暂停 (MessageAbortedError)`)
      this.triggerInterruption({
        reason: "aborted",
        receivedMessage: error.data?.message ?? "用户按下了暂停键",
      })
    }
  }

  private handleCommandExecute(props: any): void {
    const command = props?.command
    if (command === "session.interrupt" && this.receiveState !== State.IDLE) {
      logger.info(`[事件] session.interrupt 命令`)
      this.receiveState = State.EXPECTING_NEXT_MESSAGE
      if (this.interruptionCallback) {
        this.interruptionCallback({
          nodeName: this.currentNodeName,
          roleName: this.currentRoleName,
          beforeMessage: this.pendingMessageContent,
          receivedMessage: "用户按下了暂停键",
          timestamp: new Date(),
          reason: "pause",
        })
      }
    }
  }

  private isResumedUserMessage(messageId: string): boolean {
    if (!this.waitContext) return false
    if (this.waitContext.phase !== "waiting_user") return false
    return messageId !== this.waitContext.baselineUserMessageId
  }

  private isResumedAssistantMessage(messageId: string): boolean {
    if (!this.waitContext) return false
    if (this.waitContext.phase !== "waiting_assistant") return false
    return messageId !== this.waitContext.baselineAssistantMessageId
  }

  private triggerInterruption(params: { reason: InterruptionReason; receivedMessage: string }): void {
    const { reason, receivedMessage } = params

    if (reason === "aborted") {
      if (this.receiveState === State.EXPECTING_NEXT_MESSAGE) {
        consoleAndLogFile.info(`[中断] 忽略等待阶段的 aborted 残留事件`)
        return
      }
      this.receiveState = State.RECEIVED_INTERRUPTION
      consoleAndLogFile.info(`[中断] reason=aborted (仅中断当前操作)`)
      return
    }

    this.receiveState = State.RECEIVED_INTERRUPTION
    consoleAndLogFile.info(`[中断] reason=${reason}`)

    this.pendingInterruption = {
      nodeName: this.currentNodeName,
      roleName: this.currentRoleName,
      beforeMessage: this.pendingMessageContent,
      receivedMessage,
      timestamp: new Date(),
      reason,
    }

    if (this.interruptionCallback) {
      this.interruptionCallback({
        nodeName: this.currentNodeName,
        roleName: this.currentRoleName,
        beforeMessage: this.pendingMessageContent,
        receivedMessage,
        timestamp: new Date(),
        reason,
      })
    }

    if (this.interruptionResolve) {
      this.interruptionResolve(receivedMessage)
      this.interruptionResolve = null
    }
  }

  async stopEventListener(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.abort()
      this.eventSource = null
    }
  }

  async sendMessage(message: { role: string; content: string }, agent?: string): Promise<string> {
    consoleAndLogFile.info(`[发送消息] role=${message.role}, content="${message.content.substring(0, 60)}...", state=${this.receiveState}, directory=${this.directory}, agent=${agent ?? "default"}`)
    consoleAndLogFile.info(`[DEBUG sendMessage] 开始, state=${this.receiveState}`)
    this.messageHistory.push(message)
    this.pendingMessageContent = message.content

    if (message.role === "user" && this.receiveState === State.IDLE) {
      this.receiveState = State.WAITING_PROMPT_RESPONSE
      consoleAndLogFile.info(`[状态变更] WAITING_PROMPT_RESPONSE (等待prompt响应)`)
    }

    if (this.receiveState === State.EXPECTING_NEXT_MESSAGE) {
      consoleAndLogFile.info(`[发送] state=EXPECTING_NEXT_MESSAGE，跳过发送，返回""`)
      return ""
    }

    if (this.receiveState === State.RECEIVED_INTERRUPTION) {
      consoleAndLogFile.info(`[发送] state=RECEIVED_INTERRUPTION，将抛出AbortError`)
    }

    let promptPromise: Promise<any>
    try {
      const promptParams: any = {
        sessionID: this.id,
        directory: this.directory,
        parts: [{ type: "text", text: message.content }],
        system: message.role === "system" ? message.content : undefined,
      }
      if (agent) {
        promptParams.agent = agent
      }
      const promptResult = this.client.session.prompt(promptParams)
      promptPromise = Promise.resolve(promptResult)
    } catch (err) {
      this.receiveState = State.IDLE
      this.pendingMessageContent = ""
      throw err
    }

    let aborted = false
    let abortReason: string | null = null

    const checkInterruption = () => {
      if (this.receiveState === State.RECEIVED_INTERRUPTION) {
        logger.info(`[发送] 检测到中断, reason=${this.pendingInterruption?.reason}`)
        aborted = true
        abortReason = this.pendingInterruption?.receivedMessage ?? "用户按下了暂停键"
      }
    }

    try {
      const response = await Promise.race([
        promptPromise,
        new Promise<never>((_, reject) => {
          const interval = setInterval(() => {
            checkInterruption()
            if (aborted) {
              clearInterval(interval)
              reject(new AbortError())
            }
          }, 100)
          const cleanup = () => clearInterval(interval)
          promptPromise.then(cleanup, cleanup)
        }),
      ])

      checkInterruption()

      let responseText = ""
      if (response.data?.parts) {
        for (const p of response.data.parts) {
          if (p.type === "text") {
            responseText += (p as { text: string }).text + "\n"
          }
        }
        if (responseText) {
          const trimmed = responseText.trim()
          this.messageHistory.push({ role: "assistant", content: trimmed })
          this.lastReceivedMessageContent = trimmed
          this.receiveState = State.IDLE
          return trimmed
        }
      }
      this.receiveState = State.IDLE
      return responseText
    } catch (error) {
      const err = error as Error
      if (err instanceof AbortError || err.name === "AbortError") {
        throw error
      }

      this.receiveState = State.IDLE

      const isAbortRelated =
        err?.name === "AbortError" ||
        err?.name === "AbortController" ||
        err?.message?.includes("abort") ||
        err?.message?.includes("cancelled") ||
        err?.message?.includes("取消")

      if (isAbortRelated) {
        this.pendingInterruption = {
          nodeName: this.currentNodeName,
          roleName: this.currentRoleName,
          beforeMessage: this.pendingMessageContent,
          receivedMessage: "用户按下了暂停键",
          timestamp: new Date(),
          reason: "aborted",
        }
        throw new AbortError()
      }

      logger.error(`[发送消息] 其他错误: ${err.message}`)
      throw error
    } finally {
      this.pendingMessageContent = ""
    }
  }

  async waitForInterruption(timeoutMs: number = 0): Promise<string> {
    consoleAndLogFile.info(`[等待中断] timeout=${timeoutMs}ms, state=${this.receiveState}`)

    if (this.receiveState === State.RECEIVED_INTERRUPTION) {
      const msg = this.pendingInterruption?.receivedMessage ?? ""
      this.pendingInterruption = null
      this.receiveState = State.IDLE
      return msg
    }

    return new Promise((resolve) => {
      this.interruptionResolve = resolve
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (this.interruptionResolve === resolve) {
            this.interruptionResolve = null
            this.receiveState = State.IDLE
            resolve("")
          }
        }, timeoutMs)
      }
    })
  }

  clearInterruption(): void {
    this.pendingInterruption = null
    this.receiveState = State.IDLE
    this.interruptionResolve = null
    this.waitContext = null
  }

  async waitForUserMessage(timeoutMs: number = 300000): Promise<string> {
    if (this.waitForUserMessagePromise) {
      consoleAndLogFile.info(`[等待用户消息] 已在等待中，返回现有Promise`)
      return this.waitForUserMessagePromise
    }

    consoleAndLogFile.info(`[等待用户消息] timeout=${timeoutMs / 1000}s, 设置状态为 EXPECTING_NEXT_MESSAGE`)
    this.receiveState = State.EXPECTING_NEXT_MESSAGE
    this.pendingInterruption = null
    this.waitContext = {
      phase: "waiting_user",
      startedAt: Date.now(),
      baselineUserMessageId: this.lastUserMessageId,
      baselineAssistantMessageId: this.lastAssistantMessageId,
      resumedUserMessageId: null,
    }
    consoleAndLogFile.info(`[等待用户消息] 状态已设置，开始等待...`)

    this.waitForUserMessagePromise = new Promise<string>((resolve, reject) => {
      let userMessageReceived = false
      let resolved = false

      const cleanup = () => {
        this.waitForUserMessagePromise = null
        this.waitContext = null
      }

      const checkInterval = setInterval(() => {
        if (resolved) return

        if (!userMessageReceived && this.pendingInterruption?.reason === "new_message") {
          userMessageReceived = true
          consoleAndLogFile.info(`[等待用户消息] 检测到用户消息，继续等待模型响应...`)
          this.pendingInterruption = null
          return
        }

        if (userMessageReceived && this.pendingInterruption?.reason === "rollback") {
          const response = this.pendingInterruption.receivedMessage
          consoleAndLogFile.info(`[等待用户消息] 检测到模型响应: "${response.substring(0, 30)}..."`)
          resolved = true
          clearInterval(checkInterval)
          cleanup()
          this.receiveState = State.IDLE
          resolve(response)
        }
      }, 100)

      setTimeout(() => {
        if (resolved) return
        clearInterval(checkInterval)
        cleanup()
        this.receiveState = State.IDLE
        reject(new Error("等待用户消息超时"))
      }, timeoutMs)
    })

    return this.waitForUserMessagePromise
  }

  async getMessages(): Promise<Array<{ role: string; content: string }>> {
    return [...this.messageHistory]
  }
}