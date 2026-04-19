import { ExecutionGraph } from "../graph/types.js"
import { IntentType } from "../graph/IntentAnalyzer.js"

/**
 * 优化原则结构
 * 描述在特定条件下应采取的优化建议
 */
export interface OptimizationPrinciple {
  condition: string // 触发条件
  recommendation: string // 优化建议
  confidence: number // 置信度
  source: string[] // 来源
}

/**
 * 失败模式结构
 * 描述常见的失败模式及其解决方案
 */
export interface FailurePattern {
  pattern: string // 模式名称
  symptoms: string[] // 症状表现
  rootCause: string // 根本原因
  solution: string // 解决方案
  effectiveness: number // 有效性 0-1
}

/**
 * 用户偏好模型
 */
export interface UserPreferenceModel {
  preferredAgents: string[] // 偏好的智能体列表
  promptStyle: "concise" | "detailed" | "balanced" // 提示词风格
  riskTolerance: "low" | "medium" | "high" // 风险承受能力
}

/**
 * 元知识结构
 * 存储系统学习到的所有元知识
 */
export interface MetaKnowledge {
  taskStrategyMapping: Map<IntentType, string> // 任务类型到策略的映射
  principles: OptimizationPrinciple[] // 优化原则
  failurePatterns: FailurePattern[] // 失败模式
  userPreferences: UserPreferenceModel // 用户偏好
}

/**
 * 任务执行记录
 */
export interface TaskExecution {
  taskId: string
  taskDescription: string
  intent: IntentType
  graphId: string
  success: boolean
  duration: number
  metrics: {
    quality: number
    efficiency: number
    satisfaction: number
  }
}

/**
 * 元学习器
 * 负责从任务执行历史中提取和学习元知识
 * 支持知识迁移和持续学习
 */
export class MetaLearner {
  private knowledge: MetaKnowledge = {
    taskStrategyMapping: new Map(),
    principles: [],
    failurePatterns: [],
    userPreferences: {
      preferredAgents: [],
      promptStyle: "balanced",
      riskTolerance: "medium",
    },
  }

  /**
   * 从任务执行历史中提取元知识
   * 分析成功率来建立任务类型到策略的映射
   * 识别失败模式并记录解决方案
   * @param taskExecutions 任务执行历史
   * @returns 提取的元知识
   */
  extractMetaKnowledge(taskExecutions: TaskExecution[]): MetaKnowledge {
    const intentCounts = new Map<IntentType, { success: number; total: number }>()

    // 统计每种意图的成功率
    for (const exec of taskExecutions) {
      const current = intentCounts.get(exec.intent) ?? { success: 0, total: 0 }
      current.total++
      if (exec.success) current.success++
      intentCounts.set(exec.intent, current)
    }

    // 建立任务类型到策略的映射
    for (const [intent, stats] of intentCounts) {
      if (stats.total >= 1) {
        const successRate = stats.total === 0 ? 0 : stats.success / stats.total
        if (successRate > 0.5) {
          this.knowledge.taskStrategyMapping.set(intent, "feature-default")
        } else {
          this.knowledge.taskStrategyMapping.set(intent, "bugfix-default")
        }
      }
    }

    // 识别失败模式
    const highFailurePatterns = taskExecutions.filter((e) => !e.success)
    if (highFailurePatterns.length > 0) {
      this.knowledge.failurePatterns.push({
        pattern: "low-quality-execution",
        symptoms: ["low satisfaction score", "high duration"],
        rootCause: "insufficient planning",
        solution: "add review step before execution",
        effectiveness: 0.7,
      })
    }

    return this.knowledge
  }

  /**
   * 适应新任务
   * 根据元知识为新任务适配图结构
   * @param taskDescription 任务描述
   * @param metaKnowledge 元知识
   * @returns 适配后的图，如果无法适配则返回null
   */
  adaptToNewTask(taskDescription: string, metaKnowledge: MetaKnowledge): ExecutionGraph | null {
    const intentMatch = [...metaKnowledge.taskStrategyMapping.entries()].find(([intent]) =>
      taskDescription.toLowerCase().includes(intent),
    )

    if (!intentMatch) return null

    return {
      id: `adapted-${intentMatch[0]}`,
      name: `Adapted ${intentMatch[0]} Graph`,
      nodes: new Map(),
      edges: [],
      entry: "planner",
      exit: "reviewer",
    }
  }

  /**
   * 知识迁移
   * 将从一个任务学到的知识应用到类似任务
   * @param sourceTask 源任务
   * @param targetTask 目标任务
   * @param metaKnowledge 元知识
   * @returns 迁移结果：置信度和建议列表
   */
  transfer(
    sourceTask: string,
    targetTask: string,
    metaKnowledge: MetaKnowledge,
  ): { confidence: number; recommendations: string[] } {
    const sourceIntent = [...metaKnowledge.taskStrategyMapping.entries()].find(([intent]) =>
      sourceTask.toLowerCase().includes(intent),
    )

    const recommendations: string[] = []

    if (sourceIntent) {
      recommendations.push(`Use strategy graph optimized for ${sourceIntent[0]} tasks`)
      recommendations.push("Apply same agent configuration from source task")
    }

    return {
      confidence: sourceIntent ? 0.8 : 0.3,
      recommendations,
    }
  }

  /**
   * 持续学习
   * 从新的执行结果中更新元知识
   * @param newExecutions 新的执行记录
   * @param existingKnowledge 现有元知识
   * @returns 更新后的元知识
   */
  continualLearn(newExecutions: TaskExecution[], existingKnowledge: MetaKnowledge): MetaKnowledge {
    const updatedKnowledge = { ...existingKnowledge }

    for (const exec of newExecutions) {
      if (exec.metrics.quality > 0.8) {
        updatedKnowledge.principles.push({
          condition: `task.intent == ${exec.intent}`,
          recommendation: `Graph ${exec.graphId} performed well for ${exec.intent} tasks`,
          confidence: 0.6,
          source: [exec.taskId],
        })
      }
    }

    return updatedKnowledge
  }

  /**
   * 获取当前元知识
   */
  getKnowledge(): MetaKnowledge {
    return this.knowledge
  }

  /**
   * 设置用户偏好
   */
  setUserPreferences(prefs: Partial<UserPreferenceModel>): void {
    this.knowledge.userPreferences = { ...this.knowledge.userPreferences, ...prefs }
  }
}
