/**
 * PEE 工具函数模块
 *
 * 包含所有纯函数。
 */

import { INTERRUPTION_REASON, type InterruptedMsgContext } from "../../common/types"

export type 稀疏任务动态映射 = Record<string, string>

// ============== JSON 解析 ==============

/**
 * 从原始文本中提取第一个平衡的 `{...}` JSON 字符串。
 */
export function extractFirstJSON(raw: string): string | null {
  const start = raw.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{") depth++
    if (ch === "}") { depth--; if (depth === 0) return raw.slice(start, i + 1) }
  }
  return null
}

/**
 * 从模型原始输出中提取 JSON 对象。
 */
export function extractJSON(raw: string): Record<string, any> | null {
  try { const v = JSON.parse(raw.trim()); if (typeof v === "object" && v !== null) return v } catch {}
  const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlock && codeBlock[1]) {
    try { const v = JSON.parse(codeBlock[1].trim()); if (typeof v === "object" && v !== null) return v } catch {}
  }
  const candidate = extractFirstJSON(raw)
  if (candidate) {
    try { const v = JSON.parse(candidate); if (typeof v === "object" && v !== null) return v } catch {}
  }
  return null
}

// ============== 打回状态管理 ==============

export interface RejectionState {
  evaluatorRejections: number
  architectRejections: number
  executorPractices: number
  totalRejectionLoops: number
  inRejectionLoop: boolean
  rejectionSource?: "evaluator" | "architect"
  executorFeedback?: string
  frozenPlannerInfo?: string
  compactorUpstream?: string
  /** 上一轮完整任务视图（用于压缩决策员比较任务翻新度） */
  previousPlannerInfo?: string
}

export function createRejectionState(): RejectionState {
  return {
    evaluatorRejections: 0,
    architectRejections: 0,
    executorPractices: 0,
    totalRejectionLoops: 0,
    inRejectionLoop: false,
  }
}

export function resetRejectionState(state: RejectionState): void {
  state.evaluatorRejections = 0
  state.architectRejections = 0
  state.executorPractices = 0
  state.totalRejectionLoops = 0
  state.inRejectionLoop = false
  state.rejectionSource = undefined
  state.executorFeedback = undefined
  state.frozenPlannerInfo = undefined
  state.compactorUpstream = undefined
  state.previousPlannerInfo = undefined
}

// ============== upstream 构建 ==============

/**
 * 生成打回循环的 upstream 信息
 */
export function buildRejectionUpstream(state: RejectionState): string {
  const parts: string[] = ["正在协作优化中"]
  if (state.executorFeedback?.trim()) {
    parts.push(`执行反馈: ${state.executorFeedback.trim()}`)
  }
  if (state.evaluatorRejections > 0) {
    parts.push(`评估者第${state.evaluatorRejections}次打回`)
  }
  if (state.architectRejections > 0) {
    parts.push(`架构师第${state.architectRejections}次打回`)
  }
  if (state.executorPractices > 0) {
    parts.push(`执行者第${state.executorPractices}次实践`)
  }
  return parts.join("  ")
}

/**
 * 构建压缩决策员专用 upstreamMsg。
 * 格式：上轮任务视图 + 本轮任务视图
 *
 * @param frozenPlannerInfo - 规划者输出的完整 upstream（包含本轮任务标题、描述、Tag）
 * @param previousPlannerInfo - 上一轮完整任务视图（用于判断任务翻新度）
 */
export function buildCompactorUpstream(
  frozenPlannerInfo: string | undefined,
  previousPlannerInfo?: string
): string {
  if (!frozenPlannerInfo) return ""

  const buildTaskSnapshot = (label: string, plannerInfo: string) => {
    const 标题 = plannerInfo.match(/本轮任务标题[：:]\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? ""
    const 描述 = plannerInfo.match(/描述[：:]\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? ""
    const tag = plannerInfo.match(/Tag[：:]\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? ""
    const 描述摘要 = 描述 ? 描述.slice(0, 60) : ""

    let snapshot = `${label}标题: ${标题}\n`
    if (tag) snapshot += `${label}Tag: ${tag}\n`
    if (描述摘要) snapshot += `${label}任务描述前60字: ${描述摘要}\n`
    return snapshot
  }

  let upstream = ""
  if (previousPlannerInfo) upstream += buildTaskSnapshot("上轮任务", previousPlannerInfo)
  upstream += buildTaskSnapshot("本轮任务", frozenPlannerInfo)
  return upstream
}

/**
 * 构建通用 upstream（用于执行者、评估者、架构师、质保员、边缘质保员）。
 *
 * 结构：前情 + 本轮任务标题 + 描述 + Tag +
 *       上层依赖任务(标题 + Tag + 动态) + 当前任务动态 + 留言
 */
export function buildCommonUpstream(
  plannerOutput: Record<string, any>,
  taskInfo: {
    任务描述?: string
    Tag?: string[]
    当前动态?: { 角色: string; 消息: string }[]
  },
  dependencyInfo?: Array<{
    依赖任务标题: string
    依赖任务Tag?: string[]
    依赖任务动态?: { 角色: string; 消息: string }[]
  }>
): string {
  const 本轮任务标题 = typeof plannerOutput.本轮任务标题 === "string" ? plannerOutput.本轮任务标题.trim() : ""
  const 留言 = typeof plannerOutput.留言 === "string" ? plannerOutput.留言 : ""

  let upstream = ""

  // 本轮任务标题
  upstream += `本轮任务标题: ${本轮任务标题}\n`

  // 当前任务描述
  if (taskInfo.任务描述) upstream += `描述: ${taskInfo.任务描述}\n`

  // 当前任务 Tag
  if (taskInfo.Tag && taskInfo.Tag.length > 0) upstream += `Tag: ${taskInfo.Tag.join(", ")}\n`

  // 上层依赖任务信息（只一层）
  if (dependencyInfo && dependencyInfo.length > 0) {
    upstream += `\n上层依赖任务：\n`
    for (const dependency of dependencyInfo) {
      upstream += `${dependency.依赖任务标题}\n`
      if (dependency.依赖任务Tag && dependency.依赖任务Tag.length > 0) {
        upstream += `  Tag: ${dependency.依赖任务Tag.join(", ")}\n`
      }
      if (dependency.依赖任务动态 && dependency.依赖任务动态.length > 0) {
        const 动态摘要 = dependency.依赖任务动态
          .slice(-5)
          .map((d: { 角色: string; 消息: string }) => `[${d.角色}: ${d.消息}]`)
          .join(" | ")
        upstream += `  动态: ${动态摘要}\n`
      }
    }
  } else {
    upstream += `\n上层依赖任务: 无\n`
  }

  // 当前任务的动态
  if (taskInfo.当前动态 && taskInfo.当前动态.length > 0) {
    upstream += `\n当前任务动态：\n`
    for (const dyn of taskInfo.当前动态) {
      upstream += `[${dyn.角色}: ${dyn.消息}]\n`
    }
  }

  // 留言
  if (留言) upstream += `\n留言: ${留言}\n`

  return upstream
}

/**
 * 基于规划图 CLI 查询结果构建通用 upstream。
 *
 * 供真实主循环使用，也作为测试直接命中的格式化入口。
 */
export function buildCommonUpstreamFromTaskQuery(
  plannerOutput: Record<string, any>,
  task?: {
    任务描述?: string
    Tag?: string[]
    动态?: { 角色: string; 消息: string }[]
  },
  dependencyChain?: Array<{
    层: number
    依赖: Array<{
      标题: string
      Tag?: string[]
      动态?: { 角色: string; 消息: string }[]
    }>
  }>,
): string {
  return buildCommonUpstream(
    plannerOutput,
    {
      任务描述: task?.任务描述,
      Tag: task?.Tag,
      当前动态: task?.动态,
    },
    dependencyChain?.[0]?.依赖
      ?.map((dependency) => ({
        依赖任务标题: dependency.标题,
        依赖任务Tag: dependency.Tag,
        依赖任务动态: dependency.动态,
      }))
      .filter((dependency) => dependency.依赖任务标题.trim().length > 0),
  )
}

/**
 * 构建提交员专用 upstream。
 * 仅传递「当前任务标题 + 当前任务所有 Tag」
 *
 * 使用结构化解析：先按"上层依赖任务"分段，只从当前任务部分提取Tag，
 * 避免因依赖任务也有Tag而误取。
 */
export function buildCommitmanUpstream(frozenPlannerInfo: string | undefined): string {
  if (!frozenPlannerInfo) return ""

  // 按"上层依赖任务"分段，当前任务内容在第一段
  const segments = frozenPlannerInfo.split(/\n上层依赖任务[：:]?\n/)
  const currentTaskSection = segments[0] || ""

  // 提取本轮任务标题
  const 标题Match = currentTaskSection.match(/本轮任务标题[：:]\s*(.+?)(?:\n|$)/)
  const 标题 = 标题Match ? 标题Match[1].trim() : ""

  // 从当前任务部分提取 Tag（避免误取依赖任务的 Tag）
  const tagMatch = currentTaskSection.match(/Tag[：:]\s*(.+?)(?:\n|$)/)
  const tagStr = tagMatch ? tagMatch[1].trim() : ""

  let upstream = ""
  if (标题) upstream += `标题: ${标题}\n`
  if (tagStr) upstream += `Tag: ${tagStr}\n`

  return upstream
}

/**
 * 根据角色类型构建对应的 upstream。
 * 整合以上所有 upstream 构建逻辑。
 */
export function buildUpstreamForRole(
  roleName: string,
  rejectionState: RejectionState,
  lastResponse: string
): string {
  // 打回循环中
  if (rejectionState.inRejectionLoop) {
    if (roleName === "executor") {
      return lastResponse // 执行者使用完整打回 JSON
    }
    // 其他角色使用打回循环信息
    return buildRejectionUpstream(rejectionState)
  }

  // 正常流程
  if (roleName === "planner") {
    // 规划者仅接收 roundInfo（空字符串，roundInfo 在 msgToBeSent 层面前置）
    return ""
  }

  if (roleName === "compactor" && rejectionState.compactorUpstream) {
    return rejectionState.compactorUpstream
  }

  if (roleName === "Commitman" && rejectionState.frozenPlannerInfo) {
    return buildCommitmanUpstream(rejectionState.frozenPlannerInfo)
  }

  if (rejectionState.frozenPlannerInfo) {
    return rejectionState.frozenPlannerInfo
  }

  return lastResponse
}

/**
 * 归一化评估者/架构师传给执行者的打回上游信息。
 *
 * 当前约定直接透传完整问题 JSON；若未解析到 JSON，则保守回退为原始响应。
 */
export function extractRejectionUpstream(rawResponse: string): string {
  const json = extractJSON(rawResponse)
  if (json) return JSON.stringify(json)
  return rawResponse
}

/**
 * 基于当前角色输出与最新打回状态，推导是否需要写入系统级打回动态。
 *
 * 注意：应在主循环完成跳转判定（计数已递增）之后调用，确保首次记录为“1次”。
 */
export function getRejectionActivityToRecord(
  roleName: string,
  response: string,
  rejectionState: RejectionState,
): { roleName: "evaluator" | "architect"; rejectionCount: number } | null {
  const json = extractJSON(response)
  if (json?.检查结果 !== "打回") return null

  if (roleName === "evaluator") {
    return { roleName: "evaluator", rejectionCount: rejectionState.evaluatorRejections }
  }

  if (roleName === "architect") {
    return { roleName: "architect", rejectionCount: rejectionState.architectRejections }
  }

  return null
}

// ============== 角色名称映射 ==============

/**
 * 获取"检查-修复-汇报"型角色在规划图中的标准名称。
 */
export function normalizeRoleName(currentRoleName: string): string {
  if (currentRoleName === "ScissorHands") return "ScissorHands"
  if (currentRoleName === "QA") return "QA"
  if (currentRoleName === "EdgeQA") return "EdgeQA"
  return currentRoleName
}

export function shouldRoleInterveneThisRound(介入间隔: number, cycle: number): boolean {
  if (介入间隔 === 0) return true
  if (cycle === 0) return true
  return cycle % 介入间隔 === 0
}

// ============== roundInfo 构建 ==============

/**
 * 构建 roundInfo 字符串。
 */
export function buildRoundInfo(cycle: number, maxCycles: number): string {
  const now = new Date()
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
  return `当前时间：${timeStr}，第${cycle + 1}轮/共${maxCycles}轮\n\n`
}

export function buildRoundInfoWithSparseScope(
  cycle: number,
  maxCycles: number,
  _角色名: string,
  介入间隔: number,
  任务动态映射: 稀疏任务动态映射,
): string {
  const base = buildRoundInfo(cycle, maxCycles)
  if (介入间隔 === 0) return base
  const entries = Object.entries(任务动态映射)
  if (entries.length === 0) {
    return base + `自你上次介入以来，暂无新增任务。请结合当前未提交变更和最近几次提交，自行判断是否还有值得检查的地方。\n\n`
  }
  const scope = entries
    .map(([任务标题, 一句话动态]) => `- ${任务标题}: ${一句话动态}`)
    .join("\n")
  return base + `下面这些任务是自你上次介入以来新增的，请重点检查它们：\n${scope}\n\n`
}

// ============== 消息内容构建 =============

/**
 * 构建发送给角色的完整消息。
 * 整合 roundInfo、knowledgeDomainPrompt、systemPrompt。
 */
export function buildMsgToBeSent(
  roundInfo: string,
  knowledgeDomainPrompt: string,
  systemPrompt: (upstream: string) => string,
  upstreamMsg: string,
  shouldActivateKnowledge: boolean,
  roundInfoSuffix = "",
): string {
  const messagePrefix = roundInfo + roundInfoSuffix
  if (shouldActivateKnowledge) {
    // 【重要】roundInfo 必须传递给所有角色
    return messagePrefix + knowledgeDomainPrompt + "\n" + systemPrompt(upstreamMsg)
  } else {
    return messagePrefix + systemPrompt(upstreamMsg)
  }
}

// ============== 中断处理 ==============

export function isDispatchableInterruption(reason: InterruptedMsgContext["reason"]): boolean {
  return (
    reason === INTERRUPTION_REASON.pause ||
    reason === INTERRUPTION_REASON.new_message ||
    reason === INTERRUPTION_REASON.rollback
  )
}

export function takeLatestDispatchableInterruption(queue: InterruptedMsgContext[]): InterruptedMsgContext | null {
  for (let index = queue.length - 1; index >= 0; index--) {
    const item = queue[index]
    if (!item) continue
    if (!isDispatchableInterruption(item.reason)) continue
    queue.length = 0
    return item
  }
  return null
}

export function enqueueRollbackInterruption(
  queue: InterruptedMsgContext[],
  roleName: string,
  lastResponse: string,
  resumedResponse: string,
  timestamp = new Date(),
): InterruptedMsgContext[] {
  if (queue.some((item) => item.reason === INTERRUPTION_REASON.rollback)) return queue
  queue.push({
    roleName,
    beforeMessage: lastResponse || "（无）",
    receivedMessage: resumedResponse,
    timestamp,
    reason: INTERRUPTION_REASON.rollback,
  })
  return queue
}

export interface ResumedValidationPlan {
  currentRoleName: string
  resumedResponse: string
}

/**
 * 规划中断恢复后的角色语义：先回到被中断角色完成正常校验与后处理。
 * 下游派发目标必须等验证通过、默认跳转角色算出后，再允许用户覆盖。
 *
 * 注意：这里故意不携带 fallbackRole / selectedNextRole。
 * 中断时收到的 resumedResponse 还没有经过角色自己的 validateOutput，规划者还没有经过规划图派发验证；
 * 提前记录下游角色会让“用户选择派发目标”发生在“确认消息合法”之前。
 */
export function planResumedValidation(
  interruptedRoleName: string,
  resumedResponse: string,
): ResumedValidationPlan {
  return {
    currentRoleName: interruptedRoleName,
    resumedResponse,
  }
}

// ============== 依赖验证 ==============

export interface TaskDependency {
  依赖任务ID?: number
  依赖任务?: string
  原因?: string
}

export interface TaskStatus {
  已删除?: boolean
  是否完成?: boolean
}

export function getDependencyDisplayName(dependency: TaskDependency, resolvedTitle?: string): string {
  if (dependency.依赖任务?.trim()) return dependency.依赖任务.trim()
  if (resolvedTitle?.trim()) return resolvedTitle.trim()
  if (dependency.依赖任务ID) return `ID:${dependency.依赖任务ID}`
  return "（未知依赖）"
}

/**
 * 验证依赖是否有效（只检查一层）。
 */
export function validateDependencies(
  taskTitle: string,
  dependencies: TaskDependency[],
  getTaskStatus: (key: string) => TaskStatus | undefined
): { valid: boolean; error?: string } {
  // 检查依赖项结构
  for (let i = 0; i < dependencies.length; i++) {
    const dep = dependencies[i]
    if (!dep || (!dep.依赖任务?.trim() && !dep.依赖任务ID)) {
      return {
        valid: false,
        error: `任务"${taskTitle}"的第${i + 1}条依赖缺少"依赖任务"或"依赖任务ID"`
      }
    }
  }

  // 检查依赖是否完成（只检查一层）
  for (const dep of dependencies) {
    const key = dep.依赖任务ID ? `id:${dep.依赖任务ID}` : `title:${dep.依赖任务}`
    const status = getTaskStatus(key)
    const title = getDependencyDisplayName(dep)

    if (!status) {
      return { valid: false, error: `任务"${title}"不存在` }
    }
    if (status.已删除) {
      return { valid: false, error: `任务"${title}"已被删除` }
    }
    if (!status.是否完成) {
      return { valid: false, error: `任务"${title}"未完成` }
    }
  }

  return { valid: true }
}
