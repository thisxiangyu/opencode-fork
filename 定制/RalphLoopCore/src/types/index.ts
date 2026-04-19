/**
 * 会话状态枚举
 * 用于标识策略执行的状态
 */
export enum StrategyState {
  IDLE = "idle", // 空闲状态 - 初始状态
  RUNNING = "running", // 执行中 - 正在执行策略
  PASS = "pass", // 通过 - 策略执行成功
  FAIL = "fail", // 失败 - 策略执行失败
  SKIP = "skip", // 跳过 - 策略被跳过
}

/**
 * 会话调度模式枚举
 * 控制策略的执行方式
 */
export enum SessionMode {
  SERIAL = "serial", // 串行模式：按顺序执行策略
  PARALLEL = "parallel", // 并行模式：同时执行多个策略（预留）
}

/**
 * 策略执行结果接口
 * 所有策略execute方法返回的对象结构
 */
export interface StrategyResult {
  step?: string // 步骤名称
  plan?: string // 计划内容
  executed?: string // 执行结果
  tests?: string // 测试结果
  feedback?: string // 反馈信息
  review?: string // 审核结果
  approved?: boolean // UE是否通过
  passed?: boolean // 审核是否通过
  status?: string // 状态描述
  error?: string // 错误信息
  [key: string]: unknown // 其他扩展字段
}

/**
 * 单步执行结果
 * step()方法返回的对象结构
 */
export interface ExecutionResult {
  step: number // 当前步骤索引
  strategy: string // 当前策略名称
  result: StrategyResult // 策略执行结果
  state: StrategyState // 执行状态
  cycle: number // 当前轮次
  done?: boolean // 是否完成
  error?: string // 错误信息
}

/**
 * 调度器状态
 * getStatus()方法返回的对象结构
 */
export interface RalphStatus {
  active: boolean // 会话是否激活
  mode: SessionMode // 当前调度模式
  currentStep: number // 当前步骤索引
  strategyCount: number // 策略数量
  cycleCount: number // 已完成轮次数
  strategies: string[] // 策略名称列表
}

/**
 * 执行上下文
 * 用于在策略之间传递数据
 */
export interface Context {
  task: string // 任务描述
  cycle: number // 当前轮次
  [key: string]: unknown // 其他扩展字段
}

/**
 * 步骤增强配置
 * 用于在特定步骤添加额外的提示词或配置
 */
export interface StepEnhancement {
  systemPrompt?: string // 增强的系统提示词
  agentHint?: string // Agent提示
  skipNext?: string[] // 要跳过的后续策略
}

/**
 * 节点执行记录
 * 图执行过程中单个节点的执行信息
 */
export interface NodeExecution {
  nodeId: string // 节点ID
  startTime: number // 开始时间戳
  endTime?: number // 结束时间戳
  result?: StrategyResult // 执行结果
  state: StrategyState // 执行状态
}

/**
 * 执行追踪
 * 完整的图执行过程记录
 */
export interface ExecutionTrace {
  executionId: string // 执行ID
  graphId: string // 图ID
  task: string // 任务描述
  startTime: number // 开始时间戳
  endTime?: number // 结束时间戳
  nodes: NodeExecution[] // 节点执行记录列表
  metrics: ExecutionMetrics // 执行指标
}

/**
 * 执行指标
 * 用于评估执行效果的多维度指标
 */
export interface ExecutionMetrics {
  totalDuration: number // 总耗时
  tokenUsage: number // Token消耗
  stepCount: number // 步骤数
  retryCount: number // 重试次数
  success: boolean // 是否成功
}

/**
 * 节点级指标
 * 单个节点的执行指标
 */
export interface NodeMetrics {
  duration: number // 执行耗时
  tokenUsage: number // Token消耗
}
