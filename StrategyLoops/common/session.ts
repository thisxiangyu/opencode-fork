/**
 * 会话接口定义
 * 抽象会话层行为，便于扩展不同的会话适配器
 */
import type {
  InterruptedMessage,
  MessageReceiveState,
  SessionMessage,
} from "./types"

export interface ISession {
  /** 会话唯一标识符 */
  id: string

  /**
   * 设置中断回调
   * 当检测到会话中断时被调用
   */
  onInterruption(callback: (msg: InterruptedMessage) => void): void

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
   * @param message 要发送的消息
   * @param agent 指定使用的 agent（可选）
   * @param model 指定使用的模型（可选，格式：{ providerID, modelID }）
   * @returns 模型的响应文本
   */
  sendMsg(message: SessionMessage, agent?: string, model?: { providerID: string; modelID: string }): Promise<string>

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
}