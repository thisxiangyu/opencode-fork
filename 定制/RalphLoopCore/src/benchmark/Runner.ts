import { StrategyResult, Context } from "../types/index.js"
import {
  BenchmarkCase,
  BenchmarkResult,
  BenchmarkSuiteResult,
  ComparisonResult,
  RegressionReport,
  StrategyMetrics,
  calculateStatistics,
  mergeMetrics,
} from "./types.js"
import { GraphNode } from "../graph/types.js"

/**
 * 策略执行器类型
 * 定义了如何在图节点上执行策略的函数签名（同步版本）
 */
export type StrategyExecutor = (node: GraphNode, context: Context) => StrategyResult

/**
 * 异步策略执行器类型
 */
export type AsyncStrategyExecutor = (node: GraphNode, context: Context) => StrategyResult | Promise<StrategyResult>

/**
 * 基准测试运行器选项
 */
export interface BenchmarkRunnerOptions {
  parallel?: boolean // 是否并行执行
  maxConcurrency?: number // 最大并发数
  timeout?: number // 超时时间（毫秒）
  retryCount?: number // 失败重试次数
}

/**
 * 基准测试运行器
 * 负责运行各种基准测试、对比测试和回归测试
 * 评估图执行引擎的性能和质量指标
 */
export class BenchmarkRunner {
  private storage: Map<string, BenchmarkResult[]> = new Map()
  private defaultOptions: Required<BenchmarkRunnerOptions>

  constructor() {
    this.defaultOptions = {
      parallel: false,
      maxConcurrency: 4,
      timeout: 30000,
      retryCount: 1,
    }
  }

  /**
   * 运行单个测试用例（支持异步执行器）
   */
  async runCase(
    graphId: string,
    testCase: BenchmarkCase,
    executor: AsyncStrategyExecutor,
    iterations = 1,
    options: BenchmarkRunnerOptions = {},
  ): Promise<BenchmarkResult> {
    const opts = { ...this.defaultOptions, ...options }
    const rawResults: StrategyResult[] = []
    const failures: Array<{ iteration: number; error: Error; attempt: number }> = []
    const scores: number[] = []

    for (let i = 0; i < iterations; i++) {
      const iterationResult = await this.runSingleIteration(graphId, testCase, executor, opts, i)
      rawResults.push(iterationResult.result)
      scores.push(iterationResult.score)
      if (iterationResult.error) {
        failures.push(iterationResult.error)
      }
    }

    const metrics = this.calculateMetrics(rawResults, scores, failures)

    const result: BenchmarkResult = {
      caseId: testCase.id,
      graphId,
      timestamp: Date.now(),
      iterations,
      metrics,
      rawResults,
      failures,
      statistics: calculateStatistics(scores),
    }

    const existing = this.storage.get(graphId) ?? []
    existing.push(result)
    this.storage.set(graphId, existing)

    return result
  }

  private async runSingleIteration(
    graphId: string,
    testCase: BenchmarkCase,
    executor: AsyncStrategyExecutor,
    opts: Required<BenchmarkRunnerOptions>,
    iterationIndex: number,
  ): Promise<{
    result: StrategyResult
    score: number
    error: null | { iteration: number; error: Error; attempt: number }
  }> {
    let attempt = 0
    let lastError: Error | null = null

    while (attempt <= opts.retryCount) {
      try {
        const result = await this.executeWithTimeout(graphId, testCase.task, executor, opts.timeout)
        const score = this.evaluateScore(result, testCase)
        if (result.error) {
          return {
            result,
            score,
            error: { iteration: iterationIndex, error: new Error(String(result.error)), attempt },
          }
        }
        return { result, score, error: null }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        attempt++
      }
    }

    return {
      result: { error: lastError?.message ?? "Unknown error" },
      score: 0,
      error: { iteration: iterationIndex, error: lastError!, attempt: opts.retryCount + 1 },
    }
  }

  private async executeWithTimeout(
    graphId: string,
    task: string,
    executor: AsyncStrategyExecutor,
    timeout: number,
  ): Promise<StrategyResult> {
    const context: Context = { task, cycle: 0 }
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Execution timeout")), timeout)
    })

    return Promise.race([
      executor({ id: graphId, type: "strategy", name: "benchmark", config: {} }, context),
      timeoutPromise,
    ])
  }

  private evaluateScore(result: StrategyResult, testCase: BenchmarkCase): number {
    let totalScore = 0
    for (const criterion of testCase.evaluationCriteria) {
      try {
        totalScore += criterion.evaluator(result, testCase.expectedOutput) * criterion.weight
      } catch {
        totalScore += 0
      }
    }
    return totalScore
  }

  /**
   * 运行测试套件
   */
  async runSuite(
    graphId: string,
    suite: BenchmarkCase[],
    executor: AsyncStrategyExecutor,
    options: BenchmarkRunnerOptions = {},
  ): Promise<BenchmarkSuiteResult> {
    const opts = { ...this.defaultOptions, ...options }
    const results: BenchmarkResult[] = []
    const startTime = Date.now()

    if (opts.parallel && opts.maxConcurrency > 1) {
      const chunks: BenchmarkCase[][] = []
      for (let i = 0; i < suite.length; i += opts.maxConcurrency) {
        chunks.push(suite.slice(i, i + opts.maxConcurrency))
      }

      for (const chunk of chunks) {
        const chunkResults = await Promise.all(chunk.map((tc) => this.runCase(graphId, tc, executor, 1, opts)))
        results.push(...chunkResults)
      }
    } else {
      for (const tc of suite) {
        const result = await this.runCase(graphId, tc, executor, 1, opts)
        results.push(result)
      }
    }

    const totalDuration = Date.now() - startTime
    const passedCases = results.filter((r) => r.failures.length === 0).length

    return {
      suiteName: "benchmark-suite",
      totalCases: suite.length,
      passedCases,
      failedCases: suite.length - passedCases,
      results,
      summary: {
        totalDuration,
        averageMetrics: mergeMetrics(results.map((r) => r.metrics)),
      },
    }
  }

  /**
   * 对比两个图的性能
   */
  async compare(
    graphA: string,
    graphB: string,
    testCases: BenchmarkCase[],
    executorA: AsyncStrategyExecutor,
    executorB: AsyncStrategyExecutor,
    options: BenchmarkRunnerOptions = {},
  ): Promise<ComparisonResult> {
    const [resultsA, resultsB] = await Promise.all([
      Promise.all(testCases.map((tc) => this.runCase(graphA, tc, executorA, 3, options))),
      Promise.all(testCases.map((tc) => this.runCase(graphB, tc, executorB, 3, options))),
    ])

    const details: ComparisonResult["details"] = []
    let totalScoreA = 0
    let totalScoreB = 0

    for (let i = 0; i < testCases.length; i++) {
      const scoreA = resultsA[i].statistics.mean
      const scoreB = resultsB[i].statistics.mean
      totalScoreA += scoreA
      totalScoreB += scoreB
      details.push({
        caseId: testCases[i].id,
        scoreA,
        scoreB,
        improvement: scoreB - scoreA,
      })
    }

    const scoreDiff = totalScoreB - totalScoreA
    return {
      graphA,
      graphB,
      testCases: testCases.map((tc) => tc.id),
      winner: scoreDiff > 0 ? graphB : scoreDiff < 0 ? graphA : undefined,
      scoreDiff,
      details,
    }
  }

  /**
   * 执行回归测试
   */
  async regressionTest(
    currentGraph: string,
    baselineGraph: string,
    testCases: BenchmarkCase[],
    currentExecutor: AsyncStrategyExecutor,
    baselineExecutor: AsyncStrategyExecutor,
    threshold = 0.1,
    options: BenchmarkRunnerOptions = {},
  ): Promise<RegressionReport> {
    const comparison = await this.compare(
      currentGraph,
      baselineGraph,
      testCases,
      currentExecutor,
      baselineExecutor,
      options,
    )

    const affectedCases: string[] = []
    const recommendations: string[] = []

    for (const detail of comparison.details) {
      if (detail.improvement < -threshold) {
        affectedCases.push(detail.caseId)
        recommendations.push(`Case ${detail.caseId} showed regression: ${detail.improvement.toFixed(3)}`)
      }
    }

    const hasDegradation = comparison.winner === baselineGraph && comparison.scoreDiff < -threshold

    return {
      currentGraph,
      baselineGraph,
      threshold,
      hasDegradation,
      affectedCases,
      recommendations,
    }
  }

  /**
   * 获取历史测试结果
   */
  getHistory(graphId?: string): BenchmarkResult[] {
    if (graphId) {
      return this.storage.get(graphId) ?? []
    }
    return [...this.storage.values()].flat()
  }

  /**
   * 清除历史记录
   */
  clearHistory(graphId?: string): void {
    if (graphId) {
      this.storage.delete(graphId)
    } else {
      this.storage.clear()
    }
  }

  /**
   * 计算综合指标
   */
  private calculateMetrics(
    results: StrategyResult[],
    scores: number[],
    failures: Array<{ iteration: number; error: Error; attempt: number }>,
  ): StrategyMetrics {
    const successCount = results.filter((r) => !r.error).length

    return {
      efficiency: {
        duration: results.reduce((acc, r) => acc + ((r["duration"] as number) || 0), 0) / Math.max(results.length, 1),
        tokenUsage:
          results.reduce((acc, r) => acc + ((r["tokenUsage"] as number) || 0), 0) / Math.max(results.length, 1),
        stepCount: results.reduce((acc, r) => acc + ((r["stepCount"] as number) || 0), 0) / Math.max(results.length, 1),
        retryCount:
          results.reduce((acc, r) => acc + ((r["retryCount"] as number) || 0), 0) / Math.max(results.length, 1),
      },
      quality: {
        success: successCount / Math.max(results.length, 1),
        testPassRate: successCount / Math.max(results.length, 1),
        codeCoverage: 0,
        lintScore: 0,
        complexityScore: 0,
      },
      stability: {
        consistency: 1 - failures.length / Math.max(results.length, 1),
        errorRate: failures.length / Math.max(results.length, 1),
        recoveryRate: 0,
      },
      satisfaction: {
        explanationQuality: scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1),
      },
    }
  }
}
