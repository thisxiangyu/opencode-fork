/**
 * 优化类型枚举
 * 定义了可以优化的不同方面
 */
export type OptimizationType = "prompt" | "agent" | "order" | "structure" | "remove" | "add"
// prompt: 提示词优化
// agent: 智能体配置优化
// order: 执行顺序优化
// structure: 图结构优化
// remove: 移除节点/边
// add: 添加节点/边

/**
 * 优化建议结构
 * 包含对某个图进行优化的具体建议
 */
export interface OptimizationSuggestion {
  id: string // 建议唯一标识
  type: OptimizationType // 优化类型
  target: string // 优化目标（如图ID）
  current: unknown // 当前值
  suggested: unknown // 建议值
  confidence: number // 置信度 0-1
  reasoning: string // 推理过程
  expectedImprovement: {
    metric: string // 预期改善的指标
    delta: number // 预期变化量
  }
}

/**
 * 已应用的优化记录
 */
export interface AppliedOptimization {
  suggestionId: string // 对应的建议ID
  appliedAt: number // 应用时间戳
  previousValue: unknown // 优化前的值
  newValue: unknown // 优化后的值
}

/**
 * 策略优化器
 * 分析执行历史并生成优化建议
 * 支持自动应用高置信度的优化
 */
export class StrategyOptimizer {
  private history: AppliedOptimization[] = [] // 应用历史

  /**
   * 分析执行历史，生成优化建议
   * @param graphId 图ID
   * @param lookbackWindow 回看窗口大小
   * @param executionHistory 执行历史
   * @returns 优化建议列表
   */
  analyze(
    graphId: string,
    lookbackWindow: number,
    executionHistory: Array<{ metrics: unknown; prompt?: string }>,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = []

    const recent = executionHistory.slice(-lookbackWindow)

    // 检测高失败率情况
    const failures = recent.filter((e) => !(e as { success?: boolean }).success)
    if (failures.length > recent.length * 0.3) {
      suggestions.push({
        id: `opt-${Date.now()}-1`,
        type: "prompt",
        target: graphId,
        current: "current prompt",
        suggested: "improved prompt with better error handling",
        confidence: 0.7,
        reasoning: `High failure rate detected: ${((failures.length / recent.length) * 100).toFixed(1)}%`,
        expectedImprovement: { metric: "success_rate", delta: 0.15 },
      })
    }

    // 检测长执行时间情况
    const longExecutions = recent.filter((e) => {
      const duration = (e as { duration?: number }).duration
      return duration !== undefined && duration > 5000
    })
    if (longExecutions.length > recent.length * 0.5) {
      suggestions.push({
        id: `opt-${Date.now()}-2`,
        type: "structure",
        target: graphId,
        current: "linear flow",
        suggested: "parallel execution for independent nodes",
        confidence: 0.6,
        reasoning: "Many executions exceed 5s, parallelization may help",
        expectedImprovement: { metric: "duration", delta: -0.3 },
      })
    }

    return suggestions
  }

  /**
   * 自动应用优化
   * 只应用置信度高于阈值的建议
   * @param graphId 图ID
   * @param riskThreshold 风险阈值（置信度需高于此值才会应用）
   * @param suggestions 优化建议列表
   * @returns 已应用的优化列表
   */
  autoOptimize(graphId: string, riskThreshold: number, suggestions: OptimizationSuggestion[]): AppliedOptimization[] {
    const applied: AppliedOptimization[] = []

    for (const suggestion of suggestions) {
      if (suggestion.confidence >= riskThreshold) {
        applied.push({
          suggestionId: suggestion.id,
          appliedAt: Date.now(),
          previousValue: suggestion.current,
          newValue: suggestion.suggested,
        })
        this.history.push(applied[applied.length - 1])
      }
    }

    return applied
  }

  /**
   * 获取所有已应用的优化
   */
  getAppliedOptimizations(): ReadonlyArray<AppliedOptimization> {
    return this.history
  }

  /**
   * 回滚指定的优化
   * @param appliedId 已应用优化的ID
   * @returns 是否回滚成功
   */
  rollback(appliedId: string): boolean {
    const idx = this.history.findIndex((h) => h.suggestionId === appliedId)
    if (idx === -1) return false
    this.history.splice(idx, 1)
    return true
  }
}
