import { ExecutionTrace, StrategyResult } from "../types/index.js"
import { NodeExecution } from "../graph/types.js"
import { StrategyMetrics } from "./types.js"

/**
 * 归因分析结果
 * 描述某个策略对整体效果的贡献程度
 */
export interface AttributionAnalysis {
  strategyId: string // 策略ID
  contribution: number // 贡献度 0-1
  impact: "positive" | "negative" | "neutral" // 影响方向
  evidence: AttributionEvidence[] // 支持证据
}

/**
 * 归因证据类型
 * 支持相关性分析、消融研究和反事实推理三种方式
 */
export type AttributionEvidence =
  | { type: "correlation"; metric: string; coefficient: number } // 相关性证据
  | { type: "ablation"; withoutStrategy: StrategyMetrics; withStrategy: StrategyMetrics } // 消融研究证据
  | { type: "counterfactual"; alternativePath: string; comparison: StrategyMetrics } // 反事实推理证据

/**
 * 消融实验结果
 * 比较移除某个策略前后的指标差异
 */
export interface AblationResult {
  strategyId: string
  originalMetrics: StrategyMetrics // 原始指标
  ablatedMetrics: StrategyMetrics // 移除后的指标
  delta: StrategyMetrics // 差异
}

/**
 * 归因分析器
 * 通过多种统计方法分析各个策略对最终效果的贡献
 * 支持相关性分析、消融实验和反事实推理
 */
export class AttributionAnalyzer {
  /**
   * 分析执行轨迹中各策略的贡献度
   * @param trace 执行轨迹
   * @param targetMetric 目标指标类型
   * @returns 归因分析结果列表，按贡献度降序排列
   */
  analyze(trace: ExecutionTrace, targetMetric: keyof StrategyMetrics = "quality"): AttributionAnalysis[] {
    const analyses: AttributionAnalysis[] = []
    const nodeMetrics = trace.nodes.map((n) => this.extractNodeMetrics(n))

    const metricsRecord: Record<string, number> = {
      totalDuration: trace.metrics.totalDuration,
      tokenUsage: trace.metrics.tokenUsage,
      stepCount: trace.metrics.stepCount,
      retryCount: trace.metrics.retryCount,
      success: trace.metrics.success ? 1 : 0,
    }
    const correlations = this.calculateCorrelations(nodeMetrics, metricsRecord)

    // 计算每个节点的相关性和贡献度
    for (const node of trace.nodes) {
      const correlation = correlations.get(node.nodeId) ?? 0
      let contribution = 0
      let impact: "positive" | "negative" | "neutral" = "neutral"

      if (correlation > 0.3) {
        contribution = correlation
        impact = "positive"
      } else if (correlation < -0.3) {
        contribution = Math.abs(correlation)
        impact = "negative"
      }

      analyses.push({
        strategyId: node.nodeId,
        contribution,
        impact,
        evidence: [{ type: "correlation", metric: targetMetric as string, coefficient: correlation }],
      })
    }

    return analyses.sort((a, b) => b.contribution - a.contribution)
  }

  /**
   * 执行消融实验
   * 比较有无特定策略时的指标差异
   * @param graphId 图ID
   * @param strategyId 策略ID
   * @param baselineTrace 基线轨迹
   * @param alternativeTrace 替代轨迹
   * @returns 消融实验结果
   */
  async ablationStudy(
    graphId: string,
    strategyId: string,
    baselineTrace: ExecutionTrace,
    alternativeTrace: ExecutionTrace,
  ): Promise<AblationResult> {
    const baselineMetrics = this.calculateNodeMetrics(baselineTrace.nodes.find((n) => n.nodeId === strategyId))
    const ablatedMetrics = this.calculateNodeMetrics(alternativeTrace.nodes.find((n) => n.nodeId === strategyId))

    return {
      strategyId,
      originalMetrics: baselineMetrics,
      ablatedMetrics: ablatedMetrics,
      delta: this.subtractMetrics(baselineMetrics, ablatedMetrics),
    }
  }

  /**
   * 找出关键路径
   * 即对效率指标有正向贡献的策略节点
   * @param trace 执行轨迹
   * @returns 关键路径上的策略ID列表
   */
  criticalPath(trace: ExecutionTrace): string[] {
    const analyses = this.analyze(trace, "efficiency")
    return analyses.filter((a) => a.impact === "positive").map((a) => a.strategyId)
  }

  /**
   * 从节点执行记录中提取指标
   */
  private extractNodeMetrics(node: NodeExecution): Record<string, number> {
    return {
      duration: (node.endTime ?? 0) - node.startTime,
      success: node.state === "pass" ? 1 : 0,
      error: node.error ? 1 : 0,
    }
  }

  /**
   * 计算节点的策略指标
   */
  private calculateNodeMetrics(node?: NodeExecution): StrategyMetrics {
    if (!node) {
      return {
        efficiency: { duration: 0, tokenUsage: 0, stepCount: 0, retryCount: 0 },
        quality: { success: 0, testPassRate: 0, codeCoverage: 0, lintScore: 0, complexityScore: 0 },
        stability: { consistency: 0, errorRate: 0, recoveryRate: 0 },
        satisfaction: { explanationQuality: 0 },
      }
    }

    return {
      efficiency: {
        duration: (node.endTime ?? 0) - node.startTime,
        tokenUsage: (node.result?.["tokenUsage"] as number) ?? 0,
        stepCount: 1,
        retryCount: (node.result?.["retryCount"] as number) ?? 0,
      },
      quality: {
        success: node.state === "pass" ? 1 : 0,
        testPassRate: (node.result?.["testPassRate"] as number) ?? 0,
        codeCoverage: 0,
        lintScore: 0,
        complexityScore: 0,
      },
      stability: {
        consistency: node.state === "pass" ? 1 : 0,
        errorRate: node.error ? 1 : 0,
        recoveryRate: 0,
      },
      satisfaction: {
        explanationQuality: (node.result?.["explanationQuality"] as number) ?? 0,
      },
    }
  }

  /**
   * 计算节点指标和整体指标的相关性
   */
  private calculateCorrelations(
    nodeMetrics: Record<string, number>[],
    traceMetrics: Record<string, number>,
  ): Map<string, number> {
    const correlations = new Map<string, number>()
    const traceValues = Object.values(traceMetrics)

    const avgTrace = traceValues.reduce((a, b) => a + b, 0) / Math.max(traceValues.length, 1)

    for (const nodeMetric of nodeMetrics) {
      for (const [key, value] of Object.entries(nodeMetric)) {
        const correlation = this.pearsonCorrelation([value], [avgTrace])
        correlations.set(key, correlation)
      }
    }

    return correlations
  }

  /**
   * 计算皮尔逊相关系数
   */
  private pearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0

    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = y.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0)
    const sumX2 = x.reduce((a, b) => a + b * b, 0)
    const sumY2 = y.reduce((a, b) => a + b * b, 0)

    const n = x.length
    const numerator = n * sumXY - sumX * sumY
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

    return denominator === 0 ? 0 : numerator / denominator
  }

  /**
   * 计算两个指标集合的差异
   */
  private subtractMetrics(a: StrategyMetrics, b: StrategyMetrics): StrategyMetrics {
    return {
      efficiency: {
        duration: a.efficiency.duration - b.efficiency.duration,
        tokenUsage: a.efficiency.tokenUsage - b.efficiency.tokenUsage,
        stepCount: a.efficiency.stepCount - b.efficiency.stepCount,
        retryCount: a.efficiency.retryCount - b.efficiency.retryCount,
      },
      quality: {
        success: a.quality.success !== b.quality.success ? 1 : 0,
        testPassRate: a.quality.testPassRate - b.quality.testPassRate,
        codeCoverage: a.quality.codeCoverage - b.quality.codeCoverage,
        lintScore: a.quality.lintScore - b.quality.lintScore,
        complexityScore: a.quality.complexityScore - b.quality.complexityScore,
      },
      stability: {
        consistency: a.stability.consistency - b.stability.consistency,
        errorRate: a.stability.errorRate - b.stability.errorRate,
        recoveryRate: a.stability.recoveryRate - b.stability.recoveryRate,
      },
      satisfaction: {
        userRating: (a.satisfaction.userRating ?? 0) - (b.satisfaction.userRating ?? 0),
        reviewerScore: (a.satisfaction.reviewerScore ?? 0) - (b.satisfaction.reviewerScore ?? 0),
        explanationQuality: a.satisfaction.explanationQuality - b.satisfaction.explanationQuality,
      },
    }
  }
}
