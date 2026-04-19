import { StrategyResult, Context } from "../types/index.js"

/**
 * 效率指标
 */
export interface EfficiencyMetrics {
  duration: number // 执行持续时间（毫秒）
  tokenUsage: number // Token使用量
  stepCount: number // 执行步数
  retryCount: number // 重试次数
}

/**
 * 质量指标
 */
export interface QualityMetrics {
  success: number // 成功率 0-1
  testPassRate: number // 测试通过率 0-1
  codeCoverage: number // 代码覆盖率 0-1
  lintScore: number // 代码整洁度评分
  complexityScore: number // 复杂度评分
}

/**
 * 稳定性指标
 */
export interface StabilityMetrics {
  consistency: number // 一致性 0-1
  errorRate: number // 错误率 0-1
  recoveryRate: number // 恢复率 0-1
}

/**
 * 满意度指标
 */
export interface SatisfactionMetrics {
  userRating?: number // 用户评分
  reviewerScore?: number // 审核员评分
  explanationQuality: number // 解释质量
}

/**
 * 策略综合指标
 */
export interface StrategyMetrics {
  efficiency: EfficiencyMetrics // 效率指标
  quality: QualityMetrics // 质量指标
  stability: StabilityMetrics // 稳定性指标
  satisfaction: SatisfactionMetrics // 满意度指标
}

/**
 * 评估标准
 */
export interface EvaluationCriterion {
  name: string // 标准名称
  weight: number // 权重
  evaluator: (result: StrategyResult, expected?: StrategyResult) => number // 评估函数
}

/**
 * 基准测试用例
 */
export interface BenchmarkCase {
  id: string // 用例唯一标识
  name: string // 用例名称
  description: string // 用例描述
  task: string // 任务描述
  expectedOutput?: StrategyResult // 期望输出
  evaluationCriteria: EvaluationCriterion[] // 评估标准列表
  difficulty: "easy" | "medium" | "hard" | "expert" // 难度级别
  tags: string[] // 标签
}

/**
 * 基准测试结果
 */
export interface BenchmarkResult {
  caseId: string // 用例ID
  graphId: string // 图ID
  timestamp: number // 时间戳
  iterations: number // 迭代次数
  metrics: StrategyMetrics // 指标
  rawResults: StrategyResult[] // 原始结果列表
  failures: Array<{ iteration: number; error: Error }> // 失败记录
  statistics: {
    mean: number // 平均值
    median: number // 中位数
    stdDev: number // 标准差
    p95: number // 95百分位数
    p99: number // 99百分位数
  }
}

/**
 * 基准测试套件结果
 */
export interface BenchmarkSuiteResult {
  suiteName: string // 套件名称
  totalCases: number // 总用例数
  passedCases: number // 通过用例数
  failedCases: number // 失败用例数
  results: BenchmarkResult[] // 结果列表
  summary: {
    totalDuration: number // 总持续时间
    averageMetrics: StrategyMetrics // 平均指标
  }
}

/**
 * 对比结果
 */
export interface ComparisonResult {
  graphA: string // 图A ID
  graphB: string // 图B ID
  testCases: string[] // 测试用例ID列表
  winner?: string // 获胜者
  scoreDiff: number // 得分差异
  details: Array<{
    caseId: string // 用例ID
    scoreA: number // 图A得分
    scoreB: number // 图B得分
    improvement: number // 改进幅度
  }>
}

/**
 * 回归报告
 */
export interface RegressionReport {
  currentGraph: string // 当前图ID
  baselineGraph: string // 基线图ID
  threshold: number // 阈值
  hasDegradation: boolean // 是否有性能下降
  affectedCases: string[] // 受影响的用例
  recommendations: string[] // 建议
}

/**
 * 计算统计值
 * 计算输入数值数组的描述性统计指标，包括均值、中位数、标准差和百分位数
 * @param values 数值数组
 * @returns 包含以下属性的统计结果对象：
 *   - mean: 算术平均值
 *   - median: 中位数（50百分位数）
 *   - stdDev: 标准差，衡量数值的离散程度
 *   - p95: 95百分位数，表示95%的数值低于此值
 *   - p99: 99百分位数，表示99%的数值低于此值
 */
export function calculateStatistics(values: number[]): {
  mean: number
  median: number
  stdDev: number
  p95: number
  p99: number
} {
  if (values.length === 0) {
    return { mean: 0, median: 0, stdDev: 0, p95: 0, p99: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const median = sorted[Math.floor(sorted.length / 2)]

  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2))
  const stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length)

  const p95Index = Math.floor(sorted.length * 0.95)
  const p99Index = Math.floor(sorted.length * 0.99)

  return {
    mean,
    median,
    stdDev,
    p95: sorted[p95Index] ?? sorted[sorted.length - 1],
    p99: sorted[p99Index] ?? sorted[sorted.length - 1],
  }
}

/**
 * 合并多个指标
 * @param results 指标数组
 * @returns 合并后的指标
 */
export function mergeMetrics(results: StrategyMetrics[]): StrategyMetrics {
  const defaultMetrics: StrategyMetrics = {
    efficiency: { duration: 0, tokenUsage: 0, stepCount: 0, retryCount: 0 },
    quality: { success: 0, testPassRate: 0, codeCoverage: 0, lintScore: 0, complexityScore: 0 },
    stability: { consistency: 0, errorRate: 0, recoveryRate: 0 },
    satisfaction: { explanationQuality: 0 },
  }

  if (results.length === 0) return defaultMetrics

  return {
    efficiency: {
      duration: results.reduce((acc, m) => acc + m.efficiency.duration, 0) / results.length,
      tokenUsage: results.reduce((acc, m) => acc + m.efficiency.tokenUsage, 0) / results.length,
      stepCount: results.reduce((acc, m) => acc + m.efficiency.stepCount, 0) / results.length,
      retryCount: results.reduce((acc, m) => acc + m.efficiency.retryCount, 0) / results.length,
    },
    quality: {
      success: results.filter((m) => m.quality.success).length / results.length,
      testPassRate: results.reduce((acc, m) => acc + m.quality.testPassRate, 0) / results.length,
      codeCoverage: results.reduce((acc, m) => acc + m.quality.codeCoverage, 0) / results.length,
      lintScore: results.reduce((acc, m) => acc + m.quality.lintScore, 0) / results.length,
      complexityScore: results.reduce((acc, m) => acc + m.quality.complexityScore, 0) / results.length,
    },
    stability: {
      consistency: results.reduce((acc, m) => acc + m.stability.consistency, 0) / results.length,
      errorRate: results.reduce((acc, m) => acc + m.stability.errorRate, 0) / results.length,
      recoveryRate: results.reduce((acc, m) => acc + m.stability.recoveryRate, 0) / results.length,
    },
    satisfaction: {
      userRating: results.reduce((acc, m) => acc + (m.satisfaction.userRating ?? 0), 0) / results.length,
      reviewerScore: results.reduce((acc, m) => acc + (m.satisfaction.reviewerScore ?? 0), 0) / results.length,
      explanationQuality: results.reduce((acc, m) => acc + m.satisfaction.explanationQuality, 0) / results.length,
    },
  }
}
