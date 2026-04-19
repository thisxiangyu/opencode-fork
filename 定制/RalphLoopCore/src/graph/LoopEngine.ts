import {
  LoopStrategy,
  LoopNode,
  LoopContext,
  LoopExecutionResult,
  LoopExecutionState,
  NodeExecutionRecord,
  NodeResult,
  TransitionResult,
  RoleInstance,
  evaluateTransitionCondition,
} from "./LoopStrategy.js"
import { StrategyState, StrategyResult } from "../types/index.js"
import { EventEmitter } from "events"
import { DEFAULT_TIMEOUT } from "../constants.js"

export interface LoopEngineEvents {
  nodeStart: (node: LoopNode, state: LoopExecutionState) => void
  nodeComplete: (node: LoopNode, result: NodeResult, state: LoopExecutionState) => void
  nodeError: (node: LoopNode, error: Error, state: LoopExecutionState) => void
  nodeCallbackError: (node: LoopNode, callbackType: "onEnter" | "onExit", error: Error) => void
  retryAttempt: (node: LoopNode, attempt: number, maxRetries: number, delay: number) => void
  cycleComplete: (cycle: number, context: LoopContext) => void
  transition: (from: string, to: string, result: TransitionResult, state: LoopExecutionState) => void
  complete: (result: LoopExecutionResult, state: LoopExecutionState) => void
  error: (error: Error, state: LoopExecutionState) => void
  paused: (node: LoopNode, reason: string) => void
  resumed: (node: LoopNode) => void
  waitingForDecision: (node: LoopNode, options: string[]) => void
  decisionMade: (node: LoopNode, selected: string) => void
}

export interface LoopEngineOptions {
  maxCycles?: number
  maxIterations?: number
  cycleDelay?: number
  onNodeExecute?: (node: LoopNode, context: LoopContext) => Promise<NodeResult> | NodeResult
  onRoleExecute?: (
    roleInstance: RoleInstance,
    node: LoopNode,
    context: LoopContext,
  ) => Promise<StrategyResult> | StrategyResult
}

export class LoopEngine extends EventEmitter {
  private maxHistorySize: number
  private strategy: LoopStrategy | null = null
  private state: LoopExecutionState = {
    active: false,
    currentNodeId: "",
    cycleCount: 0,
    iteration: 0,
    strategyId: "",
  }
  private context: LoopContext | null = null
  private executionHistory: NodeExecutionRecord[] = []
  private transitionHistory: TransitionResult[] = []
  private options: Required<LoopEngineOptions>
  private lockQueue: Array<() => void> = []
  private lockHeld = false
  private executing = false

  public dispose(): void {
    this.removeAllListeners()
    this.strategy = null
    this.context = null
    this.executionHistory = []
    this.transitionHistory = []
    this.lockQueue = []
    this.lockHeld = false
    this.executing = false
  }

  private readonly defaultNodeExecutor = async (node: LoopNode): Promise<NodeResult> => {
    return {
      nodeId: node.id,
      nodeName: node.name,
      status: "completed",
      executed: `Node ${node.name} executed with ${node.roles.length} role(s)`,
    }
  }

  private readonly defaultRoleExecutor = async (
    roleInstance: RoleInstance,
    _node: LoopNode,
    _context: LoopContext,
  ): Promise<StrategyResult> => {
    return {
      step: `role:${roleInstance.role.name}`,
      executed: `Role ${roleInstance.role.name} executed`,
      systemPrompt: roleInstance.role.systemPrompt,
      weight: roleInstance.weight,
      temperature: roleInstance.temperature,
      maxTokens: roleInstance.maxTokens,
      status: "completed",
    }
  }

  constructor(options: LoopEngineOptions = {}, maxHistorySize = 1000) {
    super()
    this.maxHistorySize = maxHistorySize
    this.options = {
      maxCycles: options.maxCycles ?? 100,
      maxIterations: options.maxIterations ?? 500,
      cycleDelay: options.cycleDelay ?? 0,
      onNodeExecute: options.onNodeExecute ?? this.defaultNodeExecutor,
      onRoleExecute: options.onRoleExecute ?? this.defaultRoleExecutor,
    }
  }

  loadStrategy(strategy: LoopStrategy): this {
    this.strategy = strategy
    this.state.strategyId = strategy.id
    return this
  }

  getStrategy(): LoopStrategy | null {
    return this.strategy
  }

  getState(): LoopExecutionState {
    return { ...this.state }
  }

  getContext(): LoopContext {
    return this.context ? { ...this.context } : ({} as LoopContext)
  }

  getExecutionHistory(): NodeExecutionRecord[] {
    return [...this.executionHistory]
  }

  getCurrentNode(): LoopNode | null {
    if (!this.strategy || !this.state.currentNodeId) return null
    return this.strategy.nodes.find((n) => n.id === this.state.currentNodeId) ?? null
  }

  jumpTo(nodeId: string): this {
    this.state.pendingJump = nodeId
    return this
  }

  pause(reason: string = "user_requested"): this {
    this.state.paused = true
    const node = this.getCurrentNode()
    if (node) {
      this.emit("paused", node, reason)
    }
    return this
  }

  resume(): this {
    if (!this.state.paused) return this
    this.state.paused = false
    const node = this.getCurrentNode()
    if (node) {
      this.emit("resumed", node)
    }
    return this
  }

  stop(immediate: boolean = false): void {
    this.state.active = false
    if (immediate) {
      this.state.paused = false
      this.state.pendingJump = null
    }
  }

  isPaused(): boolean {
    return this.state.paused ?? false
  }

  isWaitingForDecision(): boolean {
    return this.state.waitingForDecision ?? false
  }

  waitForDecision(options: string[]): void {
    this.state.waitingForDecision = true
    const node = this.getCurrentNode()
    if (node) {
      this.emit("waitingForDecision", node, options)
    }
  }

  resolveDecision(targetNodeId: string): void {
    this.state.waitingForDecision = false
    this.state.pendingJump = targetNodeId
    const node = this.getCurrentNode()
    if (node) {
      this.emit("decisionMade", node, targetNodeId)
    }
  }

  async execute(initialContext: Record<string, unknown> = {}): Promise<LoopExecutionResult> {
    if (!this.strategy) {
      throw new Error("No strategy loaded")
    }

    if (this.executing) {
      throw new Error("Engine is already executing")
    }
    this.executing = true

    this.state = {
      active: true,
      currentNodeId: this.strategy.entryNode,
      cycleCount: 0,
      iteration: 0,
      strategyId: this.strategy.id,
    }

    this.context = {
      task: (initialContext.task as string) ?? "",
      cycle: 0,
      currentNodeId: this.strategy.entryNode,
      cycleCount: 0,
      totalIterations: 0,
      nodeResults: {},
      transitionHistory: [],
      ...initialContext,
    } as LoopContext

    this.executionHistory = []
    this.transitionHistory = []

    try {
      const result = await this.executeLoop()
      this.state.active = false
      this.emit("complete", result, this.state)
      return result
    } catch (error) {
      this.state.active = false
      const errorResult: LoopExecutionResult = {
        success: false,
        completedNodes: this.executionHistory,
        context: this.context!,
        totalCycles: this.state.cycleCount,
        totalIterations: this.state.iteration,
        error: error instanceof Error ? error.message : String(error),
        transitions: this.transitionHistory,
      }
      this.emit("error", error instanceof Error ? error : new Error(String(error)), this.state)
      return errorResult
    } finally {
      this.executing = false
    }
  }

  private async executeLoop(): Promise<LoopExecutionResult> {
    const strategy = this.strategy!
    let currentNodeId = strategy.entryNode
    const onStack: Set<string> = new Set()

    while (this.state.active && this.state.iteration < this.options.maxIterations) {
      this.state.iteration++
      this.state.currentNodeId = currentNodeId

      if (onStack.has(currentNodeId)) {
        return this.buildResult(false, currentNodeId, `Cycle detected at node ${currentNodeId}`)
      }

      onStack.add(currentNodeId)

      const node = strategy.nodes.find((n) => n.id === currentNodeId)
      if (!node) {
        return this.buildResult(false, currentNodeId, `Node ${currentNodeId} not found`)
      }

      this.emit("nodeStart", node, this.state)

      const record = await this.executeNodeWithRetry(node)
      this.executionHistory.push(record)
      if (this.executionHistory.length > this.maxHistorySize) {
        this.executionHistory = this.executionHistory.slice(-this.maxHistorySize)
      }

      if (record.state === StrategyState.FAIL) {
        this.emit("nodeError", node, new Error(record.error ?? "Node execution failed"), this.state)
        return this.buildResult(false, currentNodeId, record.error)
      }

      this.context!.nodeResults[currentNodeId] = record.result!
      this.emit("nodeComplete", node, record.result!, this.state)

      while (this.state.waitingForDecision && this.state.active) {
        await this.sleep(100)
        if (this.state.pendingJump) break
      }

      if (this.state.pendingJump) {
        currentNodeId = this.state.pendingJump
        this.state.pendingJump = null
        this.emit("transition", currentNodeId, currentNodeId, { matched: true, targetNode: currentNodeId }, this.state)
        onStack.delete(currentNodeId)
        currentNodeId = currentNodeId
        continue
      }

      const transitionResult = this.findNextTransition(currentNodeId, record.result!)
      this.transitionHistory.push(transitionResult)
      this.context!.transitionHistory.push(transitionResult)
      if (this.transitionHistory.length > this.maxHistorySize) {
        this.transitionHistory = this.transitionHistory.slice(-this.maxHistorySize)
      }

      if (!transitionResult.matched) {
        if (strategy.exitNodes.includes(currentNodeId)) {
          return this.buildResult(true, currentNodeId)
        }
        return this.buildResult(false, currentNodeId, "No matching transition found")
      }

      const nextNodeId = transitionResult.targetNode ?? strategy.exitNodes[0]
      this.emit("transition", currentNodeId, nextNodeId, transitionResult, this.state)

      onStack.delete(currentNodeId)

      if (nextNodeId === strategy.entryNode) {
        this.state.cycleCount++
        this.context!.cycleCount = this.state.cycleCount
        this.context!.cycle = this.state.cycleCount
        this.emit("cycleComplete", this.state.cycleCount, this.context!)
        if (this.state.cycleCount >= this.options.maxCycles) {
          return this.buildResult(true, currentNodeId, "Max cycles exceeded")
        }
        if (this.options.cycleDelay > 0) {
          await new Promise((r) => setTimeout(r, this.options.cycleDelay))
        }
      }

      currentNodeId = nextNodeId
    }

    return this.buildResult(
      false,
      currentNodeId,
      this.state.iteration >= this.options.maxIterations ? "Max iterations exceeded" : "Loop ended",
    )
  }

  private async executeNode(node: LoopNode): Promise<NodeExecutionRecord> {
    const startTime = Date.now()
    const record: NodeExecutionRecord = {
      nodeId: node.id,
      nodeName: node.name,
      cycle: this.state.cycleCount,
      iteration: this.state.iteration,
      startTime,
      state: StrategyState.RUNNING,
      rolesExecuted: [],
    }

    try {
      try {
        node.onEnter?.(this.context!)
      } catch (err) {
        this.emit("nodeCallbackError", node, "onEnter", err instanceof Error ? err : new Error(String(err)))
      }

      const roleResults: Record<string, StrategyResult> = {}

      if (node.roles.length > 0) {
        const expandedRoles: RoleInstance[] = []
        for (const roleInstance of node.roles) {
          const count = roleInstance.count ?? 1
          for (let i = 0; i < count; i++) {
            const instance: RoleInstance =
              count > 1
                ? { ...roleInstance, role: { ...roleInstance.role, id: `${roleInstance.role.id}_${i}` } }
                : roleInstance
            expandedRoles.push(instance)
          }
        }

        if (node.config.parallel && expandedRoles.length > 1) {
          const settleResults = await Promise.allSettled(expandedRoles.map((role) => this.executeRole(role, node)))
          let hasFailure = false
          settleResults.forEach((settled, i) => {
            if (settled.status === "fulfilled") {
              roleResults[expandedRoles[i].role.id] = settled.value
              record.rolesExecuted.push(expandedRoles[i].role.id)
            } else {
              hasFailure = true
              roleResults[expandedRoles[i].role.id] = {
                status: "failed",
                error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
              }
              record.rolesExecuted.push(expandedRoles[i].role.id)
            }
          })
          if (hasFailure && !node.config.continueOnError) {
            const failedCount = settleResults.filter((r) => r.status === "rejected").length
            record.state = StrategyState.FAIL
            record.error = `${failedCount} role(s) failed`
          }
        } else {
          for (const role of expandedRoles) {
            const roleResult = await this.executeRole(role, node)
            roleResults[role.role.id] = roleResult
            record.rolesExecuted.push(role.role.id)
            if (roleResult.error && !node.config.continueOnError) {
              break
            }
          }
        }
      } else {
        const nodeResult = await this.options.onNodeExecute(node, this.context!)
        roleResults["_node"] = nodeResult
        record.rolesExecuted.push(node.id)
      }

      const combinedResult: NodeResult = {
        nodeId: node.id,
        nodeName: node.name,
        status: "completed",
        roleResults,
      }

      record.result = combinedResult
      record.endTime = Date.now()
      record.state = StrategyState.PASS

      try {
        node.onExit?.(this.context!, record.result)
      } catch (err) {
        this.emit("nodeCallbackError", node, "onExit", err instanceof Error ? err : new Error(String(err)))
      }

      return record
    } catch (error) {
      record.endTime = Date.now()
      record.state = StrategyState.FAIL
      record.error = error instanceof Error ? error.message : String(error)
      return record
    }
  }

  private async executeNodeWithRetry(node: LoopNode): Promise<NodeExecutionRecord> {
    const maxRetries = node.config.retryable ? (node.config.maxRetries ?? 3) : 0
    let lastError: Error | undefined
    let lastRecord: NodeExecutionRecord | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastRecord = await this.executeNode(node)

      if (lastRecord.state !== StrategyState.FAIL) {
        return lastRecord
      }

      lastError = lastRecord.error ? new Error(lastRecord.error) : undefined

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 100
        this.emit("retryAttempt", node, attempt + 1, maxRetries, delay)
        await this.sleep(delay)
      }
    }

    return lastRecord!
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async executeRole(roleInstance: RoleInstance, node: LoopNode): Promise<StrategyResult> {
    await this.acquireLock()
    try {
      const timeout = node.config.timeout ?? DEFAULT_TIMEOUT
      const result = await Promise.race([
        this.options.onRoleExecute(roleInstance, node, this.context!),
        new Promise<StrategyResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Role ${roleInstance.role.name} timed out after ${timeout}ms`)), timeout),
        ),
      ])
      return result
    } finally {
      this.releaseLock()
    }
  }

  private acquireLock(): Promise<void> {
    if (!this.lockHeld) {
      this.lockHeld = true
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.lockQueue.push(resolve)
    })
  }

  private releaseLock(): void {
    const next = this.lockQueue.shift()
    if (next) {
      next()
    } else {
      this.lockHeld = false
    }
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj))
  }

  private findNextTransition(currentNodeId: string, result: NodeResult): TransitionResult {
    const strategy = this.strategy!
    const outgoing = strategy.transitions.filter((t) => t.from === currentNodeId)

    if (outgoing.length === 0) {
      return { matched: false }
    }

    const sorted = [...outgoing].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const transition of sorted) {
      if (evaluateTransitionCondition(transition.condition, this.context!, result)) {
        return {
          matched: true,
          targetNode: transition.to,
          action: transition.action,
        }
      }
    }

    return { matched: false }
  }

  private buildResult(success: boolean, exitNode: string, error?: string): LoopExecutionResult {
    return {
      success,
      completedNodes: this.executionHistory,
      context: this.context!,
      totalCycles: this.state.cycleCount,
      totalIterations: this.state.iteration,
      exitNode,
      error,
      transitions: this.transitionHistory,
    }
  }

  reset(): void {
    this.state = {
      active: false,
      currentNodeId: "",
      cycleCount: 0,
      iteration: 0,
      strategyId: this.strategy?.id ?? "",
    }
    this.context = null
    this.executionHistory = []
    this.transitionHistory = []
  }
}
