import { StrategyState, StrategyResult, Context } from "../types/index.js"

/**
 * 节点类型枚举
 * 定义了图中节点的类型
 */
export type NodeType =
  | "strategy" // 策略节点：执行具体策略
  | "decision" // 决策节点：根据条件分支
  | "parallel" // 并行节点：并行执行多个分支
  | "merge" // 合并节点：汇聚多个分支
  | "loop" // 循环节点：循环执行
  | "human" // 人工节点：需要人工介入

/**
 * 节点配置
 */
export interface NodeConfig {
  agent?: string // 代理名称
  prompt?: string // 提示词
  timeout?: number // 超时时间
  retryable?: boolean // 是否可重试
  maxRetries?: number // 最大重试次数
}

/**
 * 图节点
 * 图的基本组成单元
 */
export interface GraphNode {
  id: string // 节点唯一标识
  type: NodeType // 节点类型
  name: string // 节点名称
  config: NodeConfig // 节点配置
}

/**
 * 边条件
 * 定义边何时可以被选择
 */
export interface EdgeCondition {
  type: "always" | "equals" | "notEquals" | "contains" | "greaterThan" | "lessThan" | "expression" // 条件类型
  field?: string // 比较字段
  value?: unknown // 比较值
  expression?: (context: Context, result: StrategyResult | null) => boolean // 自定义表达式
}

/**
 * 图边
 * 连接两个节点的有向边
 */
export interface GraphEdge {
  from: string // 起始节点ID
  to: string // 目标节点ID
  condition: EdgeCondition // 边条件
  priority: number // 优先级，数值越大越优先
}

/**
 * 图修改记录
 */
export interface GraphModification {
  type: "add_node" | "remove_node" | "add_edge" | "remove_edge" | "update_node" // 修改类型
  timestamp: number // 修改时间戳
  reason: string // 修改原因
  payload: unknown // 修改载荷
}

/**
 * 节点执行记录
 */
export interface NodeExecution {
  nodeId: string // 节点ID
  startTime: number // 开始时间
  endTime?: number // 结束时间
  result?: StrategyResult // 执行结果
  state: StrategyState // 执行状态
  error?: string // 错误信息
}

/**
 * 执行图
 * 整个图结构的数据模型
 */
export interface ExecutionGraph {
  id: string // 图唯一标识
  name: string // 图名称
  nodes: Map<string, GraphNode> // 节点列表
  edges: GraphEdge[] // 边列表
  entry: string // 入口节点ID
  exit: string // 出口节点ID
  metadata?: Record<string, unknown> // 元数据
}

/**
 * 创建节点
 * @param id 节点ID
 * @param type 节点类型
 * @param name 节点名称
 * @param config 节点配置
 * @returns 图节点对象
 */
export function createNode(id: string, type: NodeType, name: string, config: NodeConfig = {}): GraphNode {
  return { id, type, name, config }
}

/**
 * 创建边
 * @param from 起始节点ID
 * @param to 目标节点ID
 * @param condition 边条件
 * @param priority 优先级
 * @returns 图边对象
 */
export function createEdge(
  from: string,
  to: string,
  condition: EdgeCondition = { type: "always" },
  priority = 0,
): GraphEdge {
  return { from, to, condition, priority }
}

/**
 * 评估边条件
 * @param condition 边条件
 * @param context 执行上下文
 * @param result 策略执行结果
 * @returns 条件是否为真
 */
export function evaluateCondition(condition: EdgeCondition, context: Context, result: StrategyResult | null): boolean {
  if (condition.type === "always") return true
  if (!condition.field || condition.value === undefined) return false

  const fieldValue = context[condition.field] ?? result?.[condition.field]

  return compareFieldValue(condition.type, fieldValue, condition.value)
}

export function compareFieldValue(type: string, fieldValue: unknown, conditionValue: unknown): boolean {
  switch (type) {
    case "equals":
      return fieldValue === conditionValue
    case "notEquals":
      return fieldValue !== conditionValue
    case "contains":
      return String(fieldValue).includes(String(conditionValue))
    case "greaterThan":
      return typeof fieldValue === "number" && fieldValue > (conditionValue as number)
    case "lessThan":
      return typeof fieldValue === "number" && fieldValue < (conditionValue as number)
    default:
      return false
  }
}

export function getFieldValue(
  field: string,
  context: Record<string, unknown>,
  result: Record<string, unknown> | null,
): unknown {
  return context[field] ?? result?.[field]
}
