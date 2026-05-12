/**
 * OpenCode 会话适配层
 * 负责与 OpenCode 会话层交互，处理消息发送、事件监听和中断管理
 *
 * 【作用】
 * - 封装 OpenCode SDK 的底层细节，提供简洁的会话接口
 * - 管理消息历史，支持上下文传递
 * - 处理多种类型的中断（暂停、回滚、用户消息等）
 * - 通过状态机确保消息处理流程的正确性
 *
 * ============================================================================
 * Opencode SDK 版本坑点说明 (v1 vs v2, 这里采用v2)
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
 * - logFile 控制台输出: 精简的关键信息 
 * - consoleAndLogFile 文件输出: 详细日志，保存在 StrategyLoops\log 目录下，按日期命名
 * ============================================================================
 */

import { 
 createOpencodeClient,
 type OpencodeClient, 
 type Part,
 type SyncEventMessagePartUpdated, 
 type SyncEventMessageUpdated,
 type Session,
 type PermissionRuleset,
} from "@opencode-ai/sdk/v2/client"

import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import path from "path"
import { existsSync } from "fs"

import type {
  InterruptionReason,
  InterruptedMsgContext,
  MessageReceiveState,
  SendBaseline,
  SessionMessage,
  TokenUsageInfo,
  WaitContext,
} from "../types"
import { MessageReceiveState as State, AbortError, INTERRUPTION_REASON, MSG_SOURCE } from "../types"
import { logFile, consoleAndLogFile, LOG_COLOR } from "../logger"
import type { ISession } from "../session"
import type { IRole } from "../role"
import { askUser } from "../system"

type EventPropsWithSession = {
  sessionID?: string
  info?: {
    id: string
    role: string
    sessionID?: string
  }
  status?: {
    type?: string
  }
}

type MessagePartProps = {
  part?: Part
}

type SessionErrorProps = {
  error?: {
    name?: string
    data?: {
      message?: string
    }
  }
}

type CommandExecuteProps = {
  command?: string
}

const LATE_ABORT_SETTLE_MS = 150

type PayloadWithProperties = {
  properties?: unknown
}

function hasProperties(payload: GlobalEvent["payload"]): payload is GlobalEvent["payload"] & PayloadWithProperties {
  return "properties" in payload
}

function isSyncMessageUpdatedPayload(payload: GlobalEvent["payload"]): payload is SyncEventMessageUpdated {
  return payload.type === "sync" && "name" in payload && payload.name === "message.updated.1"
}

function isSyncMessagePartUpdatedPayload(payload: GlobalEvent["payload"]): payload is SyncEventMessagePartUpdated {
  return payload.type === "sync" && "name" in payload && payload.name === "message.part.updated.1"
}

/**
 * 这些事件对会话逻辑没有实质性影响，可以跳过处理
 *
 * 用于避免:
 * - 日志中充满无关事件，难以调试
 * - 每次事件都触发 handleEvent，增加性能开销
 */
const IGNORED_EVENTS = new Set([
  "server.heartbeat",    // 心跳事件，无实际意义
  "message.part.delta",  // 消息部分增量更新，我们处理完整文本
  "session.diff",        // 会话差异，不影响主流程
  "session.updated",     // 会话更新通知，我们自己维护状态
])


let client: OpencodeClient | undefined
let globalEventManager: OpenCodeEventManager | undefined

export function linkBackend(serverURL:string) : string {
  client = createOpencodeClient({ baseUrl: serverURL })
  globalEventManager = new OpenCodeEventManager(client)
  return "opencode"
}

/**
 * 根据角色的 disabledTools 构建权限规则集
 *
 * 角色通过 disabledTools 字段声明需要禁用的内置工具，
 * 适配层将其转换为 PermissionRuleset（PATCH /session/{sessionID}）。
 * 不关心角色名称，只读取角色自身的声明。
 */
function buildRolePermissions(role: IRole): PermissionRuleset {
  if (!role.disabledTools?.length) return []
  return role.disabledTools.map((tool) => ({
    permission: tool,
    pattern: "*",
    action: "deny" as const,
  }))
}

/**
 * 为 session 应用角色权限
 *
 * 在 session 创建或连接后立即调用，确保"一创建/连接就关"。
 * session.update 是 merge 语义，不会覆盖已有规则，仅追加/覆盖同 key 规则。
 */
async function applyRolePermissions(sessionId: string, role: IRole): Promise<void> {
  if (!client) return
  const permissions = buildRolePermissions(role)
  try {
    await client.session.update({ sessionID: sessionId, permission: permissions })
    logFile.info(`[权限] 已应用角色权限: role=${role.name}, rules=${JSON.stringify(permissions)}`)
  } catch (err) {
    consoleAndLogFile.warn(`[权限] 应用角色权限失败: ${(err as Error).message}`)
  }
}

class OpenCodeEventManager {
  private client: OpencodeClient
  // WeakRef only prevents the manager from keeping abandoned adapters alive.
  // Normal lifecycle cleanup still relies on explicit stopEventListener().
  private adapters = new Map<string, WeakRef<OpenCodeSessionAdapter>>()
  private running = false

  constructor(client: OpencodeClient) {
    this.client = client
  }

  subscribe(adapter: OpenCodeSessionAdapter): void {
    this.adapters.set(adapter.id, new WeakRef(adapter))
    if (!this.running) {
      this.start()
    }
  }

  unsubscribe(sessionId: string): void {
    this.adapters.delete(sessionId)
  }

  private start(): void {
    this.running = true

    ;(async () => {
      try {
        const events = await this.client.global.event()
        for await (const event of events.stream as AsyncIterable<GlobalEvent>) {
          if (IGNORED_EVENTS.has(event.payload.type)) {
            continue
          }
          const sessionId = this.getSessionId(event)
          if (!sessionId) continue
          const ref = this.adapters.get(sessionId)
          const adapter = ref?.deref()
          if (!adapter) {
            this.adapters.delete(sessionId)
            continue
          }
          await adapter.handleEventDirect(event)
        }
      } catch (err) {
        consoleAndLogFile.error(`[事件流] 事件循环异常: ${(err as Error)?.message ?? err}`)
      } finally {
        this.running = false
      }
    })()
  }

  private getSessionId(event: GlobalEvent): string | undefined {
    const payload = event.payload
    if (payload.type === "sync") {
      if ("data" in payload && payload.data && typeof payload.data === "object") {
        return (payload.data as { sessionID?: string }).sessionID
      }
    }
    if ("properties" in payload && payload.properties) {
      const props = payload.properties as { sessionID?: string; info?: { sessionID?: string } }
      return props.sessionID ?? props.info?.sessionID
    }
    return undefined
  }
}

export async function selectOrCreateSession(
  role: IRole,
): Promise<ISession> {

  if(client==null)
  {
    throw new Error("未连接到服务器,请先linkBackend")
  }

  console.log("=".repeat(60))
  console.log("选择会话")
  console.log("=".repeat(60))
  console.log()

  // 让用户输入项目路径并检查存在性
  let projectDir = ""
  while (true) {
    const dirAnswer = await askUser("请输入项目目录路径: ")
    projectDir = path.resolve(dirAnswer.trim())
    if (!projectDir) {
      console.log("路径不能为空，请重新输入")
      console.log()
      continue
    }

    // 检查路径是否存在
    if (!existsSync(projectDir)) {
      console.log(`路径不存在: ${projectDir}，请重新输入`)
      console.log()
      continue
    }

    logFile.info(`[配置] 目录: ${projectDir}`)
    break
  }

  console.log(`已选择项目目录: ${projectDir}`)
  console.log()

  const sessions: { data: Session[] | undefined } = await client.session.list({ directory: projectDir })
  const sessionList: Session[] = sessions.data ?? []
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
      console.log(`  ${i + 1}. ${title}`)
      logFile.info(`  ${i + 1}. ${title}  ( SessionID: ${s.id})`)
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
    const answer = await askUser("请输入选项 (0-新增, 1-" + MAX_RECENT + "选最近会话, 或输入字符按会话名称搜索): ")

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

        const pickAnswer = await askUser("选择会话 (1-" + Math.min(matched.length, 10) + "): ")
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
    logFile.info("[创建] 打开新会话...")

    const titleAnswer = await askUser("会话标题 (直接回车使用默认): ")
    const sessionTitle = titleAnswer.trim() || "RalphLoopCore 集成测试"

    logFile.info(`[配置] 标题: ${sessionTitle}`)

    return await createSession(role, sessionTitle, projectDir)
  } else if (selectedSession) {
    logFile.info(`[选择] 使用已有会话: ${selectedSession.id} - ${selectedSession.title ?? "(无标题)"}`)
    await applyRolePermissions(selectedSession.id, role)
    return new OpenCodeSessionAdapter(client, selectedSession.id, role, selectedSession.directory ?? projectDir)
  } else {
    const recentSessions = sessionList.slice(0, MAX_RECENT)
    const s = recentSessions[selected - 1]
    if (!s) {
      throw new Error("会话不存在")
    }
    logFile.info(`[选择] 使用已有会话: ${s.id} - ${s.title ?? "(无标题)"}`)
    await applyRolePermissions(s.id, role)
    return new OpenCodeSessionAdapter(client, s.id, role, s.directory ?? projectDir)
  }
}

export async function createSession(role: IRole, title: string, directory: string): Promise<ISession> {
    if(client==null)
    {
      throw new Error("未连接到服务器,请先link")
    }
    const session = await client.session.create({
      directory: directory,
      title: title,
    })
    if (!session.data) {
      throw new Error("创建会话失败")
    }
    logFile.info(`[创建] 新会话: ${session.data.id}`)
    await applyRolePermissions(session.data.id, role)
    return new OpenCodeSessionAdapter(client, session.data.id, role, directory)
}

/**
 * OpenCode 会话适配类
 */
export class OpenCodeSessionAdapter implements ISession {
  // ==================== 实例属性 ====================

  /** 会话唯一标识符 */
  id: string

  /** 所属角色（携带 model 和 accessMode） */
  role: IRole

  /**
   * OpenCode 客户端实例
   *
   * 【作用】持有 SDK 客户端，用于发送 prompt 和订阅事件
   */
  private client: OpencodeClient

  /**
   * 会话工作目录
   *
   * 【作用】指定会话的工作目录路径，用于 prompt 参数
   */
  directory: string

  /**
   * 消息历史记录
   * 存储所有发送和接收的消息，支持上下文传递
   *
   * 【作用】
   * - 维护完整对话历史，用于上下文理解
   * - getMessages() 可获取历史记录供外部使用
   */
  private messageHistory: SessionMessage[] = []

  /**
   * 中断回调函数
   * 当检测到中断时被调用
   *
   * 【作用】解耦中断检测和中断处理，上层可自定义处理逻辑
   *
   * 【没有会怎样】无法通知上层，中断无法被处理
   */
  private interruptionCallback: ((msg: InterruptedMsgContext) => void) | null = null

  /**
   * 消息回调函数
   * 当收到新消息时被调用
   *
   * 【作用】解耦消息接收和处理逻辑
   *
   * 【没有会怎样】无法实时接收消息，只能通过轮询获取
   */
  private messageCallback: ((msg: SessionMessage) => void) | null = null

  /**
   * 当前角色名称
   * 用于中断时标识中断发生在哪个角色
   */
  private currentRoleName: string = ""

  /**
   * 最后接收到的消息内容
   * 用于中断时提供"中断前"的内容
   */
  private lastReceivedMessageContent: string = ""

  /**
   * 消息接收状态
   * 状态机核心，标识当前所处阶段
   *
   * 【作用】通过状态机管理消息流程，避免重复处理
   * - IDLE: 空闲，可发送新消息
   * - WAITING_PROMPT_RESPONSE: 等待 prompt 响应
   * - EXPECTING_NEXT_MESSAGE: 等待下一条消息
   * - RECEIVED_INTERRUPTION: 已收到中断
   *
   * 【没有会怎样】无法跟踪会话状态，可能在错误时机发送消息
   */
  private receiveState: MessageReceiveState = State.IDLE

  /**
   * 待处理消息内容
   * 记录正在等待响应的那条消息的内容
   *
   * 【作用】用于中断时记录"中断前"的消息
   *
   * 【没有会怎样】中断回滚时无法知道被中断的是哪条消息
   */
  private pendingMessageContent: string = ""

  /**
   * 最近一次 LLM 调用的 token 用量
   * 从 step-finish 事件中捕获，与 compaction 触发判断使用同一数据源
   */
  private latestTokenUsage: TokenUsageInfo | undefined

  /**
   * 累计 token 用量。
   * 因为一些后端（如 opencode server）可能存在自动压缩与标称不同的问题，
   * 有可能出现像 gpt-5.5 这样 100 万上下文的模型在 23 万就被压缩的问题，
   * 导致策略循环中的角色压缩阈值永远不被触发。所以这里用一个字段来维护
   * 一个更权威的 token 统计：每次 step-finish 时优先累加 total，缺失时用
   * input + output + reasoning + cache.read + cache.write 还原本轮总量。
   */
  private cumulativeTokens = 0

  /**
   * 由策略循环主动发起且已成功执行的压缩次数。
   * 与后端自身的自动压缩无关，仅统计 compactHistory=true 且 summarize 成功的调用。
   * 初始值为 0，每次策略主动压缩成功后递增。
   */
  private 主动压缩次数 = 0

  /**
   * 最后一条用户消息的 ID
   * 用于判断新消息是否是用户生成的
   */
  private lastUserMessageId: string | null = null

  /**
   * 最后一条Agent消息的 ID
   * 用于判断新消息是否是助手生成的
   */
  private lastAssistantMessageId: string | null = null

  /**
   * 消息ID到角色的映射
   * 通过消息ID快速查找对应的角色
   *
   * 【作用】避免每次都去解析消息结构，直接查表获取角色
   */
  private roleByMessageId = new Map<string, string>()

  /**
   * 消息ID到文本内容的映射
   * 缓存消息文本，避免重复获取
   */
  private messageTextById = new Map<string, string>()

  /**
   * 待处理的中断消息
   * 记录最近一次中断的完整信息
   */
  private pendingInterruption: InterruptedMsgContext | null = null

  /**
   * 中断解决的 Promise resolve 函数
   * 用于 waitForInterruption() 返回结果
   */
  private interruptionResolve: ((value: string) => void) | null = null

  /**
   * 等待上下文
   * 在等待消息期间维护的基准信息
   *
   * 【作用】支持 waitForUserMessage 的两阶段等待
   * （先等用户消息，再等助手响应）
   *
   * 【没有会怎样】无法实现复杂的等待逻辑
   */
  private waitContext: WaitContext | null = null

  /**
   * 最近一次主动发送开始前的消息基线。
   * aborted 后等待新引导时必须使用这组基线，避免被本次已中断请求产生的 user 事件污染。
   */
  private lastSendBaseline: SendBaseline | null = null

  /**
   * 等待用户消息的 Promise
   * 防止重复创建等待 Promise
   */
  private waitForUserMessagePromise: Promise<string> | null = null

  // ==================== 构造函数 ====================

  /**
   * 构造函数
   *
   * @param client OpenCode 客户端实例
   * @param sessionId 会话ID
   * @param role 所属角色（携带 model 和 accessMode）
   * @param directory 工作目录
   */
  constructor(client: OpencodeClient, sessionId: string, role: IRole, directory: string) {
    this.client = client
    this.id = sessionId
    this.role = role
    this.directory = directory
    globalEventManager?.subscribe(this)
  }

  // ==================== 公共方法 ====================

  /**
   * 中断回调
   * 当检测到会话中断时被调用
   *
   * 【作用】允许上层自定义中断处理逻辑
   */
  onInterruption(callback: (msg: InterruptedMsgContext) => void): void {
    this.interruptionCallback = callback
  }

  /**
   * 消息回调
   * 当收到新消息时被调用
   *
   * 【作用】支持实时消息处理
   *
   * 【没有会怎样】只能通过 sendMessage 主动获取消息
   */
  onMessage(callback: (msg: SessionMessage) => void): void {
    this.messageCallback = callback
  }

  /**
   * 设置当前上下文
   * 在执行节点前调用
   *
   * 【作用】为中断提供上下文信息，知道中断发生在哪
   */
  setCurrentContext(roleName: string): void {
    this.currentRoleName = roleName
    logFile.info(`[状态] 设置上下文 -> role=${roleName}, state=${this.receiveState}`)
  }

  /**
   * 获取当前接收状态
   */
  getReceiveState(): MessageReceiveState {
    return this.receiveState
  }

  /**
   * 直接处理事件（由全局事件管理器调用）
   */
  async handleEventDirect(event: GlobalEvent): Promise<void> {
    await this.handleEvent(event)
  }

  /**
   * 释放资源，避免资源泄漏
   */
  async disposeAsync(): Promise<void> {
    globalEventManager?.unsubscribe(this.id)
  }

  private isModelNotFoundError(err: unknown): boolean {
    const e = err as any
    const msg = e?.message ?? ""
    const isModelNotFound =
      msg.includes("model") && (msg.includes("not found") || msg.includes("invalid") || msg.includes("does not exist"))
    const isProviderNotFound =
      msg.includes("provider") && (msg.includes("not found") || msg.includes("invalid"))
    return isModelNotFound || isProviderNotFound
  }

  private async doSend(message: SessionMessage, agentMode?: string, model?: { providerID: string; modelID: string }): Promise<string> {
    const promptParams: any = {
      sessionID: this.id,
      directory: this.directory,
      parts: [{ type: "text", text: message.content }],
      system: message.msgSource === MSG_SOURCE.system ? message.content : undefined,
    }
    if (agentMode) {
      promptParams.agent = agentMode
    }
    if (model) {
      promptParams.model = model
    }

    let aborted = false
    let abortReason: string | null = null

    const checkInterruption = () => {
      if (this.receiveState === State.RECEIVED_INTERRUPTION) {
        logFile.info(`[发送] 检测到中断, reason=${this.pendingInterruption?.reason}`)
        aborted = true
        abortReason = this.pendingInterruption?.receivedMessage ?? "用户按下了暂停键"
      }
    }

    const waitForLateAbort = async () => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < LATE_ABORT_SETTLE_MS) {
        checkInterruption()
        if (aborted) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }

    const promptPromise = this.client.session.prompt(promptParams)

    const response = await Promise.race([
      Promise.resolve(promptPromise),
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
    await waitForLateAbort()
    if (aborted) {
      logFile.info(`[发送] prompt 已返回，但检测到中断，丢弃本次响应: ${abortReason ?? "unknown"}`)
      throw new AbortError()
    }

    let responseText = ""
    const respData = (response as any).data
    const parts = (response as any).parts ?? respData?.parts
    logFile.info(`[DEBUG doSend] response keys=${Object.keys(response)}, data exists=${respData != null}${respData ? ', data keys=' + Object.keys(respData) : ''}`)
    logFile.info(`[DEBUG doSend] parts source=${(response as any).parts ? 'direct' : respData?.parts ? 'data' : 'none'}`)
    if (parts) {
      logFile.info(`[DEBUG doSend] parts.length=${parts.length}`)
      for (const p of parts) {
        logFile.info(`[DEBUG doSend] part type=${p.type}`)
        if (p.type === "text") {
          responseText += (p as { text: string }).text + "\n"
        }
      }
      if (responseText) {
        const trimmed = responseText.trim()
        this.messageHistory.push({ msgSource: MSG_SOURCE.agent, content: trimmed })
        this.lastReceivedMessageContent = trimmed
        this.receiveState = State.IDLE
        if (this.messageCallback) {
          this.messageCallback({ msgSource: MSG_SOURCE.agent, content: trimmed })
        }
        return trimmed
      }
    }
    this.receiveState = State.IDLE
    return responseText
  }

  /**
   * 向会话发送消息并等待响应
   *
   * agent 和 model 自动从 session.role 推导，无需调用方传入。
   *
   * @param message 要发送的消息
   * @param compactHistory 是否在发送前先压缩会话历史（默认 false）
   * @returns 模型的响应文本
   */
  async sendMsg(message: SessionMessage, compactHistory: boolean = false): Promise<string> {
    const agentMode = this.role.accessMode === "readonly" ? "plan" : "build"
    const model = this.role.model
    logFile.info(`[DEBUG sendMessage] 开始, state=${this.receiveState}, msgSource=${message.msgSource}, directory=${this.directory}, agent=${agentMode}, model=${model ? `${model.providerID}/${model.modelID}` : "default"}, compactHistory=${compactHistory}`)

    if (compactHistory) {
      if (!model) {
        throw new Error("compactHistory=true 但 role.model 为空，无法确定用于压缩的模型")
      }
      logFile.info(`[压缩] 触发压缩 provider=${model.providerID} model=${model.modelID}`)
      await this.client.session.summarize({
        sessionID: this.id,
        directory: this.directory,
        providerID: model.providerID,
        modelID: model.modelID,
        auto: false,
      })
      this.increment主动压缩次数()
      logFile.info(`[压缩] 压缩完成，继续发送消息`)
    }

    this.messageHistory.push(message)
    this.pendingMessageContent = message.content
    this.lastSendBaseline = {
      userMessageId: this.lastUserMessageId,
      assistantMessageId: this.lastAssistantMessageId,
    }

    if (message.msgSource === MSG_SOURCE.system && this.receiveState === State.IDLE) {
      this.receiveState = State.WAITING_PROMPT_RESPONSE
      logFile.info(`[状态变更] WAITING_PROMPT_RESPONSE (等待prompt响应)`)
    }

    if (this.receiveState === State.EXPECTING_NEXT_MESSAGE) {
      logFile.info(`[发送] state=EXPECTING_NEXT_MESSAGE，跳过发送，返回""`)
      return ""
    }

    if (this.receiveState === State.RECEIVED_INTERRUPTION) {
      logFile.info(`[发送] state=RECEIVED_INTERRUPTION，将抛出AbortError`)
    }

    const modelsToTry = model ? [model, undefined] : [undefined]
    let lastError: Error | null = null

    for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
      const currentModel = modelsToTry[attempt]
      try {
        const result = await this.doSend(message, agentMode, currentModel)
        this.pendingMessageContent = ""
        return result
      } catch (err) {
        lastError = err as Error
        if (err instanceof AbortError || (err as Error).name === "AbortError") {
          throw err
        }

        const isLastAttempt = attempt === modelsToTry.length - 1
        if (this.isModelNotFoundError(err) && !isLastAttempt) {
          consoleAndLogFile.warn(`[模型回退] 指定模型 ${currentModel!.providerID}/${currentModel!.modelID} 不可用，尝试默认模型: ${(err as Error).message}`)
          this.receiveState = State.IDLE
          continue
        }

        this.receiveState = State.IDLE

        const isAbortRelated =
          (err as Error)?.name === "AbortError" ||
          (err as Error)?.name === "AbortController" ||
          (err as Error)?.message?.includes("abort") ||
          (err as Error)?.message?.includes("cancelled") ||
          (err as Error)?.message?.includes("取消")

        if (isAbortRelated) {
          this.pendingInterruption = {
            roleName: this.currentRoleName,
            beforeMessage: this.pendingMessageContent,
            receivedMessage: "用户按下了暂停键",
            timestamp: new Date(),
            reason: INTERRUPTION_REASON.aborted,
          }
          throw new AbortError()
        }

        logFile.error(`[发送消息] 其他错误: ${(err as Error).message}`)
        throw err
      }
    }

    this.pendingMessageContent = ""
    throw lastError!
  }

  /**
   * 等待中断
   * 阻塞等待直到收到中断信号或超时
   *
   * 【作用】
   * - 支持超时控制
   * - 返回中断消息内容
   */
  async waitForInterruption(timeoutMs: number = 0): Promise<string> {
    consoleAndLogFile.info(`[等待中断] timeout=${timeoutMs}ms, state=${this.receiveState}`)

    // 已有中断待处理，直接返回
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

  /**
   * 清空中断状态
   * 重置所有中断相关状态
   *
   * 【作用】外部在处理完中断后调用，恢复到空闲状态
   *
   * 【不清理会怎样】中断状态残留，影响后续消息处理
   */
  clearInterruption(): void {
    this.pendingInterruption = null
    this.receiveState = State.IDLE
    this.interruptionResolve = null
    this.waitContext = null
  }

  /**
   * 等待用户消息
   * 阻塞等待直到收到用户新消息
   *
   * 【作用】
   * - 实现两阶段等待：先等用户消息，再等助手响应
   * - 支持超时控制
   * - 防止重复创建等待 Promise
   *
   * 【没有会怎样】无法实现需要用户输入的交互流程
   */
  async waitForUserMessage(timeoutMs: number = 1000* 60* 12): Promise<string> {
    // 防止重复等待
    if (this.waitForUserMessagePromise) {
      consoleAndLogFile.info(`[等待用户消息] 已在等待中，返回现有Promise`)
      return this.waitForUserMessagePromise
    }

    consoleAndLogFile.info(`[等待用户消息] timeout=${timeoutMs / 1000}s, 设置状态为 EXPECTING_NEXT_MESSAGE`)
    this.receiveState = State.EXPECTING_NEXT_MESSAGE
    this.pendingInterruption = null
    const baseline = this.lastSendBaseline ?? {
      userMessageId: this.lastUserMessageId,
      assistantMessageId: this.lastAssistantMessageId,
    }
    this.waitContext = {
      phase: "waiting_user",
      startedAt: Date.now(),
      baselineUserMessageId: baseline.userMessageId,
      baselineAssistantMessageId: baseline.assistantMessageId,
      resumedUserMessageId: null,
    }
    consoleAndLogFile.info(`[等待用户消息] 状态已设置，开始等待... baselineUser=${baseline.userMessageId ?? "none"}, baselineAssistant=${baseline.assistantMessageId ?? "none"}`)

    this.waitForUserMessagePromise = new Promise<string>((resolve, reject) => {
      let userMessageReceived = false
      let resolved = false

      const cleanup = () => {
        this.waitForUserMessagePromise = null
        this.waitContext = null
      }

      // 轮询检查中断状态
      const checkInterval = setInterval(() => {
        if (resolved) return

        // 等待阶段再次按 ESC，不应该结束等待，而是继续等待下一次真实用户消息。
        if (this.pendingInterruption?.reason === INTERRUPTION_REASON.aborted) {
          consoleAndLogFile.info(`[等待用户消息] 检测到再次中止，继续等待下一次用户消息...`)
          this.pendingInterruption = null
          this.receiveState = State.EXPECTING_NEXT_MESSAGE
          return
        }

        // 检测到用户新消息，继续等待助手响应
        if (!userMessageReceived && this.pendingInterruption?.reason === INTERRUPTION_REASON.new_message) {
          userMessageReceived = true
          consoleAndLogFile.info(`[等待用户消息] 检测到用户消息，继续等待模型响应...`)
          this.pendingInterruption = null
          return
        }

        // 检测到助手响应，完成等待
        if (userMessageReceived && this.pendingInterruption?.reason === INTERRUPTION_REASON.rollback) {
          const response = this.pendingInterruption.receivedMessage
          consoleAndLogFile.info(`[等待用户消息] 检测到模型响应: "${response.substring(0, 30)}..."`)
          resolved = true
          clearInterval(checkInterval)
          cleanup()
          this.receiveState = State.IDLE
          resolve(response)
        }
      }, 100)

      // 超时处理
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

  /**
   * 获取消息历史
   * 返回所有已发送和接收的消息
   */
  async getMessages(): Promise<SessionMessage[]> {
    return [...this.messageHistory]
  }

  /**
   * 获取最近一次 LLM 调用的 token 用量
   *
   * 数据来源：OpenCode step-finish 事件（message.part.updated 中的 step-finish part）
   * 与 compaction 触发机制（overflow.ts:isOverflow）使用同一数据源。
   * input 字段反映当前上下文窗口的 token 占用量。
   */
  getTokenUsage(): TokenUsageInfo | undefined {
    return this.latestTokenUsage
  }

  getCumulativeTokens(): number {
    return this.cumulativeTokens
  }

  get主动压缩次数(): number {
    return this.主动压缩次数
  }

  /** 由会话适配器在主动压缩成功后递增计数。 */
  increment主动压缩次数(): void {
    this.主动压缩次数++
    logFile.info(`[主动压缩计数] session=${this.id}, 次数=${this.主动压缩次数}`)
  }

  // ==================== 私有方法 ====================

  /**
   * 处理单个事件
   * 根据事件类型分发到具体处理函数
   */
  private async handleEvent(event: GlobalEvent): Promise<void> {
    const payload = event.payload
    const type = payload.type
    const sessionId = this.getEventSessionId(payload)

    // 忽略非本会话的事件
    if (sessionId && sessionId !== this.id) return

    switch (type) {
      case "session.status":
        break

      case "message.updated":
        this.handleMessageUpdated(hasProperties(payload) ? (payload.properties as EventPropsWithSession | undefined) : undefined)
        break

      case "message.part.updated":
        await this.handleMessagePartUpdated(hasProperties(payload) ? (payload.properties as MessagePartProps | undefined) : undefined)
        break

      case "session.error":
        this.handleSessionError(hasProperties(payload) ? (payload.properties as SessionErrorProps | undefined) : undefined)
        break

      case "session.idle":
        if ((hasProperties(payload) ? (payload.properties as EventPropsWithSession | undefined) : undefined)?.sessionID === this.id && this.receiveState === State.EXPECTING_NEXT_MESSAGE) {
          logFile.info(`[事件] 会话空闲，等待用户消息...`)
        }
        break

      case "tui.command.execute":
        this.handleCommandExecute(hasProperties(payload) ? (payload.properties as CommandExecuteProps | undefined) : undefined)
        break

      case "sync":
        if (isSyncMessageUpdatedPayload(payload)) {
          this.handleMessageUpdated(payload.data)
          break
        }
        if (isSyncMessagePartUpdatedPayload(payload)) {
          await this.handleMessagePartUpdated(payload.data)
        }
        break
    }
  }

  private getEventSessionId(payload: GlobalEvent["payload"]): string | undefined {
    if (isSyncMessageUpdatedPayload(payload) || isSyncMessagePartUpdatedPayload(payload)) {
      return payload.data.sessionID
    }
    if (!hasProperties(payload)) return undefined
    const props = payload.properties as EventPropsWithSession | undefined
    return props?.sessionID ?? props?.info?.sessionID
  }

  /**
   * 处理消息更新事件
   */
  private handleMessageUpdated(props: EventPropsWithSession | undefined): void {
    const info = props?.info
    if (!info) return
    if (info.sessionID !== this.id) return

    if (info.role === "user") {
      this.roleByMessageId.set(info.id, info.role)
      logFile.info(
        `[事件-DEBUG] 用户消息, state=${this.receiveState}, role=${info.role}, waitPhase=${this.waitContext?.phase ?? "none"}, baselineUser=${this.waitContext?.baselineUserMessageId ?? "none"}, currentId=${info.id}`,
      )
      logFile.info(`[事件-DEBUG] 用户消息等待 part.updated 提供文本`)
    } else if (info.role === "assistant") {
      this.roleByMessageId.set(info.id, info.role)
      logFile.info(
        `[事件-DEBUG] Agent消息, state=${this.receiveState}, role=${info.role}, waitPhase=${this.waitContext?.phase ?? "none"}, baselineAssistant=${this.waitContext?.baselineAssistantMessageId ?? "none"}, currentId=${info.id}, pendingReason=${this.pendingInterruption?.reason || "none"}`,
      )
      logFile.info(`[事件-DEBUG] Agent消息等待 part.updated 提供文本`)
    }
  }

  /**
   * 处理消息part更新事件（核心）
   * 这是实际文本内容到达的地方
   */
  private async handleMessagePartUpdated(props: MessagePartProps | undefined): Promise<void> {
    const part = props?.part
    if (!part) return
    if (part.sessionID !== this.id) return

    // 捕获 step-finish 中的 token 用量（compaction 触发判断的同一数据源）
    if (part.type === "step-finish") {
      this.latestTokenUsage = {
        total: part.tokens.total,
        input: part.tokens.input,
        output: part.tokens.output,
        reasoning: part.tokens.reasoning,
        cache: { read: part.tokens.cache.read, write: part.tokens.cache.write },
        cost: part.cost,
      }
      // 累加本轮 token 总量，不受后端自动 compaction 导致的 total 回落影响。
      const roundTokens = part.tokens.total ||
        (part.tokens.input || 0) +
        (part.tokens.output || 0) +
        (part.tokens.reasoning || 0) +
        (part.tokens.cache?.read || 0) +
        (part.tokens.cache?.write || 0)
      this.cumulativeTokens += roundTokens
      logFile.info(`[Token累计] session=${this.id}, 本轮=${roundTokens}, 累计=${this.cumulativeTokens}, opencode报告total=${part.tokens.total}`)
      return
    }

    if (part.type !== "text") return
    if (part.ignored) return

    // 查找消息角色
    const role = this.roleByMessageId.get(part.messageID)
    if (!role) {
      logFile.info(`[事件-DEBUG] part.updated 未知角色, messageId=${part.messageID}, partId=${part.id}`)
      return
    }

    this.messageTextById.set(part.messageID, part.text)
    logFile.info(
      `[事件-DEBUG] part.updated role=${role}, state=${this.receiveState}, waitPhase=${this.waitContext?.phase ?? "none"}, messageId=${part.messageID}, partId=${part.id}, textEnd=${part.time?.end ?? "none"}, text="${part.text.substring(0, 30)}..."`,
    )

    // 用户消息处理
    // 这里负责捕获"新消息重发 / 用户插入了新输入"。
    // 判定条件不是看文本内容，而是看 messageID 是否不同于进入等待态时记录的 baselineUserMessageId。
    // 一旦不同，说明这不是旧消息的补丁更新，而是用户真的发来了一条新的消息，
    // 所以要把它记成 pendingInterruption(reason=new_message)，并把等待阶段切到 waiting_assistant，
    // 表示下一步要继续等模型基于这条新消息产出新的回答。
    if (role === "user") {
      this.lastUserMessageId = part.messageID
      // 在等待用户消息时，收到不同于基准的消息ID -> 新消息到达
      if (this.receiveState === State.EXPECTING_NEXT_MESSAGE && this.isResumedUserMessage(part.messageID)) {
        this.pendingInterruption = {
          roleName: this.currentRoleName,
          beforeMessage: this.pendingMessageContent,
          receivedMessage: part.text,
          timestamp: new Date(),
          reason: INTERRUPTION_REASON.new_message,
        }

        if (this.waitContext) {
          this.waitContext.phase = "waiting_assistant"
          this.waitContext.resumedUserMessageId = part.messageID
        }

        logFile.info(`[事件] 新用户消息(part): "${part.text.substring(0, 30)}..."`)
        if (this.interruptionCallback) {
          this.interruptionCallback(this.pendingInterruption)
        }
      }
      return
    }

    // Agent消息处理
    // 这里负责捕获"回滚后 / 新消息重发后，模型给出的新一轮回答"。
    // 只有同时满足以下条件才算真正的恢复结果：
    // 1. 当前仍处于 EXPECTING_NEXT_MESSAGE
    // 2. 等待阶段已经从 waiting_user 切到了 waiting_assistant
    // 3. Agent消息ID 相比 baselineAssistantMessageId 已经变化
    // 4. part.time.end 已存在，说明这段文本已经完整结束，不是流式中间态
    // 满足后把它记成 pendingInterruption(reason=rollback)，
    // 上层拿到这个中断后就知道：用户刚才的打断已经形成了新的有效回答，可以继续主流程了。
    this.lastAssistantMessageId = part.messageID
    if (!part.time?.end) return  // 消息未完成
    if (this.receiveState !== State.EXPECTING_NEXT_MESSAGE) return
    if (this.waitContext?.phase !== "waiting_assistant") return
    if (!this.isResumedAssistantMessage(part.messageID)) return

    // 助手响应到达，完成等待
    this.pendingInterruption = {
      roleName: this.currentRoleName,
      beforeMessage: this.pendingMessageContent,
      receivedMessage: part.text,
      timestamp: new Date(),
      reason: INTERRUPTION_REASON.rollback,
    }

    this.waitContext = null
    logFile.info(`[事件] 助手新消息(part): "${part.text.substring(0, 30)}..."`)
    if (this.interruptionCallback) {
      this.interruptionCallback(this.pendingInterruption)
    }
  }

  /**
   * 处理会话错误事件
   */
  private handleSessionError(props: SessionErrorProps | undefined): void {
    const error = props?.error
    if (!error) return

    const errorName = error.name
    if (errorName === "MessageAbortedError") {
      logFile.info(`[事件] ESC暂停 (MessageAbortedError)`)
      this.triggerInterruption({
        reason: INTERRUPTION_REASON.aborted,
        receivedMessage: error.data?.message ?? "用户按下了暂停键",
      })
    }
  }

  /**
   * 处理命令执行事件
   */
  private handleCommandExecute(props: CommandExecuteProps | undefined): void {
    const command = props?.command
    if (command === "session.interrupt" && this.receiveState !== State.IDLE) {
      logFile.info(`[事件] session.interrupt 命令`)
      this.receiveState = State.EXPECTING_NEXT_MESSAGE
      if (this.interruptionCallback) {
        this.interruptionCallback({
          roleName: this.currentRoleName,
          beforeMessage: this.pendingMessageContent,
          receivedMessage: "用户按下了暂停键",
          timestamp: new Date(),
          reason: INTERRUPTION_REASON.pause,
        })
      }
    }
  }

  /**
   * 判断是否为恢复的用户消息
   * 新消息ID必须与基准消息ID不同才算新消息
   */
  private isResumedUserMessage(messageId: string): boolean {
    if (!this.waitContext) return false
    if (this.waitContext.phase !== "waiting_user") return false
    return messageId !== this.waitContext.baselineUserMessageId
  }

  /**
   * 判断是否为恢复的Agent消息
   */
  private isResumedAssistantMessage(messageId: string): boolean {
    if (!this.waitContext) return false
    if (this.waitContext.phase !== "waiting_assistant") return false
    return messageId !== this.waitContext.baselineAssistantMessageId
  }

  /**
   * 触发中断
   * 设置中断状态并调用中断回调
   */
  private triggerInterruption(params: { reason: InterruptionReason; receivedMessage: string }): void {
    const { reason, receivedMessage } = params

    // 如果已经在等待下一次用户消息，再次 aborted 只表示"继续暂停并等待新的引导"。
    // 这时不能把状态切成 RECEIVED_INTERRUPTION，否则后续 new_message / rollback 就不会被识别。
    if (reason === INTERRUPTION_REASON.aborted && this.receiveState === State.EXPECTING_NEXT_MESSAGE) {
      logFile.info(`[中断] 等待阶段收到 aborted，继续等待下一次用户消息`)
      this.pendingInterruption = {
        roleName: this.currentRoleName,
        beforeMessage: this.pendingMessageContent,
        receivedMessage,
        timestamp: new Date(),
        reason,
      }
      if (this.waitContext?.phase === "waiting_assistant") {
        this.waitContext.phase = "waiting_user"
        this.waitContext.baselineUserMessageId = this.lastUserMessageId
        this.waitContext.resumedUserMessageId = null
      }
      return
    }

    this.receiveState = State.RECEIVED_INTERRUPTION
    consoleAndLogFile.infoC(LOG_COLOR.GREEN, `[中断] reason=${reason}`)

    this.pendingInterruption = {
      roleName: this.currentRoleName,
      beforeMessage: this.pendingMessageContent,
      receivedMessage,
      timestamp: new Date(),
      reason,
    }

    if (this.interruptionCallback) {
      this.interruptionCallback({
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
}
