/**
 * RalphLoopCore × OpenCode 集成示例 - 事件驱动版本
 *
 * 本示例展示如何将 RalphLoopCore 的节点图执行引擎与 OpenCode 会话连接
 * 支持三种用户操作检测：
 * 1. 用户按下 ESC 暂停 - RLC 节点暂停，以下一条用户消息作为接收
 * 2. 用户触发回滚 - 以回滚后新消息的返回作为 RLC 接收
 * 3. 用户直接发新消息引导 - 以新消息的返回作为接收
 *
 * 运行前提：OpenCode 服务器必须正在运行
 * 启动服务器：opencode web
 *
 * ============================================================================
 * Opencode SDK 版本坑点说明 (v1 vs v2)
 * ============================================================================
 *
 * 1. 导入差异:
 *    - v1: import { createOpencodeClient } from "@opencode-ai/sdk"
 *    - v2: import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
 *
 * 2. 事件订阅端点差异:
 *    - v1: client.event.subscribe() -> /event (按目录过滤)
 *    - v2: client.global.event() -> /global/event (全局事件流)
 *    重要: 必须使用 v2 的 global.event 才能接收到 session.error 等事件!
 *
 * 3. session.prompt 参数结构差异:
 *    - v1: client.session.prompt({ path: { id: sessionId }, body: { parts: [...] } })
 *    - v2: client.session.prompt({ sessionID: sessionId, parts: [...] })
 *    重要: v2 使用平铺的参数结构，不是嵌套在 path/body 中!
 *
 * 4. 事件结构差异:
 *    - v1: event.type, event.properties
 *    - v2: event.payload.type, event.payload.properties
 *    重要: v2 的事件嵌套在 payload 字段中!
 *
 * 5. directory 参数:
 *    - v2 中 directory 是 query 参数: client.session.prompt({ sessionID, directory })
 *    不是 body 参数!
 *
 * ============================================================================
 * 日志分级说明
 * ============================================================================
 * - 控制台输出: 精简的关键信息
 * - 文件输出: 详细日志，保存在 ./log 目录下，按日期命名
 *
 * ============================================================================
 */

import { LoopEngine } from "../../src/index.js"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { ralphLoopStrategy } from "./strategy.js"
import { logger, consoleAndLogFile } from "../../src/logger"
import * as path from "path"
import * as readline from "readline"

type InterruptionReason = "pause" | "rollback" | "new_message" | "aborted"

interface InterruptedMessage {
  nodeName: string
  roleName: string
  beforeMessage: string
  receivedMessage: string
  timestamp: Date
  reason: InterruptionReason
}

enum MessageReceiveState {
  IDLE = "IDLE",
  WAITING_PROMPT_RESPONSE = "WAITING_PROMPT_RESPONSE",
  EXPECTING_NEXT_MESSAGE = "EXPECTING_NEXT_MESSAGE",
  RECEIVED_INTERRUPTION = "RECEIVED_INTERRUPTION",
}

type WaitPhase = "waiting_user" | "waiting_assistant"

interface WaitContext {
  phase: WaitPhase
  startedAt: number
  baselineUserMessageId: string | null
  baselineAssistantMessageId: string | null
  resumedUserMessageId: string | null
}

class AbortError extends Error {
  constructor() {
    super("Session aborted by user (ESC)")
    this.name = "AbortError"
  }
}

class OpenCodeSessionAdapter {
  id: string
  private client: OpencodeClient
  private directory: string
  private messageHistory: Array<{ role: string; content: string }> = []
  private eventSource: AbortController | null = null
  private interruptionCallback: ((msg: InterruptedMessage) => void) | null = null
  private messageCallback: ((msg: { role: string; content: string }) => void) | null = null

  private currentNodeName: string = ""
  private currentRoleName: string = ""
  private messageSequence: number = 0
  private lastReceivedMessageContent: string = ""

  private receiveState: MessageReceiveState = MessageReceiveState.IDLE
  private pendingMessageContent: string = ""
  private lastSentPromptId: string | null = null
  private lastUserMessageId: string | null = null
  private lastAssistantMessageId: string | null = null
  private messageRoles = new Map<string, string>()
  private messageTextById = new Map<string, string>()

  private abortController: AbortController | null = null

  private pendingInterruption: InterruptedMessage | null = null
  private interruptionResolve: ((value: string) => void) | null = null
  private waitContext: WaitContext | null = null

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

  getStateDebug(): string {
    return `state=${this.receiveState}, pendingMsg=${this.pendingMessageContent.substring(0, 30) || "(none)"}, lastUserMsgId=${this.lastUserMessageId || "(none)"}`
  }

  async startEventListener(): Promise<void> {
    this.eventSource = new AbortController()
    logger.info(`[事件监听] 已订阅事件, sessionId: ${this.id}`)

    const IGNORED_EVENTS = new Set([
      "server.heartbeat",
      "sync",
      "message.part.delta",
      "session.diff",
      "session.updated",
    ])

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
        const info = props?.info
        if (!info) break
        if (info.sessionID !== this.id) break

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
        break
      }

      case "message.created": {
        const info = props?.info
        if (!info) break
        if (info.sessionID !== this.id) break

        if (info.role === "user") {
          this.messageRoles.set(info.id, info.role)
          logger.info(
            `[事件-DEBUG] 用户消息(created), state=${this.receiveState}, role=${info.role}, waitPhase=${this.waitContext?.phase ?? "none"}, baselineUser=${this.waitContext?.baselineUserMessageId ?? "none"}, currentId=${info.id}`,
          )
          logger.info(`[事件-DEBUG] 用户消息(created)等待 part.updated 提供文本`)
        }
        break
      }

      case "message.part.updated": {
        const part = props?.part
        if (!part) break
        if (part.sessionID !== this.id) break
        if (part.type !== "text") break
        if (part.ignored) break

        const role = this.messageRoles.get(part.messageID)
        if (!role) {
          logger.info(`[事件-DEBUG] part.updated 未知角色, messageId=${part.messageID}, partId=${part.id}`)
          break
        }

        this.messageTextById.set(part.messageID, part.text)
        logger.info(
          `[事件-DEBUG] part.updated role=${role}, state=${this.receiveState}, waitPhase=${this.waitContext?.phase ?? "none"}, messageId=${part.messageID}, partId=${part.id}, textEnd=${part.time?.end ?? "none"}, text="${part.text.substring(0, 30)}..."`,
        )

        if (role === "user") {
          this.lastUserMessageId = part.messageID
          if (this.receiveState === MessageReceiveState.EXPECTING_NEXT_MESSAGE && this.isResumedUserMessage(part.messageID)) {
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
          break
        }

        this.lastAssistantMessageId = part.messageID
        if (!part.time?.end) break
        if (this.receiveState !== MessageReceiveState.EXPECTING_NEXT_MESSAGE) break
        if (this.waitContext?.phase !== "waiting_assistant") break
        if (!this.isResumedAssistantMessage(part.messageID)) break

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
        break
      }

      case "session.error": {
        const error = props?.error
        if (!error) break

        const errorName = error.name
        if (errorName === "MessageAbortedError") {
          logger.info(`[事件] ESC暂停 (MessageAbortedError)`)
          this.triggerInterruption({
            reason: "aborted",
            receivedMessage: error.data?.message ?? "用户按下了暂停键",
          })
        }
        break
      }

      case "session.idle": {
        if (props?.sessionID === this.id && this.receiveState === MessageReceiveState.EXPECTING_NEXT_MESSAGE) {
          logger.info(`[事件] 会话空闲，等待用户消息...`)
        }
        break
      }

      case "tui.command.execute": {
        const command = props?.command
        if (command === "session.interrupt" && this.receiveState !== MessageReceiveState.IDLE) {
          logger.info(`[事件] session.interrupt 命令`)
          this.receiveState = MessageReceiveState.EXPECTING_NEXT_MESSAGE
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
        break
      }
    }
  }

  private extractTextContent(info: any): string | null {
    if (!info?.parts) return null
    const textParts = (info.parts as any[])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("")
    return textParts || null
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

    // aborted 只用于中断 sendMessage
    if (reason === "aborted") {
      if (this.receiveState === MessageReceiveState.EXPECTING_NEXT_MESSAGE) {
        consoleAndLogFile.info(`[中断] 忽略等待阶段的 aborted 残留事件`)
        return
      }
      this.receiveState = MessageReceiveState.RECEIVED_INTERRUPTION
      consoleAndLogFile.info(`[中断] reason=aborted (仅中断当前操作)`)
      return
    }

    // 如果是 rollback 且已经有 new_message，允许覆盖（这是正常的流程）
    // 如果是重复的 new_message，也允许（用户可能发了多条消息）
    this.receiveState = MessageReceiveState.RECEIVED_INTERRUPTION
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
    this.messageSequence++
    this.pendingMessageContent = message.content

    const previousContent = this.lastReceivedMessageContent

    if (message.role === "user" && this.receiveState === MessageReceiveState.IDLE) {
      this.receiveState = MessageReceiveState.WAITING_PROMPT_RESPONSE
      consoleAndLogFile.info(`[状态变更] WAITING_PROMPT_RESPONSE (等待prompt响应)`)
    }

    if (this.receiveState === MessageReceiveState.EXPECTING_NEXT_MESSAGE) {
      consoleAndLogFile.info(`[发送] state=EXPECTING_NEXT_MESSAGE，跳过发送，返回""`)
      return ""
    }

    if (this.receiveState === MessageReceiveState.RECEIVED_INTERRUPTION) {
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
      this.receiveState = MessageReceiveState.IDLE
      this.pendingMessageContent = ""
      throw err
    }

    let aborted = false
    let abortReason: string | null = null

    const checkInterruption = () => {
      if (this.receiveState === MessageReceiveState.RECEIVED_INTERRUPTION) {
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
          this.receiveState = MessageReceiveState.IDLE
          return trimmed
        }
      }
      this.receiveState = MessageReceiveState.IDLE
      return responseText
    } catch (error) {
      const err = error as Error
      if (err instanceof AbortError || err.name === "AbortError") {
        throw error
      }

      this.receiveState = MessageReceiveState.IDLE

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

    if (this.receiveState === MessageReceiveState.RECEIVED_INTERRUPTION) {
      const msg = this.pendingInterruption?.receivedMessage ?? ""
      this.pendingInterruption = null
      this.receiveState = MessageReceiveState.IDLE
      return msg
    }

    return new Promise((resolve) => {
      this.interruptionResolve = resolve
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (this.interruptionResolve === resolve) {
            this.interruptionResolve = null
            this.receiveState = MessageReceiveState.IDLE
            resolve("")
          }
        }, timeoutMs)
      }
    })
  }

  clearInterruption(): void {
    this.pendingInterruption = null
    this.receiveState = MessageReceiveState.IDLE
    this.interruptionResolve = null
    this.waitContext = null
  }

  private waitForUserMessagePromise: Promise<string> | null = null
  private waitForUserMessageReject: ((error: Error) => void) | null = null

  async waitForUserMessage(timeoutMs: number = 300000): Promise<string> {
    if (this.waitForUserMessagePromise) {
      consoleAndLogFile.info(`[等待用户消息] 已在等待中，返回现有Promise`)
      return this.waitForUserMessagePromise
    }

    consoleAndLogFile.info(`[等待用户消息] timeout=${timeoutMs / 1000}s, 设置状态为 EXPECTING_NEXT_MESSAGE`)
    this.receiveState = MessageReceiveState.EXPECTING_NEXT_MESSAGE
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

        // 检查是否收到用户消息
        if (!userMessageReceived && this.pendingInterruption?.reason === "new_message") {
          userMessageReceived = true
          consoleAndLogFile.info(`[等待用户消息] 检测到用户消息，继续等待模型响应...`)
          this.pendingInterruption = null
          return
        }

        // 检查是否收到助手响应
        if (userMessageReceived && this.pendingInterruption?.reason === "rollback") {
          const response = this.pendingInterruption.receivedMessage
          consoleAndLogFile.info(`[等待用户消息] 检测到模型响应: "${response.substring(0, 30)}..."`)
          resolved = true
          clearInterval(checkInterval)
          cleanup()
          this.receiveState = MessageReceiveState.IDLE
          resolve(response)
        }
      }, 100)

      // 超时处理
      setTimeout(() => {
        if (resolved) return
        clearInterval(checkInterval)
        cleanup()
        this.receiveState = MessageReceiveState.IDLE
        reject(new Error("等待用户消息超时"))
      }, timeoutMs)
    })

    return this.waitForUserMessagePromise
  }

  async getMessages(): Promise<Array<{ role: string; content: string }>> {
    return [...this.messageHistory]
  }

  getLastAssistantMessage(): string | null {
    console.log(`[调试-getLastAssistantMessage] messageHistory长度=${this.messageHistory.length}`)
    for (let i = this.messageHistory.length - 1; i >= 0; i--) {
      const msg = this.messageHistory[i]
      if (msg && msg.role === "assistant") {
        console.log(`[调试-getLastAssistantMessage] 找到assistant消息, 索引=${i}, 内容长度=${msg.content.length}`)
        return msg.content
      }
    }
    console.log(`[调试-getLastAssistantMessage] 未找到assistant消息`)
    return null
  }

  clearLastAssistantMessage(): void {
    for (let i = this.messageHistory.length - 1; i >= 0; i--) {
      const msg = this.messageHistory[i]
      if (msg && msg.role === "assistant") {
        this.messageHistory.splice(i, 1)
        break
      }
    }
  }
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function selectSession(
  baseUrl: string,
  directory: string,
): Promise<{ client: OpencodeClient; sessionId: string; directory: string }> {
  console.log("=".repeat(60))
  console.log("选择会话")
  console.log("=".repeat(60))
  console.log()

  logger.info("=".repeat(60))
  logger.info("选择会话")
  logger.info("=".repeat(60))

  const client = createOpencodeClient({ baseUrl })
  const sessions = await client.session.list()
  const sessionList = sessions.data ?? []
  const MAX_RECENT = 5

  console.log("  0. 打开新会话")
  console.log()

  if (sessionList.length > 0) {
    const recentSessions = sessionList.slice(0, MAX_RECENT)
    console.log(`  最近 ${recentSessions.length} 个会话：`)
    console.log()
    for (let i = 0; i < recentSessions.length; i++) {
      const s = recentSessions[i]
      if (!s) continue
      const title = s.title ?? "(无标题)"
      const updatedAt = s.time?.updated ? new Date(s.time.updated).toLocaleString() : "未知"
      console.log(`  ${i + 1}. ${title}  ( SessionID: ${s.id})`)
      console.log(`     ${updatedAt}`)
      console.log()
    }
  } else {
    console.log("  (暂无已有会话)")
    console.log()
  }

  let selected = 0
  let selectedSession: (typeof sessionList)[0] | null = null

  while (true) {
    const answer = await prompt("请输入选项 (0-新增, 1-" + MAX_RECENT + "选最近会话, s-输入会话ID, 或输入字符按会话名称搜索): ")

    if (answer.trim().toLowerCase() === "s") {
      const sessionIdInput = await prompt("请输入会话ID (ses_xxx): ")
      const inputId = sessionIdInput.trim()
      if (inputId.startsWith("ses_")) {
        logger.info(`[连接] ${inputId}`)
        return { client, sessionId: inputId, directory }
      } else {
        consoleAndLogFile.info("无效的会话ID格式，应以 ses_ 开头")
        continue
      }
    }

    if (answer.trim() === "") {
      selected = 0
      break
    }

    selected = parseInt(answer, 10)

    if (!isNaN(selected) && selected >= 0 && selected <= MAX_RECENT) {
      break
    }

    const searchTerm = answer.trim().toLowerCase()
    if (searchTerm.length > 0) {
      const matched = sessionList.filter((s) => (s.title ?? "").toLowerCase().includes(searchTerm))
      if (matched.length > 0) {
        console.log()
        console.log(`  搜索 "${answer}" 结果 (${matched.length} 个)：`)
        for (let i = 0; i < Math.min(matched.length, 10); i++) {
          const s = matched[i]
          if (!s) continue
          console.log(`  ${i + 1}. ${s.title ?? "(无标题)"}`)
          console.log(`     ID: ${s.id}`)
        }
        console.log()

        const pickAnswer = await prompt("选择会话 (1-" + Math.min(matched.length, 10) + "): ")
        const pickIdx = parseInt(pickAnswer, 10) - 1
        if (!isNaN(pickIdx) && pickIdx >= 0 && pickIdx < matched.length) {
          const selected = matched[pickIdx]
          if (selected) {
            selectedSession = selected
            break
          }
        }
      } else {
        console.log(`  未找到包含 "${answer}" 的会话`)
        console.log()
      }
    } else {
    consoleAndLogFile.warn("无效的选项，请重新输入")
    }
  }

  console.log()

  if (selected === 0) {
    logger.info("[创建] 打开新会话...")
    const defaultDir = directory
    const dirAnswer = await prompt(`项目目录 (直接回车使用: ${defaultDir}): `)
    const sessionDir = dirAnswer.trim() || defaultDir

    const titleAnswer = await prompt("会话标题 (直接回车使用默认): ")
    const sessionTitle = titleAnswer.trim() || "RalphLoopCore 集成测试"

    logger.info(`[配置] 目录: ${sessionDir}`)
    logger.info(`[配置] 标题: ${sessionTitle}`)

    const session = await client.session.create({
      query: { directory: sessionDir },
      body: { title: sessionTitle },
    })
    if (!session.data) {
      throw new Error("创建会话失败")
    }
    logger.info(`[创建] 新会话: ${session.data.id}`)
    return { client, sessionId: session.data.id, directory: sessionDir }
  } else if (selectedSession) {
    logger.info(`[选择] 使用已有会话: ${selectedSession.id} - ${selectedSession.title ?? "(无标题)"}`)
    return { client, sessionId: selectedSession.id, directory }
  } else {
    const recentSessions = sessionList.slice(0, MAX_RECENT)
    const s = recentSessions[selected - 1]
    if (!s) {
      throw new Error("会话不存在")
    }
    logger.info(`[选择] 使用已有会话: ${s.id} - ${s.title ?? "(无标题)"}`)
    return { client, sessionId: s.id, directory }
  }
}

async function askUserWhereToGo(
  engine: LoopEngine,
  interruptedMsg: InterruptedMessage,
): Promise<string> {
  const reasonText =
    interruptedMsg.reason === "rollback"
      ? "[回滚] 检测到消息回滚"
      : interruptedMsg.reason === "new_message"
        ? "[新消息] 检测到新消息"
        : "[暂停] 检测到会话中断"

  logger.info("\n" + "=".repeat(60))
  logger.info(reasonText)
  logger.info("=".repeat(60))
  logger.info(`  节点名称: ${interruptedMsg.nodeName}`)
  logger.info(`  角色名称: ${interruptedMsg.roleName}`)
  logger.info(`  中断前消息: ${interruptedMsg.beforeMessage.substring(0, 100)}...`)
  logger.info(`  当前收到消息: ${interruptedMsg.receivedMessage.substring(0, 100)}...`)
  logger.info(`  检测时间: ${interruptedMsg.timestamp.toLocaleString()}`)
  logger.info()

  const strategy = engine.getStrategy()
  if (!strategy) {
    throw new Error("策略未加载")
  }

  const nodeNames = strategy.nodes.map((n) => n.name)
  consoleAndLogFile.info("当前策略可用节点:")
  for (let i = 0; i < nodeNames.length; i++) {
    logger.info(`  ${i + 1}. ${nodeNames[i]}`)
  }
  logger.info()

  logger.info("提示: 请选择将消息派发给哪个节点继续执行。")
  logger.info()

  while (true) {
    const current = strategy.nodes.findIndex((n) => n.name === interruptedMsg.nodeName) + 1 
    const answer = await prompt(`将消息派发给哪个节点? (1-${nodeNames.length}, 当前节点: ${current}.${interruptedMsg.nodeName}): `)
    const idx = parseInt(answer, 10) - 1
    if (!isNaN(idx) && idx >= 0 && idx < nodeNames.length) {
      const targetNode = strategy.nodes[idx]
      if (targetNode) {
        return targetNode.id
      }
    }
    consoleAndLogFile.info("无效的选项，请重新输入")
  }
}

async function controlledExecute(
  engine: LoopEngine,
  session: OpenCodeSessionAdapter,
  task: string,
): Promise<void> {
  const strategy = engine.getStrategy()
  if (!strategy) {
    throw new Error("策略未加载")
  }

  let currentNodeId = strategy.entryNode
  let iteration = 0
  const maxIterations = 500

  console.log(`[调试-controlledExecute] 初始状态: entryNode=${strategy.entryNode}, 节点总数=${strategy.nodes.length}`)
  console.log(`[调试-controlledExecute] 所有节点: ${strategy.nodes.map(n => n.name).join(", ")}`)

  let pendingInterrupt: InterruptedMessage | null = null

  session.onInterruption((msg) => {
    pendingInterrupt = msg
    logger.info(`[中断] reason=${msg.reason}`)
  })

  while (iteration < maxIterations) {
    iteration++
    
    logger.info(`[迭代 iteration=${iteration}] node=${currentNodeId}, sessionState=${session.getReceiveState()}`)
    console.log()

    if (pendingInterrupt) {
      logger.info(`[中断处理] reason=${pendingInterrupt.reason}`)
      const targetNodeId = await askUserWhereToGo(engine, pendingInterrupt)
      logger.info(`[用户决策] 跳转: ${targetNodeId}`)
      currentNodeId = targetNodeId
      pendingInterrupt = null
      session.clearInterruption()
      continue
    }

    const node = strategy.nodes.find((n) => n.id === currentNodeId)
    if (!node) {
      logger.error(`[错误] 节点 ${currentNodeId} 未找到`)
      break
    }

    consoleAndLogFile.info(`>>> ${node.name}`)
    engine.emit("nodeStart", node, engine.getState())

    const roleInstance = node.roles[0]
    if (!roleInstance) {
      logger.info(`[跳过] 节点 ${node.name} 没有角色`)
      continue
    }

    const systemPrompt = roleInstance.role.systemPrompt
    const userMessage = task

    try {
      session.setCurrentContext(node.name, roleInstance.role.name)
      const agent = node.accessMode === "readonly" ? "plan" : "build"
      consoleAndLogFile.info(`[DEBUG] node.accessMode=${node.accessMode}, calculated agent=${agent}`)
      await session.sendMessage({ role: "system", content: systemPrompt }, agent)
      logger.info(`[发送] user: ${userMessage.substring(0, 50)}...`)
      const response = await session.sendMessage({ role: "user", content: userMessage }, agent)

      if (session.getReceiveState() === MessageReceiveState.EXPECTING_NEXT_MESSAGE) {
        consoleAndLogFile.info(`[节点暂停] 等待用户消息...`)
        const userInput = await session.waitForUserMessage()
        consoleAndLogFile.info(`[节点继续] 收到用户消息: "${userInput.substring(0, 30)}..."`)
        continue
      }

      logger.info(`[收到] ${response.substring(0, 50)}...`)

      const result: Record<string, unknown> = {
        step: `role:${roleInstance.role.name}`,
        executed: `Role ${roleInstance.role.name} executed`,
        systemPrompt,
        weight: roleInstance.weight,
        status: "completed",
        session_output: response,
      }

      if (node.name === "终评节点") {
        result.qualityPassed = response.includes("通过") || response.includes("达标")
      }

      if (node.name === "体验节点") {
        result.ueApproved = response.includes("完成") || response.includes("通过")
        result.shouldExit = result.ueApproved === true
      }

      if (node.name === "分析节点") {
        result.needsReplan = false
      }

      logger.info(`<<< ${node.name} 完成`)
      engine.emit("nodeComplete", node, result as any, engine.getState())

      const ctx = engine.getContext()
      if (ctx.nodeResults) {
        ctx.nodeResults[currentNodeId] = result as any
      }

      if (engine.isWaitingForDecision()) {
        const nodeOptions = strategy.nodes.map((n) => n.id)
        engine.waitForDecision(nodeOptions)
        continue
      }

      const nextTransition = strategy.transitions.find(
        (t) => t.from === currentNodeId && t.condition.type === "always",
      )

      if (nextTransition) {
        const nextNodeId = nextTransition.to
        logger.info(`⇢ 跳转: ${currentNodeId} → ${nextNodeId}`)
        engine.emit(
          "transition",
          currentNodeId,
          nextNodeId,
          { matched: true, targetNode: nextNodeId },
          engine.getState(),
        )
        currentNodeId = nextNodeId
      } else if (strategy.exitNodes.includes(currentNodeId)) {
        consoleAndLogFile.info(`[完成] 到达退出节点`)
        break
      } else {
        logger.info(`[警告] 节点 ${currentNodeId} 没有出边`)
        break
      }
    } catch (error) {
      const err = error as Error
      if (err.name === "AbortError" || err.message.includes("Session aborted")) {
        consoleAndLogFile.info(`[暂停] ========== [已暂停] ==========, 当前state=${session.getReceiveState()}`)
        session.setCurrentContext(node.name, roleInstance.role.name)

        try {
          // 等待用户发消息，然后获取模型响应
          consoleAndLogFile.info(`[暂停] 开始等待用户消息和模型响应...`)
          const modelResponse = await session.waitForUserMessage()
          consoleAndLogFile.info(`[暂停] 收到模型响应: "${modelResponse.substring(0, 30)}..."`)
          
          // 使用模型响应作为节点结果继续执行
          const result: Record<string, unknown> = {
            step: `role:${roleInstance.role.name}`,
            executed: `Role ${roleInstance.role.name} executed (after pause)`,
            systemPrompt,
            weight: roleInstance.weight,
            status: "completed",
            session_output: modelResponse,
          }

          if (node.name === "终评节点") {
            result.qualityPassed = modelResponse.includes("通过") || modelResponse.includes("达标")
          }

          if (node.name === "体验节点") {
            result.ueApproved = modelResponse.includes("完成") || modelResponse.includes("通过")
            result.shouldExit = result.ueApproved === true
          }

          if (node.name === "分析节点") {
            result.needsReplan = false
          }

          logger.info(`<<< ${node.name} 完成 (暂停后)`)
          engine.emit("nodeComplete", node, result as any, engine.getState())

          const ctx = engine.getContext()
          if (ctx.nodeResults) {
            ctx.nodeResults[currentNodeId] = result as any
          }

          session.clearInterruption()

          // 继续跳转到下一个节点
          const nextTransition = strategy.transitions.find(
            (t) => t.from === currentNodeId && t.condition.type === "always",
          )

          if (nextTransition) {
            const nextNodeId = nextTransition.to
            logger.info(`⇢ 跳转: ${currentNodeId} → ${nextNodeId}`)
            engine.emit(
              "transition",
              currentNodeId,
              nextNodeId,
              { matched: true, targetNode: nextNodeId },
              engine.getState(),
            )
            currentNodeId = nextNodeId
          } else if (strategy.exitNodes.includes(currentNodeId)) {
            consoleAndLogFile.info(`[完成] 到达退出节点`)
            break
          } else {
            logger.info(`[警告] 节点 ${currentNodeId} 没有出边`)
            break
          }
          
          continue
        } catch (e) {
          const waitErr = e as Error
          logger.info(`[暂停] 等待结束: ${waitErr.message}`)
          break
        }
      }
      
      logger.error(`[错误] ${error}`)
      const errMsg = err.message
      if (errMsg.includes("检测到外部活动")) {
        logger.info(`[错误恢复] 检测到外部活动`)
        if (!pendingInterrupt) {
          logger.error(`[错误] pendingInterrupt 未设置`)
          engine.emit("nodeError", node, error as Error, engine.getState())
          break
        }
        const targetNodeId = await askUserWhereToGo(engine, pendingInterrupt)
        logger.info(`[用户决策] 跳转: ${targetNodeId}`)
        currentNodeId = targetNodeId
        pendingInterrupt = null
        session.clearInterruption()
        continue
      } else {
        engine.emit("nodeError", node, error as Error, engine.getState())
        break
      }
    }
  }

  engine.emit("complete", { success: true, totalIterations: iteration }, engine.getState())
}

async function main() {
  consoleAndLogFile.info(`RLC × OpenCode 集成测试`)
  consoleAndLogFile.info(`服务器: http://127.0.0.1:4096`)
  consoleAndLogFile.info(`工作目录: ${process.cwd()}`)
  consoleAndLogFile.info(`日志目录: ${path.join(process.cwd(), "log")}`)

  const { client, sessionId, directory: sessionDir } = await selectSession("http://127.0.0.1:4096", process.cwd())

  const session = new OpenCodeSessionAdapter(client, sessionId, sessionDir)
  await session.startEventListener()

  const engine = new LoopEngine({
    maxCycles: 5,
    cycleDelay: 1000,
  })

  engine.loadStrategy(ralphLoopStrategy)

  engine.on("paused", (node, reason) => {
    logger.info(`[暂停] ${node.name}: ${reason}`)
  })

  engine.on("resumed", (node) => {
    logger.info(`[恢复] ${node.name}`)
  })

  engine.on("waitingForDecision", (node, options) => {
    consoleAndLogFile.info(`[等待决策] ${node.name}: ${options.join(", ")}`)
  })

  engine.on("decisionMade", (node, selected) => {
    logger.info(`[决策] ${node.name}: ${selected}`)
  })

  engine.on("cycleComplete", (cycle) => {
    logger.info(`[循环 ${cycle}] 完成`)
  })

  engine.on("error", (error) => {
    logger.error(`[执行错误] ${error.message}`)
  })

  const task = "路径: F:/WebProjects/PTK_Official_Site/  任务:为名为\"琴神排名\"的音乐游戏项目开发官方网站"

  logger.info(`任务: ${task}`)

  await controlledExecute(engine, session, task)

  logger.info("\n历史记录:")
  for (const record of engine.getExecutionHistory()) {
    const status = record.state === "pass" ? "✓" : "✗"
    logger.info(`  ${status} ${record.nodeName} (轮次: ${record.cycle}, 迭代: ${record.iteration})`)
  }

  await session.stopEventListener()
}

main().catch((e) => logger.error("主函数错误:", e))
