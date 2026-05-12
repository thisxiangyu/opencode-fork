/**
 * 会话接口定义
 * 抽象会话层行为，便于扩展不同的会话适配器
 *
 * ============================================================================
 * 【设计阐明】Role 与 Session 的关系
 * ============================================================================
 *
 * 一个 role 对应一个 currentSession 实例（IRole.currentSessionInstance），
 * 该 session 的 `role` 字段固定绑定为创建它的角色，
 * 为 sendMsg / compactHistory 等操作自动提供 agent/model 推导。
 *
 * 但一个 role 可能拥有多个历史 session，取决于策略设计。
 * 例如：
 *   - 规划者：整个循环复用同一个 session（长期记忆）
 *   - 执行者：每圈创建新 session（每次任务独立上下文）
 *   - 评估者：复用 session
 *
 * session.role 在创建时绑定，不允许运行时切换。
 * 如需"跨角色接管"，应创建新 session。
 */
import type { IRole } from "./role"
import type {
  InterruptedMsgContext,
  MessageReceiveState,
  SessionMessage,
  TokenUsageInfo,
} from "./types"

export interface ISession {
  /** 会话唯一标识符 */
  id: string

  /** 创建时绑定的角色，用于 sendMsg 自动推导 agent/model。不允许运行时切换 */
  role: IRole

  /** 工作路径 */
  directory: string

  /**
   * 设置中断回调
   * 当检测到会话中断时被调用
   */
  onInterruption(callback: (msg: InterruptedMsgContext) => void): void

  /**
   * 设置消息回调
   * 当收到新消息时被调用
   */
  onMessage(callback: (msg: SessionMessage) => void): void

  /**
   * 设置当前上下文
   * 在执行节点前调用
   */
  setCurrentContext(roleName: string): void

  /**
   * 获取当前接收状态
   */
  getReceiveState(): MessageReceiveState

  /**
   * 释放资源
   */
  disposeAsync(): Promise<void>

  /**
   * 向会话发送消息并等待响应
   *
   * agent 和 model 自动从 session.role 推导，无需调用方传入。
   *
   * @param message 要发送的消息
   * @param compactHistory 是否在发送前先压缩会话历史（默认 false）
   * @returns 模型的响应文本
   */
  sendMsg(message: SessionMessage, compactHistory?: boolean): Promise<string>

  /**
   * 等待中断
   * 阻塞等待直到收到中断信号或超时
   *
   * @param timeoutMs 超时时间（毫秒），0 表示无限等待
   * @returns 中断消息内容
   */
  waitForInterruption(timeoutMs?: number): Promise<string>

  /**
   * 清空中断状态
   * 重置所有中断相关状态
   *
   * 【作用】外部在处理完中断后调用, 避免中断状态残留，影响后续消息处理
   */
  clearInterruption(): void

  /**
   * 等待用户消息
   * 阻塞等待直到收到用户新消息
   *
   * @param timeoutMs 超时时间（毫秒）
   * @returns 用户消息内容
   */
  waitForUserMessage(timeoutMs?: number): Promise<string>

  /**
   * 获取消息历史
   * 返回所有已发送和接收的消息
   */
  getMessages(): Promise<SessionMessage[]>

  /**
   * 获取最近一次 LLM 调用的 token 用量
   *
   * 各后端适配器自行从对应事件/API 中捕获。
   * input 通常反映当前上下文窗口占用，与 compaction 触发阈值的判断依据一致。
   *
   * @returns 最近一次的 token 用量信息，尚未收到相关事件时返回 undefined
   */
  getTokenUsage(): TokenUsageInfo | undefined

  /**
   * 获取累计 token 用量。
   *
   * 因为一些后端（如 opencode server）可能存在自动压缩与标称不同的问题，
   * 有可能出现像 gpt-5.5 这样 100 万上下文的模型在 23 万就被压缩的问题，
   * 导致策略循环中的角色压缩阈值永远不被触发。所以这里用一个字段来维护
   * 一个更权威的 token 统计：自行累加每次 LLM 调用的 total；当 total 缺失时，
   * 用 input + output + reasoning + cache.read + cache.write 还原本轮总量。
   * 即使后端内部 compaction 让单轮上下文用量回落，该值仍持续累加。
   *
   * @returns 从会话创建以来的累计 token 数
   */
  getCumulativeTokens(): number

  /**
   * 获取由策略循环主动发起的压缩次数。
   *
   * 与后端自身的自动压缩无关，仅统计策略循环中 compactHistory=true 且实际
   * 压缩成功的次数。初始值为 0，每次策略主动压缩成功后递增。
   *
   * @returns 策略主动压缩次数
   */
  get主动压缩次数(): number

  /**
   * 递增主动压缩次数。
   * 由会话适配器在策略主动压缩成功后调用。
   */
  increment主动压缩次数(): void
}
