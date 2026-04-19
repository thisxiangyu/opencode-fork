import type { Context, StrategyResult, ExecutionTrace } from "../types/index.js"
import { NodeExecution } from "../graph/types.js"

/**
 * 显式反馈结构
 * 由用户、审核员或测试明确给出的反馈
 */
export interface ExplicitFeedback {
  type: "rating" | "correction" | "preference" // 反馈类型：评分、纠正、偏好
  source: "user" | "reviewer" | "test" // 反馈来源
  target: { graphId?: string; strategyId?: string; executionId?: string } // 反馈目标
  value: unknown // 反馈值
  timestamp: number // 时间戳
  context: Context // 反馈时的上下文
}

/**
 * 隐式反馈结构
 * 从执行轨迹和结果中推断出的反馈
 */
export interface ImplicitFeedback {
  type: "success" | "failure" | "retry" | "escalation" | "abandon" // 反馈类型
  inferredQuality: number // 推断的质量分数 0-1
  evidence: string // 支持证据
}

/**
 * 环境反馈结构
 * 关于系统环境或指标的反馈
 */
export interface EnvironmentalFeedback {
  metric: string // 指标名称
  value: number // 当前值
  baseline: number // 基线值
  deviation: number // 偏差
}

/**
 * 反馈集合
 * 包含三种类型的反馈
 */
export interface FeedbackCollection {
  explicit: ExplicitFeedback[] // 显式反馈
  implicit: ImplicitFeedback[] // 隐式反馈
  environmental: EnvironmentalFeedback[] // 环境反馈
}

/**
 * 反馈收集器
 * 负责收集和存储各种类型的反馈
 * 支持显式反馈（用户主动提供）和隐式反馈（从执行轨迹推断）
 */
export class FeedbackCollector {
  private explicitFeedback: ExplicitFeedback[] = []
  private implicitFeedback: ImplicitFeedback[] = []
  private environmentalFeedback: EnvironmentalFeedback[] = []

  /**
   * 从执行轨迹收集反馈
   * 自动推断隐式反馈
   * @param trace 执行轨迹
   * @param result 执行结果
   * @returns 收集到的所有反馈
   */
  collectFromExecution(trace: ExecutionTrace, result: StrategyResult): FeedbackCollection {
    const implicit = this.inferImplicitFeedback(trace, result)

    this.implicitFeedback.push(...implicit)

    return {
      explicit: [...this.explicitFeedback],
      implicit: [...this.implicitFeedback],
      environmental: [...this.environmentalFeedback],
    }
  }

  /**
   * 收集显式反馈
   * @param feedback 显式反馈
   */
  collectExplicit(feedback: ExplicitFeedback): void {
    this.explicitFeedback.push({ ...feedback, timestamp: Date.now() })
  }

  /**
   * 添加环境反馈
   * @param feedback 环境反馈
   */
  addEnvironmentalFeedback(feedback: EnvironmentalFeedback): void {
    this.environmentalFeedback.push(feedback)
  }

  /**
   * 获取所有显式反馈
   */
  getExplicitFeedback(): ReadonlyArray<ExplicitFeedback> {
    return this.explicitFeedback
  }

  /**
   * 获取所有隐式反馈
   */
  getImplicitFeedback(): ReadonlyArray<ImplicitFeedback> {
    return this.implicitFeedback
  }

  /**
   * 获取所有环境反馈
   */
  getEnvironmentalFeedback(): ReadonlyArray<EnvironmentalFeedback> {
    return this.environmentalFeedback
  }

  /**
   * 清空所有反馈
   */
  clear(): void {
    this.explicitFeedback = []
    this.implicitFeedback = []
    this.environmentalFeedback = []
  }

  /**
   * 从执行轨迹推断隐式反馈
   * 分析节点状态和结果来判断执行质量
   * @param trace 执行轨迹
   * @param result 执行结果
   * @returns 推断出的隐式反馈列表
   */
  private inferImplicitFeedback(trace: ExecutionTrace, result: StrategyResult): ImplicitFeedback[] {
    const feedbacks: ImplicitFeedback[] = []

    // 检查是否有错误
    const hasErrors = trace.nodes.some((n) => (n as { error?: string }).error !== undefined)
    if (hasErrors) {
      feedbacks.push({
        type: "failure",
        inferredQuality: 0.3,
        evidence: "Execution contained errors",
      })
    }

    // 检查是否所有节点都通过
    const allPassed = trace.nodes.every((n) => n.state === "pass")
    if (allPassed && trace.nodes.length > 0) {
      feedbacks.push({
        type: "success",
        inferredQuality: 0.9,
        evidence: "All nodes passed",
      })
    }

    // 检查是否有重试
    const hasRetries = trace.nodes.some((n) => (n.result?.["retryCount"] as number) > 0)
    if (hasRetries) {
      feedbacks.push({
        type: "retry",
        inferredQuality: 0.5,
        evidence: "Retries were performed",
      })
    }

    return feedbacks
  }
}
