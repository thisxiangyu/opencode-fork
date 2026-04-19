import type { Context, StrategyResult } from "../types/index.js"
import { NodeExecution } from "../graph/types.js"

/**
 * 强化学习状态
 * 描述智能体在某一时刻的状态
 */
export interface RLState {
  currentStrategy: string // 当前策略名称
  executionHistory: NodeExecution[] // 执行历史
  context: Context // 上下文信息
  metrics: {
    duration?: number // 持续时间
    tokenUsage?: number // Token使用量
    success?: boolean // 是否成功
  }
}

/**
 * 强化学习动作类型
 */
export type RLAction =
  | { type: "continue" } // 继续执行
  | { type: "retry"; strategy: string } // 重试指定策略
  | { type: "skip"; strategy: string } // 跳过指定策略
  | { type: "insert"; strategy: string } // 插入新策略
  | { type: "escalate" } // 升级处理

/**
 * 强化学习奖励结构
 * 包含即时奖励、延迟奖励和奖励塑造
 */
export interface RLReward {
  immediate: number // 即时奖励
  delayed: number // 延迟奖励
  shaping: number // 奖励塑造
}

/**
 * 回放缓冲区条目
 */
export interface ReplayBufferEntry {
  state: RLState // 状态
  action: RLAction // 动作
  reward: RLReward // 奖励
  nextState: RLState // 下一状态
  done: boolean // 是否结束
}

/**
 * 回放缓冲区
 * 用于存储和采样强化学习的经验样本
 */
export class ReplayBuffer {
  private buffer: ReplayBufferEntry[] = []
  private maxSize: number

  constructor(maxSize = 10000) {
    this.maxSize = maxSize
  }

  /**
   * 添加经验样本到缓冲区
   */
  push(entry: ReplayBufferEntry): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift()
    }
    this.buffer.push(entry)
  }

  /**
   * 随机采样一批经验
   */
  sample(batchSize: number): ReplayBufferEntry[] {
    const sampleSize = Math.min(batchSize, this.buffer.length)
    const shuffled = [...this.buffer]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]!]
    }
    return shuffled.slice(0, sampleSize)
  }

  /**
   * 获取缓冲区当前大小
   */
  size(): number {
    return this.buffer.length
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.buffer = []
  }
}

/**
 * 强化学习策略（Q-Learning）
 * 使用Q表存储状态-动作值函数
 * 采用epsilon-greedy探索策略
 */
export class RLPolicy {
  private qTable: Map<string, Map<string, number>> = new Map() // Q表
  private epsilon = 0.1 // 探索率

  /**
   * 选择动作（epsilon-greedy策略）
   * @param state 当前状态
   * @param availableActions 可用动作列表
   * @returns 选择的动作
   */
  selectAction(state: RLState, availableActions: RLAction[]): RLAction {
    // epsilon概率随机探索
    if (Math.random() < this.epsilon) {
      return availableActions[Math.floor(Math.random() * availableActions.length)] ?? { type: "continue" }
    }

    const stateKey = this.stateToKey(state)
    const stateQ = this.qTable.get(stateKey)

    if (!stateQ) {
      return availableActions[0] ?? { type: "continue" }
    }

    // 选择Q值最大的动作
    let bestAction = availableActions[0] ?? { type: "continue" }
    let bestValue = -Infinity

    for (const action of availableActions) {
      const actionKey = this.actionToKey(action)
      const value = stateQ.get(actionKey) ?? 0
      if (value > bestValue) {
        bestValue = value
        bestAction = action
      }
    }

    return bestAction
  }

  /**
   * 评估状态的价值
   * @param state 状态
   * @returns 状态价值（最大Q值）
   */
  evaluateState(state: RLState): number {
    const stateKey = this.stateToKey(state)
    const stateQ = this.qTable.get(stateKey)

    if (!stateQ || stateQ.size === 0) {
      return 0
    }

    return Math.max(...stateQ.values())
  }

  /**
   * 更新Q表
   * @param trajectory 轨迹数据
   */
  update(trajectory: Array<{ state: RLState; action: RLAction; reward: RLReward }>): void {
    for (let i = 0; i < trajectory.length; i++) {
      const { state, action, reward } = trajectory[i]!
      const stateKey = this.stateToKey(state)
      const actionKey = this.actionToKey(action)

      if (!this.qTable.has(stateKey)) {
        this.qTable.set(stateKey, new Map())
      }

      const stateQ = this.qTable.get(stateKey)!
      const currentQ = stateQ.get(actionKey) ?? 0

      const totalReward = reward.immediate + reward.delayed + reward.shaping

      // Q-Learning更新规则
      if (i < trajectory.length - 1) {
        const nextState = trajectory[i + 1]!.state
        const nextValue = this.evaluateState(nextState)
        stateQ.set(actionKey, currentQ + 0.1 * (totalReward + 0.9 * nextValue - currentQ))
      } else {
        stateQ.set(actionKey, currentQ + 0.1 * (totalReward - currentQ))
      }
    }
  }

  /**
   * 从回放缓冲区学习
   * @param batchSize 批量大小
   * @param replayBuffer 回放缓冲区
   * @returns 学习统计
   */
  learn(batchSize: number, replayBuffer: ReplayBuffer): { loss: number; samples: number } {
    if (replayBuffer.size() < batchSize) {
      return { loss: 0, samples: 0 }
    }

    const samples = replayBuffer.sample(batchSize)
    let totalLoss = 0

    for (const sample of samples) {
      const stateKey = this.stateToKey(sample.state)
      const actionKey = this.actionToKey(sample.action)

      if (!this.qTable.has(stateKey)) {
        this.qTable.set(stateKey, new Map())
      }

      const stateQ = this.qTable.get(stateKey)!
      const currentQ = stateQ.get(actionKey) ?? 0

      const target = sample.reward.immediate + sample.reward.delayed + sample.reward.shaping
      const tdError = target - currentQ
      totalLoss += Math.abs(tdError)

      stateQ.set(actionKey, currentQ + 0.1 * tdError)
    }

    return { loss: totalLoss / samples.length, samples: samples.length }
  }

  /**
   * 将状态转换为键
   */
  private stateToKey(state: RLState): string {
    return `${state.currentStrategy}:${state.context.cycle}:${Object.values(state.metrics).join(",")}`
  }

  /**
   * 将动作转换为键
   */
  private actionToKey(action: RLAction): string {
    return JSON.stringify(action)
  }
}
