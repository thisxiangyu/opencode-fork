import type { Context, StrategyResult, StepEnhancement } from "../types/index.js"
import { CircuitBreaker, type CircuitState, type CircuitBreakerConfig } from "./CircuitBreaker.js"
import { RATE_LIMITER_WINDOW } from "../constants.js"

/**
 * 路由动作类型
 * 定义了路由系统可以执行的各种动作
 */
export type RoutingActionType =
  | "continue" // 继续执行当前流程
  | "goto" // 跳转到指定节点
  | "fork" // 分叉执行多个分支
  | "retry" // 重试当前策略
  | "skip" // 跳过当前策略
  | "escalate" // 升级处理
  | "abort" // 中止执行
  | "rewrite_graph" // 重写图结构

/**
 * 路由动作结构
 * 包含动作类型及相关的执行参数
 */
export interface RoutingAction {
  type: RoutingActionType // 动作类型
  target?: string // 目标节点ID（用于goto）
  targets?: string[] // 目标节点列表（用于fork）
  maxAttempts?: number // 最大重试次数
  backoff?: "linear" | "exponential" // 重试退避策略
  reason?: string // 动作原因说明
  modifications?: unknown[] // 图结构修改列表
}

/**
 * 路由规则结构
 * 定义了触发条件和对应的路由动作
 */
export interface RoutingRule {
  id: string // 规则唯一标识
  name: string // 规则名称
  condition: (ctx: Context, lastResult: StrategyResult | null) => boolean // 触发条件
  action: RoutingAction // 匹配后执行的动作
  priority: number // 优先级，数值越大优先级越高
  enabled?: boolean // 规则是否启用
}

/**
 * 路由决策结果
 * 包含最终选择的动作和匹配的规则信息
 */
export interface AdaptiveRouterDecision {
  action: RoutingAction
  matchedRule: string | null
  enhancement?: StepEnhancement
}

/**
 * 限流器配置
 */
export interface RateLimiterConfig {
  maxRequests: number // 时间窗口内的最大请求数
  windowMs: number // 时间窗口大小（毫秒）
}

/**
 * 路由指标
 */
export interface RouterMetrics {
  totalEvaluations: number
  ruleMatches: Map<string, number>
  circuitState: CircuitState
  rateLimitRemaining: number
  avgDecisionTime: number
}

/**
 * 自适应路由系统
 * 基于规则引擎的动态路由选择器
 * 根据执行上下文和结果自动决定下一步行动
 * 支持熔断器和限流器
 */
export class AdaptiveRouter {
  private rules: RoutingRule[] = []
  private history: Array<{ context: Context; decision: AdaptiveRouterDecision }> = []
  private circuitBreaker: CircuitBreaker
  private rateLimiter: {
    requests: number[]
    config: RateLimiterConfig
  }
  private metrics: {
    totalEvaluations: number
    ruleMatches: Map<string, number>
    decisionTimes: number[]
  }

  constructor(rules: RoutingRule[] = []) {
    this.rules = [...rules]
    this.rules.sort((a, b) => b.priority - a.priority)
    this.circuitBreaker = new CircuitBreaker()
    this.rateLimiter = {
      requests: [],
      config: {
        maxRequests: 100,
        windowMs: RATE_LIMITER_WINDOW,
      },
    }
    this.metrics = {
      totalEvaluations: 0,
      ruleMatches: new Map(),
      decisionTimes: [],
    }
  }

  /**
   * 添加路由规则
   * @param rule 要添加的路由规则
   */
  addRule(rule: RoutingRule): void {
    this.rules.push({ ...rule, enabled: rule.enabled ?? true })
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  /**
   * 批量添加路由规则
   */
  addRules(rules: RoutingRule[]): void {
    for (const rule of rules) {
      this.addRule(rule)
    }
  }

  /**
   * 移除路由规则
   * @param id 要移除的规则ID
   * @returns 是否移除成功
   */
  removeRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id)
    if (idx === -1) return false
    this.rules.splice(idx, 1)
    return true
  }

  /**
   * 启用或禁用路由规则
   */
  setRuleEnabled(id: string, enabled: boolean): boolean {
    const rule = this.rules.find((r) => r.id === id)
    if (!rule) return false
    rule.enabled = enabled
    return true
  }

  /**
   * 获取所有路由规则
   */
  getRules(): RoutingRule[] {
    return [...this.rules]
  }

  /**
   * 检查熔断器状态
   */
  isCircuitOpen(): boolean {
    return this.circuitBreaker.isOpen()
  }

  /**
   * 检查限流
   */
  isRateLimited(): boolean {
    const now = Date.now()
    const windowStart = now - this.rateLimiter.config.windowMs

    this.rateLimiter.requests = this.rateLimiter.requests.filter((t) => t > windowStart)

    return this.rateLimiter.requests.length >= this.rateLimiter.config.maxRequests
  }

  /**
   * 获取剩余可用请求数
   */
  getRateLimitRemaining(): number {
    const now = Date.now()
    const windowStart = now - this.rateLimiter.config.windowMs

    this.rateLimiter.requests = this.rateLimiter.requests.filter((t) => t > windowStart)

    return Math.max(0, this.rateLimiter.config.maxRequests - this.rateLimiter.requests.length)
  }

  /**
   * 记录熔断器成功
   */
  recordSuccess(): void {
    this.circuitBreaker.recordSuccess()
  }

  /**
   * 记录熔断器失败
   */
  recordFailure(): void {
    this.circuitBreaker.recordFailure()
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset()
  }

  /**
   * 设置熔断器配置
   */
  setCircuitBreakerConfig(config: Partial<CircuitBreakerConfig>): void {
    this.circuitBreaker.setConfig(config)
  }

  /**
   * 设置限流器配置
   */
  setRateLimiterConfig(config: Partial<RateLimiterConfig>): void {
    this.rateLimiter.config = { ...this.rateLimiter.config, ...config }
  }

  private checkCircuitBreaker(): AdaptiveRouterDecision | null {
    if (this.isCircuitOpen()) {
      return {
        action: { type: "abort", reason: "Circuit breaker is open" },
        matchedRule: null,
      }
    }
    return null
  }

  private checkRateLimit(): AdaptiveRouterDecision | null {
    if (this.isRateLimited()) {
      return {
        action: { type: "continue", reason: "Rate limited, continuing with reduced functionality" },
        matchedRule: null,
      }
    }
    return null
  }

  private recordMetrics(startTime: number): void {
    const elapsed = Date.now() - startTime
    this.metrics.decisionTimes.push(elapsed)
    if (this.metrics.decisionTimes.length > 100) {
      this.metrics.decisionTimes.shift()
    }
  }

  private evaluateRules(
    ctx: Context,
    lastResult: StrategyResult | null,
    startTime: number,
  ): AdaptiveRouterDecision | null {
    for (const rule of this.rules) {
      if (!rule.enabled) continue

      try {
        if (rule.condition(ctx, lastResult)) {
          const decision: AdaptiveRouterDecision = {
            action: rule.action,
            matchedRule: rule.id,
          }

          this.history.push({ context: ctx, decision })
          this.metrics.totalEvaluations++
          this.metrics.ruleMatches.set(rule.id, (this.metrics.ruleMatches.get(rule.id) ?? 0) + 1)
          this.recordMetrics(startTime)

          if (rule.action.type === "abort" || rule.action.type === "escalate") {
            this.recordFailure()
          } else if (rule.action.type === "continue") {
            this.recordSuccess()
          }

          return decision
        }
      } catch (err) {
        console.warn(`[Router] Rule ${rule.id} condition evaluation failed:`, err)
        continue
      }
    }
    return null
  }

  /**
   * 评估当前上下文和结果，返回路由决策
   * 按优先级顺序检查规则条件，匹配第一个成功的规则
   * @param ctx 当前执行上下文
   * @param lastResult 上一个策略的执行结果
   * @returns 路由决策结果
   */
  evaluate(ctx: Context, lastResult: StrategyResult | null): AdaptiveRouterDecision {
    const startTime = Date.now()

    const circuitDecision = this.checkCircuitBreaker()
    if (circuitDecision) return circuitDecision

    const rateLimitDecision = this.checkRateLimit()
    if (rateLimitDecision) return rateLimitDecision

    this.rateLimiter.requests.push(Date.now())

    const ruleDecision = this.evaluateRules(ctx, lastResult, startTime)
    if (ruleDecision) return ruleDecision

    this.recordSuccess()
    this.metrics.totalEvaluations++
    this.recordMetrics(startTime)

    return {
      action: { type: "continue" },
      matchedRule: null,
    }
  }

  /**
   * 获取路由指标
   */
  getMetrics(): RouterMetrics {
    const avgDecisionTime =
      this.metrics.decisionTimes.length > 0
        ? this.metrics.decisionTimes.reduce((a, b) => a + b, 0) / this.metrics.decisionTimes.length
        : 0

    return {
      totalEvaluations: this.metrics.totalEvaluations,
      ruleMatches: new Map(this.metrics.ruleMatches),
      circuitState: this.circuitBreaker.getState(),
      rateLimitRemaining: this.getRateLimitRemaining(),
      avgDecisionTime,
    }
  }

  /**
   * 重置指标
   */
  resetMetrics(): void {
    this.metrics = {
      totalEvaluations: 0,
      ruleMatches: new Map(),
      decisionTimes: [],
    }
  }

  /**
   * 获取路由历史记录
   */
  getHistory(): ReadonlyArray<{ context: Context; decision: AdaptiveRouterDecision }> {
    return this.history
  }

  /**
   * 清空路由历史
   */
  clearHistory(): void {
    this.history = []
  }
}

/**
 * 默认路由规则集
 * 包含常见的路由处理规则
 */
export const DefaultRoutingRules: RoutingRule[] = [
  {
    id: "test-failure",
    name: "测试失败处理",
    condition: (ctx, result) => ctx["currentStrategy"] === "tester" && result?.["passed"] === false,
    action: { type: "retry", target: "executor", maxAttempts: 3, backoff: "exponential" },
    priority: 100,
  },
  {
    id: "reviewer-reject",
    name: "审核员拒绝",
    condition: (ctx, result) => ctx["currentStrategy"] === "reviewer" && result?.["passed"] === false,
    action: { type: "goto", target: "planner" },
    priority: 95,
  },
  {
    id: "ue-reject",
    name: "UE拒绝",
    condition: (ctx, result) => ctx["currentStrategy"] === "ue" && result?.["approved"] === false,
    action: { type: "goto", target: "planner" },
    priority: 95,
  },
  {
    id: "high-error-rate",
    name: "错误率过高",
    condition: (ctx) => typeof ctx["errorRate"] === "number" && ctx["errorRate"] > 0.5,
    action: { type: "escalate", reason: "错误率超过50%" },
    priority: 90,
  },
  {
    id: "low-confidence",
    name: "置信度低",
    condition: (ctx, result) => typeof result?.["confidence"] === "number" && result["confidence"] < 0.6,
    action: { type: "fork", targets: ["reviewer", "alternative-executor"] },
    priority: 80,
  },
]
