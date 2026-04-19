import type { Context } from "../types/index.js"
import { StrategyState, StrategyResult } from "../types/index.js"
import { EventEmitter } from "events"
import {
  ExecutionGraph,
  GraphNode,
  GraphEdge,
  GraphModification,
  NodeExecution,
  evaluateCondition,
  NodeType,
} from "./types.js"

/**
 * 图执行选项
 * 控制图执行过程中的行为和回调
 */
export interface GraphExecutionOptions {
  maxIterations?: number // 最大迭代次数，防止无限循环
  timeout?: number // 执行超时时间（毫秒）
  onNodeStart?: (node: GraphNode, iteration: number) => void // 节点开始执行时的回调
  onNodeComplete?: (node: GraphNode, result: StrategyResult, iteration: number) => void // 节点完成时的回调
  onError?: (node: GraphNode, error: Error, iteration: number) => void // 节点出错时的回调
}

/**
 * 图执行结果
 * 包含执行的完整状态和结果信息
 */
export interface GraphExecutionResult {
  success: boolean // 执行是否成功
  completedNodes: NodeExecution[] // 已完成的节点列表
  context: Context // 执行结束后的上下文
  iterations: number // 迭代次数
  error?: string // 错误信息（如果失败）
}

export interface GraphEngineEvents {
  executionStart: (graphId: string, context: Context) => void
  executionComplete: (graphId: string, result: GraphExecutionResult) => void
  executionError: (graphId: string, error: Error) => void
  orphanedNode: (nodeId: string) => void
}

/**
 * 图执行引擎
 * 核心编排引擎，负责管理和执行有向图结构的工作流
 * 支持节点和边的动态添加、删除、修改
 * 提供序列化/反序列化能力用于持久化
 */
export interface GraphEngineConfig {
  maxHistorySize?: number
}

export class GraphEngine extends EventEmitter {
  private graphs: Map<string, ExecutionGraph> = new Map()
  private executionHistory: Map<string, NodeExecution[]> = new Map()
  private modifications: Map<string, GraphModification[]> = new Map()
  private executing = false
  private graphLock: Set<string> = new Set()
  private maxHistorySize: number

  constructor(config: GraphEngineConfig = {}) {
    super()
    this.maxHistorySize = config.maxHistorySize ?? 1000
  }

  /**
   * 创建新图
   * @param id 图的唯一标识符
   * @param name 图的名称
   * @param entry 入口节点ID
   * @param exit 出口节点ID
   * @returns 创建的图对象
   */
  createGraph(id: string, name: string, entry: string, exit: string): ExecutionGraph {
    const graph: ExecutionGraph = {
      id,
      name,
      nodes: new Map(),
      edges: [],
      entry,
      exit,
    }
    this.graphs.set(id, graph)
    this.modifications.set(id, [])
    return graph
  }

  /**
   * 获取图
   * @param id 图ID
   * @returns 图对象，如果不存在则返回undefined
   */
  getGraph(id: string): ExecutionGraph | undefined {
    return this.graphs.get(id)
  }

  /**
   * 添加节点到图中
   * @param graphId 图ID
   * @param node 要添加的节点
   * @param position 可选位置参数：after表示在某个节点之后添加，before表示在某个节点之前添加
   * @returns 是否添加成功
   */
  addNode(graphId: string, node: GraphNode, position?: { after?: string; before?: string }): boolean {
    if (this.graphLock.has(graphId)) return false

    const graph = this.graphs.get(graphId)
    if (!graph) return false

    graph.nodes.set(node.id, node)

    if (position?.after) {
      const afterEdges = graph.edges.filter((e) => e.from === position.after)
      const afterEdge = afterEdges[0]
      if (afterEdge) {
        const idx = graph.edges.indexOf(afterEdge)
        graph.edges.splice(idx, 0, { from: position.after, to: node.id, condition: { type: "always" }, priority: 0 })
      } else {
        graph.edges.push({ from: position.after, to: node.id, condition: { type: "always" }, priority: 0 })
      }
    } else if (position?.before) {
      const beforeEdges = graph.edges.filter((e) => e.to === position.before)
      const beforeEdge = beforeEdges[0]
      if (beforeEdge) {
        const idx = graph.edges.indexOf(beforeEdge)
        graph.edges.splice(idx, 0, { from: node.id, to: position.before, condition: { type: "always" }, priority: 0 })
      } else {
        graph.edges.push({ from: node.id, to: position.before, condition: { type: "always" }, priority: 0 })
      }
    }

    this.recordModification(graphId, "add_node", `Added node ${node.id}`, node)
    return true
  }

  /**
   * 从图中移除节点
   * @param graphId 图ID
   * @param nodeId 要移除的节点ID
   * @param reason 移除原因
   * @returns 是否移除成功
   */
  removeNode(graphId: string, nodeId: string, reason: string): boolean {
    if (this.graphLock.has(graphId)) return false

    const graph = this.graphs.get(graphId)
    if (!graph) return false

    graph.nodes.delete(nodeId)
    graph.edges = graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)

    this.recordModification(graphId, "remove_node", reason, { nodeId })
    return true
  }

  /**
   * 添加边到图中
   * @param graphId 图ID
   * @param edge 要添加的边
   * @returns 是否添加成功
   */
  addEdge(graphId: string, edge: GraphEdge): boolean {
    if (this.graphLock.has(graphId)) return false

    const graph = this.graphs.get(graphId)
    if (!graph) return false

    if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to)) {
      return false
    }

    graph.edges.push(edge)
    this.recordModification(graphId, "add_edge", `Added edge ${edge.from} -> ${edge.to}`, edge)
    return true
  }

  /**
   * 从图中移除边
   * @param graphId 图ID
   * @param from 起始节点ID
   * @param to 目标节点ID
   * @returns 是否移除成功
   */
  removeEdge(graphId: string, from: string, to: string): boolean {
    if (this.graphLock.has(graphId)) return false

    const graph = this.graphs.get(graphId)
    if (!graph) return false

    const idx = graph.edges.findIndex((e) => e.from === from && e.to === to)
    if (idx === -1) return false

    graph.edges.splice(idx, 1)
    this.recordModification(graphId, "remove_edge", `Removed edge ${from} -> ${to}`, { from, to })
    return true
  }

  /**
   * 记录图修改历史
   */
  private recordModification(graphId: string, type: GraphModification["type"], reason: string, payload: unknown): void {
    const mods = this.modifications.get(graphId)
    if (mods) {
      mods.push({ type, timestamp: Date.now(), reason, payload })
    }
  }

  /**
   * 获取图的修改历史
   * @param graphId 图ID
   * @returns 修改记录列表
   */
  getModifications(graphId: string): GraphModification[] {
    return this.modifications.get(graphId) ?? []
  }

  destroyGraph(graphId: string): boolean {
    if (this.graphLock.has(graphId)) return false

    const existed = this.graphs.delete(graphId)
    if (existed) {
      this.modifications.delete(graphId)
      this.executionHistory.delete(graphId)
    }
    return existed
  }

  dispose(): void {
    this.removeAllListeners()
    this.graphs.clear()
    this.modifications.clear()
    this.executionHistory.clear()
    this.executing = false
    this.graphLock.clear()
  }

  /**
   * 执行图
   * 从入口节点开始，沿着边执行直到到达出口节点
   * 根据边条件动态决定下一步执行哪个节点
   * @param graphId 图ID
   * @param context 执行上下文
   * @param strategyExecutor 策略执行器，用于执行每个节点
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(
    graphId: string,
    context: Context,
    strategyExecutor: (node: GraphNode, ctx: Context) => StrategyResult | Promise<StrategyResult>,
    options: GraphExecutionOptions = {},
  ): Promise<GraphExecutionResult> {
    if (this.executing) {
      const result = {
        success: false,
        completedNodes: [],
        context,
        iterations: 0,
        error: "Engine is already executing",
      }
      this.emit("executionError", graphId, new Error("Engine is already executing"))
      this.emit("executionComplete", graphId, result)
      return result
    }

    const graph = this.graphs.get(graphId)
    if (!graph) {
      const result = { success: false, completedNodes: [], context, iterations: 0, error: "Graph not found" }
      this.emit("executionError", graphId, new Error("Graph not found"))
      this.emit("executionComplete", graphId, result)
      return result
    }

    this.executing = true
    this.graphLock.add(graphId)

    try {
      return await this.executeInternal(graphId, graph, context, strategyExecutor, options)
    } finally {
      this.executing = false
      this.graphLock.delete(graphId)
    }
  }

  private async executeInternal(
    graphId: string,
    graph: ExecutionGraph,
    context: Context,
    strategyExecutor: (node: GraphNode, ctx: Context) => StrategyResult | Promise<StrategyResult>,
    options: GraphExecutionOptions,
  ): Promise<GraphExecutionResult> {
    this.emit("executionStart", graphId, context)

    const completedNodes: NodeExecution[] = []
    let currentNodeId = graph.entry
    let iterations = 0
    const maxIterations = options.maxIterations ?? 100

    this.executionHistory.set(graphId, [])

    while (iterations < maxIterations) {
      iterations++
      const node = graph.nodes.get(currentNodeId)
      if (!node) {
        const result = { success: false, completedNodes, context, iterations, error: `Node ${currentNodeId} not found` }
        this.emit("executionError", graphId, new Error(`Node ${currentNodeId} not found`))
        this.emit("executionComplete", graphId, result)
        return result
      }

      options.onNodeStart?.(node, iterations)

      const exec: NodeExecution = {
        nodeId: node.id,
        startTime: Date.now(),
        state: StrategyState.RUNNING,
      }

      try {
        let execResult = strategyExecutor(node, context)
        if (execResult instanceof Promise) {
          execResult = await execResult
        }
        exec.endTime = Date.now()
        exec.result = execResult
        exec.state = execResult.error ? StrategyState.FAIL : StrategyState.PASS

        context[`${node.id}_result`] = execResult

        options.onNodeComplete?.(node, execResult, iterations)

        if (exec.state === StrategyState.FAIL) {
          const result = {
            success: false,
            completedNodes: [...completedNodes, exec],
            context,
            iterations,
            error: `Node ${node.id} failed`,
          }
          this.emit("executionError", graphId, new Error(`Node ${node.id} failed`))
          this.emit("executionComplete", graphId, result)
          return result
        }
      } catch (error) {
        exec.endTime = Date.now()
        exec.state = StrategyState.FAIL
        exec.error = error instanceof Error ? error.message : String(error)
        options.onError?.(node, error instanceof Error ? error : new Error(String(error)), iterations)
        const result = {
          success: false,
          completedNodes: [...completedNodes, exec],
          context,
          iterations,
          error: exec.error,
        }
        this.emit("executionError", graphId, error instanceof Error ? error : new Error(String(error)))
        this.emit("executionComplete", graphId, result)
        return result
      }

      completedNodes.push(exec)
      if (completedNodes.length > this.maxHistorySize) {
        const removeCount = completedNodes.length - this.maxHistorySize
        completedNodes.splice(0, removeCount)
      }

      const nextNodeId = this.findNextNode(graph, currentNodeId, context, exec.result ?? null)

      if (nextNodeId === graph.exit) {
        currentNodeId = nextNodeId
        continue
      }

      if (currentNodeId === graph.exit) {
        break
      }

      currentNodeId = nextNodeId
    }

    if (iterations >= maxIterations) {
      const result = { success: false, completedNodes, context, iterations, error: "Max iterations exceeded" }
      this.emit("executionError", graphId, new Error("Max iterations exceeded"))
      this.emit("executionComplete", graphId, result)
      return result
    }

    const result = { success: true, completedNodes, context, iterations }
    this.emit("executionComplete", graphId, result)
    return result
  }

  /**
   * 根据条件和上下文找到下一个要执行的节点
   * 按边优先级排序，依次检查每条边的条件
   * @param graph 图
   * @param currentNodeId 当前节点ID
   * @param context 执行上下文
   * @param result 当前节点执行结果
   * @returns 下一个节点ID
   */
  private findNextNode(
    graph: ExecutionGraph,
    currentNodeId: string,
    context: Context,
    result: StrategyResult | null,
  ): string {
    let bestEdge: (typeof graph.edges)[0] | null = null
    let bestPriority = -Infinity

    for (const edge of graph.edges) {
      if (edge.from !== currentNodeId) continue
      if (edge.priority > bestPriority) {
        bestPriority = edge.priority
        bestEdge = edge
      }
    }

    if (!bestEdge) {
      if (currentNodeId !== graph.exit) {
        this.emit("orphanedNode", currentNodeId)
      }
      return graph.exit
    }

    if (evaluateCondition(bestEdge.condition, context, result)) {
      return bestEdge.to
    }

    return graph.exit
  }

  /**
   * 序列化图为JSON字符串
   * 用于持久化存储或网络传输
   * @param graphId 图ID
   * @returns JSON字符串，失败返回null
   */
  serializeGraph(graphId: string): string | null {
    const graph = this.graphs.get(graphId)
    if (!graph) return null

    return JSON.stringify({
      id: graph.id,
      name: graph.name,
      nodes: Array.from(graph.nodes.entries()),
      edges: graph.edges,
      entry: graph.entry,
      exit: graph.exit,
      metadata: graph.metadata,
    })
  }

  /**
   * 从JSON字符串反序列化图
   * @param data JSON字符串
   * @returns 反序列化后的图对象，失败返回null
   */
  deserializeGraph(data: string): ExecutionGraph | null {
    try {
      const parsed = JSON.parse(data)
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.id !== "string" ||
        typeof parsed.name !== "string" ||
        typeof parsed.entry !== "string" ||
        typeof parsed.exit !== "string" ||
        !Array.isArray(parsed.nodes) ||
        !Array.isArray(parsed.edges)
      ) {
        return null
      }
      const graph: ExecutionGraph = {
        id: parsed.id,
        name: parsed.name,
        nodes: new Map(parsed.nodes),
        edges: parsed.edges,
        entry: parsed.entry,
        exit: parsed.exit,
        metadata: parsed.metadata,
      }
      if (!graph.nodes.has(graph.entry) || !graph.nodes.has(graph.exit)) {
        console.error("[GraphEngine] Failed to deserialize graph: entry or exit node not found in nodes")
        return null
      }
      this.graphs.set(graph.id, graph)
      this.modifications.set(graph.id, [])
      return graph
    } catch (err) {
      console.error("[GraphEngine] Failed to deserialize graph:", err)
      return null
    }
  }
}
