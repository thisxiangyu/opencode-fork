import { StrategyState, StrategyResult, Context } from "../types/index.js"
import { compareFieldValue } from "./types.js"
import {
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRYABLE,
  DEFAULT_PARALLEL,
  DEFAULT_CONTINUE_ON_ERROR,
} from "../constants.js"

const MAX_REGEX_LENGTH = 200
const SUSPICIOUS_REGEX_CHARS = ["**", "++", "(?!", "(?<=", "(?<!"]

function isSafeRegex(pattern: string): boolean {
  if (pattern.length > MAX_REGEX_LENGTH) return false
  for (const sus of SUSPICIOUS_REGEX_CHARS) {
    if (pattern.includes(sus)) return false
  }
  return true
}

/**
 * 角色
 * 代表单个角色，包含身份Prompt和长期记忆
 */
export interface Role {
  id: string
  name: string
  systemPrompt: string
  memory?: string
}

/**
 * 角色实例
 * 在节点中执行的角色，带有实例级别的配置
 */
export interface RoleInstance {
  role: Role
  weight?: number
  temperature?: number
  maxTokens?: number
  count?: number
  personality?: string
}

/**
 * 节点访问模式
 * - readonly: 只读模式，使用 Plan agent (不执行写入操作)
 * - readwrite: 读写模式，使用 Build agent (可以执行写入操作)
 */
export type NodeAccessMode = "readonly" | "readwrite"

/**
 * 节点配置
 */
export interface NodeConfig {
  timeout?: number
  retryable?: boolean
  maxRetries?: number
  parallel?: boolean
  continueOnError?: boolean
  accessMode?: NodeAccessMode
}

/**
 * 节点执行结果
 */
export interface NodeResult extends StrategyResult {
  nodeId: string
  nodeName: string
  roleResults?: Record<string, StrategyResult>
}

/**
 * 节点
 * 图的基本组成单元，可以包含多个角色
 */
export interface LoopNode {
  id: string
  name: string
  description?: string
  roles: RoleInstance[]
  config: NodeConfig
  accessMode: NodeAccessMode
  onEnter?: (context: Context) => void
  onExit?: (context: Context, result: NodeResult) => void
}

/**
 * 跳转条件类型
 */
export type TransitionConditionType =
  | "always"
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "regex"
  | "greaterThan"
  | "lessThan"
  | "expression"
  | "keyword"
  | "keywordAny"
  | "keywordAll"

export interface TransitionCondition {
  type: TransitionConditionType
  field?: string
  value?: unknown
  regex?: string
  keywords?: string[]
  keywordMode?: "any" | "all"
  expression?: (context: Record<string, unknown>, result: NodeResult | null) => boolean
}

/**
 * 跳转动作
 */
export type TransitionAction = "next" | "goto" | "restart" | "end" | "fork"

/**
 * 跳转
 * 定义节点之间的转换逻辑
 */
export interface Transition {
  id?: string
  from: string
  to: string
  condition: TransitionCondition
  action?: TransitionAction
  description?: string
  priority?: number
}

export interface TransitionResult {
  matched: boolean
  targetNode?: string
  action?: TransitionAction
}

/**
 * 节点出边
 */
export interface NodeOutgoing {
  nodeId: string
  transitions: Transition[]
}

/**
 * 循环策略配置
 * 一个完整的循环策略，包含节点图和跳转逻辑
 */
export interface LoopStrategy {
  id: string
  name: string
  description?: string
  version?: string
  nodes: LoopNode[]
  transitions: Transition[]
  entryNode: string
  exitNodes: string[]
  defaultExit?: string
  maxCycles?: number
  cycleDelay?: number
  metadata?: Record<string, unknown>
}

/**
 * 节点执行记录
 */
export interface NodeExecutionRecord {
  nodeId: string
  nodeName: string
  cycle: number
  iteration: number
  startTime: number
  endTime?: number
  result?: NodeResult
  state: StrategyState
  error?: string
  rolesExecuted: string[]
}

/**
 * 循环执行上下文
 */
export interface LoopContext extends Context {
  currentNodeId: string
  cycleCount: number
  totalIterations: number
  nodeResults: Record<string, NodeResult>
  transitionHistory: TransitionResult[]
  metadata?: Record<string, unknown>
}

/**
 * 循环执行结果
 */
export interface LoopExecutionResult {
  success: boolean
  completedNodes: NodeExecutionRecord[]
  context: LoopContext
  totalCycles: number
  totalIterations: number
  exitNode?: string
  error?: string
  transitions: TransitionResult[]
}

/**
 * 执行状态
 */
export interface LoopExecutionState {
  active: boolean
  currentNodeId: string
  cycleCount: number
  iteration: number
  strategyId: string
  paused?: boolean
  waitingForDecision?: boolean
  pendingJump?: string | null
}

/**
 * 评估跳转条件
 */
export function evaluateTransitionCondition(
  condition: TransitionCondition,
  context: Record<string, unknown>,
  result: NodeResult | null,
): boolean {
  if (condition.type === "always") return true
  if (condition.type === "expression") return condition.expression?.(context, result) ?? false

  const fieldValue = context[condition.field ?? ""] ?? result?.[condition.field ?? ""]
  const textValue = typeof fieldValue === "string" ? fieldValue : String(fieldValue ?? "")

  switch (condition.type) {
    case "equals":
    case "notEquals":
    case "contains":
    case "greaterThan":
    case "lessThan":
      return compareFieldValue(condition.type, fieldValue, condition.value)
    case "notContains":
      return typeof fieldValue === "string" && !fieldValue.includes(String(condition.value))
    case "startsWith":
      return typeof fieldValue === "string" && fieldValue.startsWith(String(condition.value))
    case "endsWith":
      return typeof fieldValue === "string" && fieldValue.endsWith(String(condition.value))
    case "regex": {
      if (!condition.regex || !isSafeRegex(condition.regex)) return false
      if (typeof fieldValue !== "string") return false
      try {
        return new RegExp(condition.regex).test(fieldValue)
      } catch {
        return false
      }
    }
    case "keyword":
    case "keywordAny": {
      const keywords = condition.keywords ?? (condition.value ? [String(condition.value)] : [])
      if (keywords.length === 0) return false
      const mode = condition.keywordMode ?? "any"
      if (mode === "all") {
        return keywords.every((kw) => textValue.includes(kw))
      }
      return keywords.some((kw) => textValue.includes(kw))
    }
    case "keywordAll": {
      const keywords = condition.keywords ?? (condition.value ? [String(condition.value)] : [])
      if (keywords.length === 0) return false
      return keywords.every((kw) => textValue.includes(kw))
    }
    default:
      return false
  }
}

/**
 * 创建角色
 */
export function createRole(id: string, name: string, systemPrompt: string, memory?: string): Role {
  return { id, name, systemPrompt, memory }
}

/**
 * 创建节点
 */
export function createLoopNode(
  id: string,
  name: string,
  roles: RoleInstance[],
  config: NodeConfig = {},
  description?: string,
): LoopNode {
  return {
    id,
    name,
    description,
    roles,
    accessMode: config.accessMode ?? "readwrite",
    config: {
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      retryable: config.retryable ?? DEFAULT_RETRYABLE,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      parallel: config.parallel ?? DEFAULT_PARALLEL,
      continueOnError: config.continueOnError ?? DEFAULT_CONTINUE_ON_ERROR,
      ...config,
    },
  }
}

/**
 * 创建跳转
 */
export function createTransition({
  from,
  to,
  condition,
  description,
  priority,
}: {
  from: string
  to: string
  condition: TransitionCondition
  description?: string
  priority?: number
}): Transition {
  return { from, to, condition, description, priority }
}

/**
 * 创建条件跳转
 */
export function createConditionalTransition({
  from,
  to,
  field,
  value,
  conditionType = "equals",
  description,
  priority,
}: {
  from: string
  to: string
  field: string
  value: unknown
  conditionType?: TransitionConditionType
  description?: string
  priority?: number
}): Transition {
  return createTransition({ from, to, condition: { type: conditionType, field, value }, description, priority })
}

/**
 * 创建关键词跳转
 */
export function createKeywordTransition(
  from: string,
  to: string,
  keywords: string[],
  field = "feedback",
  matchMode: "any" | "all" = "any",
  description?: string,
  priority?: number,
): Transition {
  return createTransition({
    from,
    to,
    condition: {
      type: matchMode === "all" ? "keywordAll" : "keywordAny",
      field,
      keywords,
      keywordMode: matchMode,
    },
    description,
    priority,
  })
}
