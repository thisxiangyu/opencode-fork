/**
 * PEE是隐式地将【决策】包含在"规划"当中的，即规划者同时承担决策职责（coo和ceo同体，类似于早期创业公司的组织形态，缺点是，对于开放式决策缺乏慢思考），
 * 适合不需要开放式决策、以封闭式决策为主的项目。
 */
import { consoleAndLogFile, LOG_DIR, logFile, LOG_COLOR } from "../../common/logger"
import { Database } from "bun:sqlite"
import { join } from "path"
import { AskTo重新定位角色, 检查names重复, type IRole } from "../../common/role"
import { LoopConfig } from "../../common/loopConfig"
import { AbortError, INTERRUPTION_REASON, type InterruptedMessage, MSG_SOURCE } from "../../common/types"
import type { ISession } from "../../common/session"
import { linkBackend,createSession, selectOrCreateSession } from "../../common/adapters/opencodeAdapter"
import { formatDateTime, IS_TEST } from "../../common/system"

const config = new LoopConfig({ maxCycles: 3 })

class 任务 {
  标题?: string
  父任务标题?: string | null
  Tag?: string[]
  任务描述?: string
  是否完成: boolean = false
  创建时间UTC?: string
  优先级序号?: number
  依赖?: string
  已删除: boolean = false
}

class 任务依赖 {
  "依赖任务": string
  "原因": string
}

export const 任务Tag={
  ADD: "add",
  FEAT: "feat",
  FIX: "fix",
  REFACTOR: "refactor",
  CHORE: "chore",
  ADJUST: "adjust",
  REVERT: "revert",
  TEST: "test",
  EXPLORE: "explore",
  MERGE: "merge",
  MILESTONE: "milestone",
} as const

export type 任务Tag = typeof 任务Tag[keyof typeof 任务Tag]

type 任务操作结果 = {
  成功: boolean
  消息: string
  res任务?: 任务
}

export const 任务树一次性聚焦数量上限 = 100

export function 当前表中全部任务数(): number {
  const result = db.query("SELECT COUNT(*) as count FROM 任务表 WHERE 是否删除 = 0").get() as { count: number }
  return result?.count ?? 0
}

export function 当前表中总任务数_仅末端(): number {
  const result = db.query("SELECT COUNT(*) as count FROM 任务表 WHERE 是否删除 = 0 AND 标题 NOT IN (SELECT DISTINCT 父任务标题 FROM 任务表 WHERE 是否删除 = 0 AND 父任务标题 IS NOT NULL)").get() as { count: number }
  return result?.count ?? 0
}

// 根任务：没有父任务的任务
export function 加载根任务(): 任务[] {
  const rows = db.query(
    "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务标题 IS NULL ORDER BY 优先级序号 ASC"
  ).all() as 任务[]
  return rows
}

function 插入任务并更新同级优先级(
  父任务标题: string | null,
  新任务优先级序号: number,
): void {
  if (父任务标题 === null) {
    // 插入根任务
    db.query(
      "UPDATE 任务表 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务标题 IS NULL AND 优先级序号 >= ?"
    ).run(新任务优先级序号)
  } else {
    // 插入非根子任务
    db.query(
      "UPDATE 任务表 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务标题 = ? AND 优先级序号 >= ?"
    ).run(父任务标题, 新任务优先级序号)
  }
}

// 里程碑任务：父任务是根任务的关键次级任务
// 返回里程碑任务Tag，如果不是里程碑任务则返回null
function 检测里程碑(父任务标题: string | null): 任务Tag | null {
  if (父任务标题 === null) return null
  const parent = db.query("SELECT 父任务标题 FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(父任务标题) as { 父任务标题: string | null } | undefined
  if (parent?.父任务标题 === null) {
    return 任务Tag.MILESTONE
  }
  return null
}

const dbFileName = IS_TEST ? "tasksDrivenMPEE_Test.db" : "tasksDrivenMPEE.db"
export const 任务表dbPath = join(import.meta.dirname!, "data", dbFileName)
export const db = new Database(任务表dbPath)
db.run(`
  CREATE TABLE IF NOT EXISTS 任务表 (
    标题 TEXT PRIMARY KEY,
    父任务标题 TEXT,
    Tag TEXT NOT NULL,
    任务描述 TEXT NOT NULL,
    是否完成 INTEGER DEFAULT 0,
    创建时间UTC TEXT NOT NULL,
    优先级序号 INTEGER DEFAULT 0,
    依赖 TEXT,
    是否删除 INTEGER DEFAULT 0
  )
`)

const 任务表 = {

  添加任务(
    添加到哪个父任务之下: string | null,
    任务描述: string,
    标题: string,
    优先级序号: number = 0,
    任务类型Tag: 任务Tag,
    依赖: 任务依赖[] = [],
    其它Tag: string[] = [],
  ): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    if (!任务描述 || !任务描述.trim()) return { 成功: false, 消息: "任务描述不能为空" }
    if (添加到哪个父任务之下 !== null) {
      const parent = db.query("SELECT 标题 FROM 任务表 WHERE 标题 = ?").get(添加到哪个父任务之下)
      if (!parent) return { 成功: false, 消息: `父任务「${添加到哪个父任务之下}」不存在` }
    }
    const existing = db.query("SELECT 标题 FROM 任务表 WHERE 标题 = ?").get(标题trim)
    if (existing) return { 成功: false, 消息: `标题「${标题trim}」已存在` }
    const mileStone = 检测里程碑(添加到哪个父任务之下)
    const 所有Tag = [...new Set([其它Tag, 任务类型Tag, mileStone].flat().filter((t): t is string => t !== null))]
    if (所有Tag.length === 0) return { 成功: false, 消息: "至少需要一个Tag" }
    插入任务并更新同级优先级(添加到哪个父任务之下, 优先级序号)
    const 创建时间UTC = new Date().toISOString()
    const newOne: 任务 = {
      标题: 标题trim,
      父任务标题: 添加到哪个父任务之下,
      Tag: 所有Tag,
      任务描述: 任务描述.trim(),
      是否完成: false,
      创建时间UTC,
      优先级序号,
      依赖: JSON.stringify(依赖),
      已删除: false,
    }
    const isRoot = 添加到哪个父任务之下 === null
    db.query(
      "INSERT INTO 任务表 (标题, 父任务标题, Tag, 任务描述, 是否完成, 创建时间UTC, 优先级序号, 依赖, 是否删除) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)"
    ).run(newOne.标题!, newOne.父任务标题 ?? null, JSON.stringify(newOne.Tag), newOne.任务描述!, newOne.创建时间UTC!, newOne.优先级序号!, newOne.依赖 ?? null)
    const 任务类型 = isRoot ? "根任务" : "子任务"
    const 父任务信息 = isRoot ? "" : `（父任务：${添加到哪个父任务之下}）`
    return { 成功: true, 消息: `已添加${任务类型}「${标题trim}」${父任务信息}（优先级：${优先级序号}）`, res任务: newOne }
  },
}

// 跟知识域提示词一起在会话开始时发送
const 团队Prompt = `我们项目的团队成员包括：manager、planner、executor、evaluator、QA。
工作以’规划->执行->测评‘循环进行，总共干${config.maxCycles}轮。工作目标通过【任务表】的方式来具体化和跟踪。`

const 执行者调度器: {
  可调度的执行者: 执行者[];

} = {
  可调度的执行者: [],
};

interface I读取任务表
{
  任务表Prompt(): string;
}


export class 规划者 implements IRole, I读取任务表 {
  memory?: string | undefined
  name = "planner"
  knowledgeDomainPrompt() { return "你是一个规划者，负责理解目标、分析当前局面、制定可执行的具体开发任务、挑选执行者、派发任务。" }
  systemPrompt() { return `1.阅读评估者本轮的评估；2.理解当前任务表完成度；3.分析本轮执行的情况和进度；4.判断执行者是否正确理解了上一轮规划；5.决定将下一轮任务派发给哪个执行者。
  通常而言，任务树的层次越厚实，末端任务越具体，证明对项目的理解越深入，规划质量越高。
  完成任务表规划或调整后，请根据“把任务交给合适的人、新的任务交给新的人、重大重构交给新的人”的原则委派执行者，按下列格式输出：
  {
    当前情况: "",
    本轮任务标题: "",
    委派执行者: "(执行者name)",
    给执行者留言: "你好执行者，...（给执行者的具体留言或规划）"
  }
  ` }

  // 任务表统计信息...
  //（根据优先级序号从0到n排序，越靠前越优先）
  // 0 根任务标题
  // —— 创建时间
  // —— 任务描述
  // —— 依赖
  // —— 已完成/未完成
  // 0.0 子任务标题
  // ———— 创建时间
  // ———— (Tag1、Tag2...)任务描述
  // ———— 依赖
  // ———— 已完成/未完成
  // 0.0.1 子任务标题
  // —————— 创建时间
  // —————— (Tag1、Tag2...)任务描述
  // —————— 依赖
  // —————— 已完成/未完成
  // 0.0.2 子任务标题
  // —————— 创建时间
  // —————— (Tag1、Tag2...)任务描述
  // —————— 依赖
  // —————— 已完成/未完成
  // 0.0 子任务标题
  // ———— 创建时间
  // ———— (Tag1、Tag2...)任务描述
  // ———— 依赖
  // ———— 已完成/未完成
  任务表Prompt():string {
    const 末端任务数 = 当前表中总任务数_仅末端()
    const 总任务数 = 当前表中全部任务数()
    const n = 任务树一次性聚焦数量上限

    function 计算任务树层数(): number {
      function 获取子任务层级(父任务标题: string | null, currentDepth: number): number {
        const children = db.query(
          "SELECT 标题 FROM 任务表 WHERE 是否删除 = 0 AND 父任务标题 = ?"
        ).all(父任务标题) as { 标题: string }[]

        if (children.length === 0) return currentDepth

        let maxDepth = currentDepth
        for (const child of children) {
          const childDepth = 获取子任务层级(child.标题, currentDepth + 1)
          if (childDepth > maxDepth) maxDepth = childDepth
        }
        return maxDepth
      }

      const roots = 加载根任务()
      if (roots.length === 0) return 0

      let maxDepth = 0
      for (const root of roots) {
        const depth = 获取子任务层级(root.标题!, 1)
        if (depth > maxDepth) maxDepth = depth
      }
      return maxDepth
    }

    const 任务树最深处层数 = 计算任务树层数()
    const 根任务列表 = 加载根任务()

    // 查询最近创建的n个非根任务（按创建时间UTC倒序）
    const recentTasks = db.query(
      "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务标题 IS NOT NULL ORDER BY 创建时间UTC DESC LIMIT ?"
    ).all(n) as 任务[]

    // 补全任务链：根据父任务标题向上追溯
    function 追溯父任务链(任务标题: string | null, visited: Set<string>): 任务[] {
      if (任务标题 === null) return []
      if (visited.has(任务标题)) return []

      const parent = db.query(
        "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 标题 = ?"
      ).get(任务标题) as 任务 | undefined
      if (!parent) return []
      if (parent.父任务标题 === null) return [parent]

      visited.add(任务标题)
      const ancestors = 追溯父任务链(parent.父任务标题 ?? null, visited)
      return [parent, ...ancestors]
    }

    function 解析任务Tag(task: 任务): 任务 {
      if (typeof task.Tag === 'string') {
        try {
          task.Tag = JSON.parse(task.Tag) as string[]
        } catch {
          task.Tag = []
        }
      }
      return task
    }

    const allTasksMap = new Map<string, 任务>()
    for (const root of 根任务列表) {
      if (root.标题) allTasksMap.set(root.标题, 解析任务Tag(root))
    }

    for (const recent of recentTasks) {
      if (recent.标题) {
        allTasksMap.set(recent.标题, 解析任务Tag(recent))
        // 补全该任务的父任务链
        const ancestors = 追溯父任务链(recent.父任务标题 ?? null, new Set())
        for (const ancestor of ancestors) {
          if (ancestor.标题) allTasksMap.set(ancestor.标题, 解析任务Tag(ancestor))
        }
      }
    }

    const allTasks = Array.from(allTasksMap.values())

    const 构建序号路径 = (任务: 任务): string => {
      const chain: number[] = []
      let current: 任务 | undefined = 任务
      const visited = new Set<string>()
      while (current) {
        if (current.标题 && visited.has(current.标题)) break
        if (current.标题) visited.add(current.标题)
        chain.unshift(current.优先级序号 ?? 0)
        if (current.父任务标题 === null || current.父任务标题 === undefined) break
        current = allTasksMap.get(current.父任务标题) ?? db.query(
          "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 标题 = ?"
        ).get(current.父任务标题) as 任务 | undefined
      }
      return chain.join('.')
    }

    const 优先级序列 = (路径: string): number[] => {
      return 路径.split('.').map(num => parseInt(num, 10))
    }

    const 获取任务深度 = (任务: 任务): number => {
      let depth = 0
      let current: 任务 | undefined = 任务
      const visited = new Set<string>()
      while (current) {
        if (current.标题 && visited.has(current.标题)) break
        if (current.标题) visited.add(current.标题)
        depth++
        if (current.父任务标题 === null || current.父任务标题 === undefined) break
        current = allTasksMap.get(current.父任务标题) ?? db.query(
          "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 标题 = ?"
        ).get(current.父任务标题) as 任务 | undefined
      }
      return depth
    }

    const 获取Dash前缀 = (深度: number): string => {
      const base = '——'
      if (深度 <= 1) return base
      return base + '—'.repeat((深度 - 1) * 2)
    }

    const sortedTasks = allTasks.sort((a, b) => {
      const pathA = 构建序号路径(a)
      const pathB = 构建序号路径(b)
      const seqA = 优先级序列(pathA)
      const seqB = 优先级序列(pathB)
      for (let i = 0; i < Math.max(seqA.length, seqB.length); i++) {
        const numA = seqA[i] ?? 0
        const numB = seqB[i] ?? 0
        if (numA !== numB) return numA - numB
      }
      return seqA.length - seqB.length
    })

    const lines: string[] = []
    lines.push(``)
    lines.push(`【任务表统计】`)
    lines.push(`- 末端任务数（小颗粒度任务）: ${末端任务数}`)
    lines.push(`- 总任务数（含所有父任务）: ${总任务数}`)
    lines.push(`- 任务树最深层数: ${任务树最深处层数}`)
    lines.push(``)
    lines.push(`【任务表视图】（根据优先级序号从0到n排序，越靠前越优先；✅ 代表已完成，☕️ 代表未完成）`)
    lines.push(``)

    for (const task of sortedTasks) {
      const depth = 获取任务深度(task)
      const prefix = 获取Dash前缀(depth)
      const 序号Str = 构建序号路径(task)
      const tagsStr = task.Tag?.join('、') ?? ''
      const 依赖信息 = task.依赖 ? JSON.parse(task.依赖) : []
      const 依赖Str = Array.isArray(依赖信息) && 依赖信息.length > 0
        ? 依赖信息.map((d: 任务依赖) => d.依赖任务).join('、')
        : '无'

      lines.push(`${序号Str} ${task.标题}`)
      lines.push(`${prefix} 创建时间: ${task.创建时间UTC ? formatDateTime({ isoString: task.创建时间UTC, showYear: false, showPeriod: true, showTime: true ,showSeconds: false}) : 'N/A'}`)
      lines.push(`${prefix} (${tagsStr})${task.任务描述 ?? 'N/A'}`)
      lines.push(`${prefix} 依赖: ${依赖Str}`)
      lines.push(`${prefix} ${task.是否完成 ? '✅ ' : '☕️ '}`)
      lines.push(``)
    }

    return lines.join('\n')
  }

  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 执行者 implements IRole, I读取任务表 {
  name = "executor"
  knowledgeDomainPrompt() { return "你是一个执行者，负责执行任务。" }
  systemPrompt() { return "。" }
  任务表Prompt():string {
    return `《任务表》`
  }
  fix任务反驳():string{
    return `如果你认为规划者的任务分配不合理，你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  add任务反驳():string{
    return `检查规划者的add任务是否合理（1.检查是否和已有功能冲突；2.检查是否并不优雅实现；3.其它各方面检查），你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 评估者 implements IRole {
  name = "evaluator"
  knowledgeDomainPrompt() { return "你是一个评估者，负责评估结果.  你再回复我三句话." }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 质保员 implements IRole {
  name = "QA"
  knowledgeDomainPrompt() { return "你是一个质保员，负责写测试、找bug/复现bug/记录bug" }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 冗余枝剪者 implements IRole {
  name = "ScissorHands"
  knowledgeDomainPrompt() { return "你是一个冗余枝剪者，负责寻找开发过程中因前后逻辑覆盖、项目推进太快造成的不必要的冗余（代码、逻辑、文件、文件夹、资产等），并提请执行者检查。" }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 边缘质保员 implements IRole {
  name = "EdgeQA"
  knowledgeDomainPrompt() { return "你是一个边缘质保员，负责寻找质保员测试时未覆盖到的边缘情况。找出以下可能发生的边缘情况：大数据量、大参数量、多次重复操作、交叠式重复操作、覆盖式操作、特殊情况中断。" }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export const 策略描述 = "任务表驱动的MPEE（manage-plan-execute-eval）策略"
export const backendURL = "http://127.0.0.1:4096"

/**
 * 计算中断派发上下文
 * @param sourceRole 中断来源角色（interrupt.roleName 对应的 role）
 * @param allRoles 所有角色列表
 * @param interrupt 当前待处理的中断
 *
 * 【roleName 语义统一约定】
 * interrupt.roleName 表示"哪个 role 的 session 产生了这个中断"，而非"恢复结果应派发给谁"
 * 这使得每个 role 的 session 状态能独立管理，不会因角色切换而混乱
 */
function getDispatchContext(sourceRole: IRole, allRoles: IRole[], interrupt: InterruptedMessage) {
  if (interrupt.reason !== INTERRUPTION_REASON.rollback) {
    return {
      dispatchMsg: interrupt,
      fallbackRole: Role跳转策略(sourceRole, allRoles),
    }
  }

  const resumedRole = Role跳转策略(sourceRole, allRoles)
  return {
    dispatchMsg: interrupt,
    fallbackRole: resumedRole,
  }
}

function isDispatchableInterruption(reason: InterruptedMessage["reason"]): boolean {
  return (
    reason === INTERRUPTION_REASON.pause ||
    reason === INTERRUPTION_REASON.new_message ||
    reason === INTERRUPTION_REASON.rollback
  )
}

function takeLatestDispatchableInterruption(queue: InterruptedMessage[]): InterruptedMessage | null {
  for (let index = queue.length - 1; index >= 0; index--) {
    const item = queue[index]
    if (!item) continue
    if (!isDispatchableInterruption(item.reason)) continue
    queue.length = 0
    return item
  }
  return null
}

const Role跳转策略: (current: IRole, allRoles: IRole[]) => IRole = (current, allRoles) => {
  const currentIndex = allRoles.findIndex((role) => role.name === current.name)
  if (currentIndex === -1) throw new Error(`未知角色: ${current.name}`)
  return allRoles[(currentIndex + 1) % allRoles.length]!
}

function isCycleCompleted(nextRole: IRole, allRoles: IRole[]): boolean {
  return nextRole.name === allRoles[0]?.name
}

export async function main(): Promise<void> {
  const allRoles = 检查names重复([new 规划者(), new 执行者(), new 评估者()]) as IRole[]
  let theFirstRole = allRoles[0]!
  let currentRole = theFirstRole

  const interruptionQueue: InterruptedMessage[] = []

  consoleAndLogFile.infoC(LOG_COLOR.GREEN, `[${策略描述}][预备] 总圈数=${config.maxCycles}`)
  consoleAndLogFile.info(`服务器URL: ${backendURL}`)
  consoleAndLogFile.info(`日志目录: ${LOG_DIR}`)
  consoleAndLogFile.info(`后端: ${linkBackend(backendURL)}`)

  const defaultDir = process.cwd()
  let projectDir = defaultDir
  const entrySession: ISession = await selectOrCreateSession(defaultDir)
  projectDir = entrySession.directory


  entrySession.onInterruption((msg) => {
    interruptionQueue.push(msg)
    logFile.info(`[检测到中断] reason=${msg.reason}`)
  })

  /**
   * 按需获取角色专属 session（懒加载）
   * 每个 role 维护自己的 session 实例，实现状态隔离
   * 新创建的 session 会注册中断监听，事件统一推送到全局队列
   */
  const getOrCreateSession = async (role: IRole): Promise<ISession> => {
    if (role.currentSessionInstance) {
      return role.currentSessionInstance
    }
    const session = await createSession(`[${role.name}] (${formatDateTime({ isoString: new Date().toISOString(), showYear: false, showPeriod: true, showTime: true ,showSeconds: false})})`, projectDir)
    role.currentSessionInstance = session
    session.onInterruption((msg) => {
      interruptionQueue.push(msg)
      logFile.info(`[检测到中断] reason=${msg.reason}`)
    })
    return session
  }

  theFirstRole.currentSessionInstance = entrySession

  try {
    let cycle = 0
    while (cycle < config.maxCycles) {
      // 【中断消费语义】
      // 这里统一消费四种中断语义：
      // - pause / new_message / rollback：允许用户决定消息应该派发给哪个角色
      // - aborted：说明当前生成已被终止，不在循环顶部处理，而是在 catch AbortError 后进入等待恢复路径
      //
      // 【中断来源角色确定】
      // 使用 interrupt.roleName（而非循环变量 currentRole）来锚定触发中断的 session，
      // 这样确保每个 role 的 session 状态独立管理，不会因角色切换而混乱
      const interrupt = takeLatestDispatchableInterruption(interruptionQueue)
      if (interrupt) {
        const interruptedRole = allRoles.find((r) => r.name === interrupt.roleName)
        if (!interruptedRole) throw new Error(`中断来源角色不存在: ${interrupt.roleName}`)

        logFile.info(`[中断处理] reason=${interrupt.reason}, 来源角色=${interruptedRole.name}`)
        const dispatchContext = getDispatchContext(interruptedRole, allRoles, interrupt)
        logFile.info(`[派发决策] interruptRole=${interrupt.roleName}, dispatchRole=${dispatchContext.dispatchMsg.roleName}, fallbackRole=${dispatchContext.fallbackRole.name}`)

        currentRole = await AskTo重新定位角色(allRoles, dispatchContext.fallbackRole, dispatchContext.dispatchMsg)

        // 清理的是触发中断的那个 role 的 session，不是 currentRole 的
        if (interruptedRole.currentSessionInstance) {
          interruptedRole.currentSessionInstance.clearInterruption()
        }
        continue
      }

      // 没有待处理的中断，才获取当前 role 的 session 并执行任务
      const session = await getOrCreateSession(currentRole)
      logFile.info(`[第${cycle + 1}圈] 当前角色=${currentRole.name}, 会话状态=${session.getReceiveState()}`)

      consoleAndLogFile.infoC(LOG_COLOR.GREEN, `>>> ${currentRole.name}`)
      session.setCurrentContext(currentRole.name)
      const agentType = currentRole.accessMode === "readonly" ? "plan" : "build"

      try {
        const msg = currentRole.knowledgeDomainPrompt();
        consoleAndLogFile.infoC(LOG_COLOR.GREEN,`[发送>>] "${msg.substring(0, 60)}..."`)
        const response = await session.sendMsg(
          {
            msgSource: MSG_SOURCE.system,
            content: msg,
          },
          agentType,
          currentRole.model,
        )

        consoleAndLogFile.infoC(LOG_COLOR.GREEN,`[<<收到] "${response.substring(0, 80)}..."`)
        logFile.infoC(LOG_COLOR.GREEN, `<<< ${currentRole.name} 完成`)
        const nextRole = Role跳转策略(currentRole, allRoles)

        // 硬规则: 提前闭环回到首角色，算一圈
        // 没回到首角色，不算一圈
        // 也就是说, 当前策略是"闭环First"策略
        if (isCycleCompleted(nextRole, allRoles)) {
          cycle++
          consoleAndLogFile.info(`[当前循环: 第${cycle + 1}圈]`)
        }

        currentRole = nextRole // 切换角色

        // TODO 交接信息


      } catch (error) {

        if (!(error instanceof AbortError)) {
          throw error
        }

        logFile.info(`[暂停] 当前角色=${currentRole.name}, state=${session.getReceiveState()}`)
        logFile.info(`[暂停] 用户已中止消息, 等待下一次消息发送...`)

        try {
          const resumedResponse = await session.waitForUserMessage()
          logFile.info(`[恢复后收到] ${resumedResponse.substring(0, 80)}...`)
          logFile.info(`[暂停] 收到新的用户引导与模型恢复结果，回到派发阶段`)
          // 不在这里直接推进到下一个角色。
          // waitForUserMessage 期间会先收到 new_message，再收到 rollback。
          // 顶部循环会从 interruptionQueue 中取最新可派发中断统一处理。
          /**
           * 手工补充 rollback 事件
           * roleName 必须是被中断的那个 role（currentRole），不是"恢复后应切换到的角色"
           * 这样顶部循环才能正确清理：interruptedRole.currentSessionInstance.clearInterruption()
           * "恢复后默认派发给谁"由 getDispatchContext(sourceRole).fallbackRole 计算
           */
          if (!interruptionQueue.some((item) => item.reason === INTERRUPTION_REASON.rollback)) {
            interruptionQueue.push({
              roleName: currentRole.name,
              beforeMessage: currentRole.knowledgeDomainPrompt(),
              receivedMessage: resumedResponse,
              timestamp: new Date(),
              reason: INTERRUPTION_REASON.rollback,
            })
          }
          continue
        } catch (waitError) {
          const err = waitError as Error
          logFile.info(`[暂停] 等待恢复结束: ${err.message}`)
          break
        }
      }
    }
  } finally {
    // 释放所有 role 的 session 资源，避免连接泄漏
    for (const role of allRoles) {
      if (role.currentSessionInstance) {
        await role.currentSessionInstance.disposeAsync()
      }
    }
    consoleAndLogFile.infoC(LOG_COLOR.GREEN, "[策略结束]")
  }
}

if (import.meta.main) {
  main().catch((error) => consoleAndLogFile.error("主函数错误:", error))
}
