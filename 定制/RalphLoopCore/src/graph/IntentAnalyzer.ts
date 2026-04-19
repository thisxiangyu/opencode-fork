import { createNode, createEdge } from "./types.js"
import { GraphEngine } from "./GraphEngine.js"

/**
 * 意图类型枚举
 * 定义了系统能够识别的主要任务类型
 */
export type IntentType =
  | "feature" // 功能开发
  | "bugfix" // 缺陷修复
  | "refactor" // 重构
  | "test" // 测试相关
  | "doc" // 文档相关
  | "performance" // 性能优化
  | "security" // 安全相关
  | "integration" // 集成相关
  | "unknown" // 未知类型

/**
 * 任务意图结构
 * 包含主要意图、次要意图、置信度和识别的实体
 */
export interface TaskIntent {
  primary: IntentType // 主要意图类型
  secondary: IntentType[] // 次要意图类型列表
  confidence: number // 置信度 0-1
  entities: Record<string, unknown> // 识别的实体信息
}

/**
 * 意图分析器
 * 通过模式匹配识别用户任务的意图类型
 * 支持中英文关键词检测
 */
export class IntentAnalyzer {
  private patterns: Map<IntentType, RegExp[]> = new Map()

  constructor() {
    // 特征类型：实现、添加、新增、开发、创建、构建等中英文关键词
    this.patterns.set("feature", [
      /(实现|添加|新增|开发|创建|构建|制作)/i,
      /(功能|模块|组件|服务)/i,
      /\b(new|add|create|implement|build|develop)\b/i,
    ])
    // Bug修复类型：修复、解决、修补、改正等
    this.patterns.set("bugfix", [
      /(修复|解决|修补|改正|修正|处理)/i,
      /(bug|错误|缺陷|问题|异常|崩溃)/i,
      /\b(fix|bug|issue|error|problem|crash)\b/i,
    ])
    // 重构类型：重构、重写、优化、整理等
    this.patterns.set("refactor", [/(重构|重写|优化|整理|清理|简化)/i, /\b(refactor|optimize|clean|restructure)\b/i])
    // 测试类型
    this.patterns.set("test", [/(测试|单元测试|集成测试|用例|验证)/i, /\b(test|testing|verify|validation)\b/i])
    // 文档类型
    this.patterns.set("doc", [/(文档|说明|注释|写文档)/i, /\b(documentation|docs|comment|readme)\b/i])
    // 性能优化类型
    this.patterns.set("performance", [/(性能|优化|加速|提升)/i, /\b(performance|speed|faster|optimize|efficient)\b/i])
    // 安全相关类型
    this.patterns.set("security", [
      /(安全|漏洞|加密|权限|认证|授权)/i,
      /\b(security|vulnerability|encrypt|permission|auth)\b/i,
    ])
    // 集成相关类型
    this.patterns.set("integration", [/(集成|对接|联调|接入|整合)/i, /\b(integration|integrate|connect)\b/i])
  }

  /**
   * 分析任务文本的意图
   * @param task 任务描述文本
   * @returns 任务意图分析结果
   */
  analyze(task: string): TaskIntent
  analyze(task: unknown): TaskIntent
  analyze(task: unknown): TaskIntent {
    if (typeof task !== "string") {
      console.warn("[IntentAnalyzer] Non-string input received:", typeof task)
      return { primary: "unknown", secondary: [], confidence: 0, entities: {} }
    }
    const scores: Map<IntentType, number> = new Map()
    const taskLower = task.toLowerCase()

    // 遍历所有模式，计算每个意图类型的匹配得分
    for (const [intent, regexes] of this.patterns) {
      let score = 0
      for (const regex of regexes) {
        const matches = taskLower.match(regex)
        if (matches) {
          score += matches.length * 0.3
        }
      }
      if (score > 0) {
        scores.set(intent, Math.min(score, 1))
      }
    }

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1])

    // 如果没有足够的置信度匹配，返回未知类型
    if (sorted.length === 0 || sorted[0]?.[1] === undefined || sorted[0]?.[1] < 0.1) {
      return { primary: "unknown", secondary: [], confidence: 0, entities: {} }
    }

    const primary = sorted[0]?.[0] ?? "unknown"
    const secondary = sorted.slice(1, 3).map(([type]) => type)
    const confidence = sorted[0]?.[1] ?? 0

    // 提取技术术语
    const entities: Record<string, unknown> = {}
    const techTerms = task.match(/\b[A-Z][a-zA-Z]+\b/g)
    if (techTerms) {
      entities.techTerms = techTerms
    }

    return { primary, secondary, confidence, entities }
  }
}

/**
 * 创建功能开发默认图
 * 流程：计划 -> 执行 -> 测试 -> 审核
 * 如果审核未通过则返回计划阶段重新开始
 */
export function createFeatureGraph(engine: GraphEngine): string {
  const graphId = "feature-default"
  engine.createGraph(graphId, "Feature Development", "planner", "reviewer")

  engine.addNode(graphId, createNode("planner", "strategy", "Planner", { agent: "architect" }))
  engine.addNode(graphId, createNode("executor", "strategy", "Executor", { agent: "developer" }))
  engine.addNode(graphId, createNode("tester", "strategy", "Tester", { agent: "qa" }))
  engine.addNode(graphId, createNode("reviewer", "strategy", "Reviewer", { agent: "senior-dev" }))

  engine.addEdge(graphId, createEdge("planner", "executor", { type: "always" }, 0))
  engine.addEdge(graphId, createEdge("executor", "tester", { type: "always" }, 0))
  engine.addEdge(graphId, createEdge("tester", "reviewer", { type: "always" }, 0))

  // 审核未通过时返回计划阶段重新开始
  engine.addEdge(graphId, createEdge("reviewer", "planner", { type: "notEquals", field: "passed", value: true }, 10))

  return graphId
}

/**
 * 创建缺陷修复默认图
 * 流程：分析 -> 修复 -> 验证
 * 如果验证未通过则返回分析阶段重新开始
 */
export function createBugfixGraph(engine: GraphEngine): string {
  const graphId = "bugfix-default"
  engine.createGraph(graphId, "Bug Fix", "analyzer", "verifier")

  engine.addNode(graphId, createNode("analyzer", "strategy", "Analyzer", { agent: "detective" }))
  engine.addNode(graphId, createNode("fixer", "strategy", "Fixer", { agent: "developer" }))
  engine.addNode(graphId, createNode("verifier", "strategy", "Verifier", { agent: "qa" }))

  engine.addEdge(graphId, createEdge("analyzer", "fixer", { type: "always" }, 0))
  engine.addEdge(graphId, createEdge("fixer", "verifier", { type: "always" }, 0))

  // 验证未通过时返回分析阶段重新开始
  engine.addEdge(graphId, createEdge("verifier", "analyzer", { type: "notEquals", field: "verified", value: true }, 10))

  return graphId
}

/**
 * 创建重构默认图
 * 流程：评估 -> 重构 -> 审核
 * 如果审核未通过则返回评估阶段重新开始
 */
export function createRefactorGraph(engine: GraphEngine): string {
  const graphId = "refactor-default"
  engine.createGraph(graphId, "Refactor", "assessor", "reviewer")

  engine.addNode(graphId, createNode("assessor", "strategy", "Assessor", { agent: "architect" }))
  engine.addNode(graphId, createNode("refactorer", "strategy", "Refactorer", { agent: "developer" }))
  engine.addNode(graphId, createNode("reviewer", "strategy", "Reviewer", { agent: "senior-dev" }))

  engine.addEdge(graphId, createEdge("assessor", "refactorer", { type: "always" }, 0))
  engine.addEdge(graphId, createEdge("refactorer", "reviewer", { type: "always" }, 0))

  // 审核未通过时返回评估阶段重新开始
  engine.addEdge(graphId, createEdge("reviewer", "assessor", { type: "notEquals", field: "approved", value: true }, 10))

  return graphId
}
