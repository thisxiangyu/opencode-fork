/**
 * OpenCode 会话适配器类型定义
 * 本文件定义了会话管理、消息处理和中断相关的核心类型
 */

/**
 * 中断原因类型
 * 描述导致会话中断的具体原因
 *
 * - pause: 用户主动暂停
 * - rollback: 需要回滚到之前的状态
 * - new_message: 收到了新消息
 * - aborted: 用户打断了消息
 */
export const INTERRUPTION_REASON = {
  pause: "pause",
  rollback: "rollback",
  new_message: "new_message",
  aborted: "aborted",
} as const

export type InterruptionReason = (typeof INTERRUPTION_REASON)[keyof typeof INTERRUPTION_REASON]

/**
 * StrategyLoops 发给会话层的消息来源。
 *
 * 注意：这里是 SL 自己的语义层，不是 OpenCode 原始消息里的 role 字段。
 * - system: SL 主动下发的系统提示
 * - agent: 模型返回给 SL 的回答
 * - user: 真实用户从 WebUI/TUI 发来的消息
 */
export const MSG_SOURCE = {
  system: "system",
  agent: "agent",
  user: "user",
} as const

export type MsgSource = (typeof MSG_SOURCE)[keyof typeof MSG_SOURCE]

export interface SessionMessage {
  msgSource: MsgSource
  content: string
}

/**
 * 中断消息上下文
 * 当会话发生中断时，传递给回调函数的消息对象
 *
 * 【作用】提供了完整的中断上下文信息，包括：
 * - 中断发生在哪个节点/角色
 * - 中断前后的消息内容
 * - 中断发生的时间戳
 * - 中断的具体原因
 *
 * 【没有会怎样】无法追踪中断的来源和原因，
 * 上层逻辑无法区分不同类型的中断并做出相应处理
 */
export interface InterruptedMsgContext {

  /** 当前正在执行的角色名称 */
  roleName: string

  /** 中断发生前最近的消息内容，用于回滚参考 */
  beforeMessage: string

  /** 导致中断的新消息内容 */
  receivedMessage: string

  /** 中断发生的时间戳 */
  timestamp: Date

  /** 中断原因，标识中断是如何触发的 */
  reason: InterruptionReason
}

/**
 * 消息接收状态枚举
 * 描述当前会话接收消息的状态机状态
 *
 * 【作用】通过状态机管理消息流程，避免重复处理或状态混乱：
 * - IDLE: 空闲状态，可接受新消息
 * - WAITING_PROMPT_RESPONSE: 等待 prompt 响应
 * - EXPECTING_NEXT_MESSAGE: 期待下一条消息（如等待用户输入下一条消息）
 * - RECEIVED_INTERRUPTION: 已收到中断信号
 *
 * 【没有会怎样】无法区分当前所处阶段，
 * 可能导致消息处理逻辑混乱，例如在等待响应时重复发送消息
 */
export enum MessageReceiveState {
  /** 空闲状态 - 会话初始状态，可以接受新消息 */
  IDLE = "IDLE",
  /** 等待prompt响应 - 已发送消息，正在等待模型回复 */
  WAITING_PROMPT_RESPONSE = "WAITING_PROMPT_RESPONSE",
  /** 期待下一条消息 - 等待用户输入或新消息 */
  EXPECTING_NEXT_MESSAGE = "EXPECTING_NEXT_MESSAGE",
  /** 已收到中断 - 检测到中断信号，等待处理 */
  RECEIVED_INTERRUPTION = "RECEIVED_INTERRUPTION",
}

/**
 * 等待阶段类型
 * 描述在 EXPECTING_NEXT_MESSAGE 状态下正在等待什么
 *
 * - waiting_user: 等待用户输入新消息
 * - waiting_assistant: 等待助手/模型的响应
 */
export type WaitPhase = "waiting_user" | "waiting_assistant"

/**
 * 等待上下文
 * 在等待消息期间维护的基线信息，用于判断是否收到新消息
 *
 * 【作用】记录等待开始时的基准点：
 * - 区分"新消息"和"旧消息的更新"
 * - 追踪等待开始时间，用于超时判断
 * - 支持 assistant 响应后继续等待 user 确认的场景
 *
 * 【没有会怎样】无法判断收到的消息是否是新的，
 * 可能在等待 user 消息时把旧的 part.updated 事件当作新消息处理
 */
export interface WaitContext {
  /** 当前等待阶段，区分等待 user 还是 assistant */
  phase: WaitPhase
  /** 等待开始的时间戳，用于计算超时 */
  startedAt: number
  /** 等待开始前最后一条 user 消息ID，新消息必须与此不同才算新 */
  baselineUserMessageId: string | null
  /** 等待开始前最后一条 assistant 消息ID */
  baselineAssistantMessageId: string | null
  /** 恢复的用户消息ID，记录实际收到的新消息 */
  resumedUserMessageId: string | null
}

/**
 * 一次主动发送开始前的消息基线。
 *
 * 当本次发送被 aborted 时，后续 waitForUserMessage 必须基于这组基线判断
 * 什么才叫"新的用户引导"，而不是用进入等待函数那一刻已经被污染的 lastUserMessageId。
 */
export interface SendBaseline {
  userMessageId: string | null
  assistantMessageId: string | null
}

/**
 * 中断错误类
 * 当用户按下 ESC 键或主动中止会话时抛出的特殊错误
 *
 * 【作用】提供明确的错误类型标识，
 * 上层可通过 instanceof AbortError 判断是否为中止操作
 *
 * 【没有会怎样】无法区分用户中止和其他错误，
 * 可能把中止当作普通错误处理，导致用户体验不佳
 */
export class AbortError extends Error {
  constructor() {
    super("Session aborted by user (ESC)")
    this.name = "AbortError"
  }
}

/**
 * 最近一次 LLM 调用的 token 用量信息
 *
 * 各字段按后端能力可能缺失（为空），消费方应做空值兜底。
 * input 通常反映当前上下文窗口的 token 占用量，
 * 可用于判断是否接近上下文上限、是否需要触发压缩。
 */
export interface TokenUsageInfo {
  /** AI SDK 返回的 total_tokens */
  total?: number
  /** 输入 token（通常已剔除缓存） */
  input?: number
  /** 输出 token（通常已剔除推理 token） */
  output?: number
  /** 思维链/推理 token */
  reasoning?: number
  /** 缓存读写 token */
  cache?: {
    read?: number
    write?: number
  }
  /** 本次调用成本（美元） */
  cost?: number
}
