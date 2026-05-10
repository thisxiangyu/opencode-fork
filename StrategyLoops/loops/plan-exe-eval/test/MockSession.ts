/**
 * Mock ISession 实现 - 不连接opencode后端
 */
import type { ISession } from "../../../common/session"
import type { IRole } from "../../../common/role"
import { MessageReceiveState } from "../../../common/types"
import type { InterruptedMsgContext, SessionMessage, TokenUsageInfo } from "../../../common/types"

export type MockResponseProvider = (role: IRole, msg: SessionMessage, compactHistory?: boolean) => string

export class MockSession implements ISession {
  id: string
  role: IRole
  directory: string
  private messages: SessionMessage[] = []
  private interruptions: InterruptedMsgContext[] = []
  private interruptionCallbacks: Array<(msg: InterruptedMsgContext) => void> = []
  private messageCallbacks: Array<(msg: SessionMessage) => void> = []
  private receiveState: MessageReceiveState = MessageReceiveState.IDLE
  private tokenUsage: TokenUsageInfo | undefined = undefined

  constructor(role: IRole, directory: string = "/tmp/mock-project", id?: string) {
    this.role = role
    this.directory = directory
    this.id = id ?? `mock-session-${role.name}-${Date.now()}`
  }

  setMockResponseProvider(_provider: MockResponseProvider): void {
    // 可以存储provider供后续使用
  }

  setReceiveState(state: MessageReceiveState): void {
    this.receiveState = state
  }

  setTokenUsage(usage: TokenUsageInfo): void {
    this.tokenUsage = usage
  }

  onInterruption(callback: (msg: InterruptedMsgContext) => void): void {
    this.interruptionCallbacks.push(callback)
  }

  onMessage(callback: (msg: SessionMessage) => void): void {
    this.messageCallbacks.push(callback)
  }

  setCurrentContext(roleName: string): void {
    this.receiveState = MessageReceiveState.EXPECTING_NEXT_MESSAGE
  }

  getReceiveState(): MessageReceiveState {
    return this.receiveState
  }

  async disposeAsync(): Promise<void> {
    // Mock实现
  }

  async sendMsg(message: SessionMessage, compactHistory?: boolean): Promise<string> {
    this.messages.push(message)
    for (const callback of this.messageCallbacks) {
      callback(message)
    }
    this.receiveState = MessageReceiveState.WAITING_PROMPT_RESPONSE

    // 默认返回空字符串，子类可以覆盖
    return ""
  }

  async waitForInterruption(timeoutMs?: number): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 10))
    return ""
  }

  clearInterruption(): void {
    // Mock实现
  }

  async waitForUserMessage(timeoutMs?: number): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 10))
    return ""
  }

  async getMessages(): Promise<SessionMessage[]> {
    return [...this.messages]
  }

  getTokenUsage(): TokenUsageInfo | undefined {
    return this.tokenUsage
  }

  // 用于测试的辅助方法
  getMessagesCount(): number {
    return this.messages.length
  }

  clearMessages(): void {
    this.messages = []
  }

  triggerInterruption(reason: InterruptedMsgContext["reason"], receivedMessage: string = "test message"): void {
    const ctx: InterruptedMsgContext = {
      roleName: this.role.name,
      beforeMessage: "before",
      receivedMessage,
      timestamp: new Date(),
      reason,
    }
    this.interruptions.push(ctx)
    for (const callback of this.interruptionCallbacks) {
      callback(ctx)
    }
  }
}

/**
 * 带预设响应的MockSession
 */
export class PresetMockSession extends MockSession {
  private presetResponses: Map<string, string> = new Map()
  private responseIndex: Map<string, number> = new Map()
  private compactHistory: boolean = false

  constructor(role: IRole, directory?: string) {
    super(role, directory)
  }

  setPresetResponse(key: string, response: string): void {
    this.presetResponses.set(key, response)
    this.responseIndex.set(key, 0)
  }

  setPresetResponses(key: string, responses: string[]): void {
    this.presetResponses.set(key, responses.join("|||SEPARATOR|||"))
    this.responseIndex.set(key, 0)
  }

  setCompactHistory(value: boolean): void {
    this.compactHistory = value
  }

  getCompactHistory(): boolean {
    return this.compactHistory
  }

  override async sendMsg(message: SessionMessage, compactHistory?: boolean): Promise<string> {
    await super.sendMsg(message, compactHistory)

    if (compactHistory !== undefined) {
      this.compactHistory = compactHistory
    }

    const key = this.role.name
    const preset = this.presetResponses.get(key)

    if (!preset) {
      // 返回默认响应
      return this.getDefaultResponse()
    }

    const responses = preset.split("|||SEPARATOR|||")
    const index = this.responseIndex.get(key) ?? 0

    if (index < responses.length) {
      this.responseIndex.set(key, index + 1)
      return responses[index]
    }

    return responses[responses.length - 1] // 重复使用最后一个响应
  }

  private getDefaultResponse(): string {
    // 根据角色类型返回默认响应
    if (this.role.name === "planner") {
      return JSON.stringify({
        本轮任务标题: "测试任务",
        留言: "请执行测试任务"
      })
    }
    if (this.role.name === "evaluator") {
      return JSON.stringify({
        检查结果: "通过",
        问题列表: [],
        打回留言: ""
      })
    }
    if (this.role.name === "architect") {
      return JSON.stringify({
        检查结果: "通过",
        架构问题: [],
        重构建议: "",
        打回留言: ""
      })
    }
    if (this.role.name === "compactor") {
      return JSON.stringify({
        是否压缩: false
      })
    }
    if (this.role.name === "ScissorHands" || this.role.name === "QA" || this.role.name === "EdgeQA" || this.role.name === "Commitman") {
      return JSON.stringify({
        一句话动态: "检查无问题"
      })
    }
    return "OK"
  }
}
