/**
 * 独立的任务表Tool模块
 * 提供任务表的数据库操作、CRUD功能、查询视图等
 * 可作为CLI工具独立使用，也可作为模块导入
 * 整个文件应保持完全的内聚性，不依赖外部模块（除了sqlite和fs等基础库），以保证其独立和可移植性
 */
import Database from "better-sqlite3"
import { join, dirname } from "path"
import { mkdirSync, existsSync } from "fs"
import { fileURLToPath } from "url"

const scriptDir = import.meta.url ? dirname(fileURLToPath(import.meta.url)) : __dirname

export const TIME_PERIODS = [
  "早晨",   // 5:00-7:59
  "上午",   // 8:00-11:59
  "中午",   // 12:00-12:59
  "下午",   // 13:00-17:59
  "傍晚",   // 18:00-18:59
  "晚上",   // 19:00-23:59
  "午夜",   // 0:00-4:59
] as const

export type TimePeriod = typeof TIME_PERIODS[number]

export function getTimePeriod(date: Date = new Date()): TimePeriod {
  const hour = date.getHours()
  if (hour >= 5 && hour < 8) return "早晨"
  if (hour >= 8 && hour < 12) return "上午"
  if (hour >= 12 && hour < 13) return "中午"
  if (hour >= 13 && hour < 18) return "下午"
  if (hour >= 18 && hour < 19) return "傍晚"
  if (hour >= 19 && hour < 24) return "晚上"
  return "午夜"
}

export interface FormatDateTimeOptions {
  period?: TimePeriod | "auto"
  showYear?: boolean
  showPeriod?: boolean
  showTime?: boolean
  showSeconds?: boolean
  isoString: string
}

export function formatDateTime(options: FormatDateTimeOptions): string {
  const date = new Date(options.isoString)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const period = options.period === "auto" || options.period === undefined
    ? getTimePeriod(date)
    : options.period
  const yearStr = options.showYear !== false ? `${year}年` : ""
  const periodStr = options.showPeriod ? `${period}` : ""
  const timeStr = options.showTime
    ? ` ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}${options.showSeconds ? `:${date.getSeconds().toString().padStart(2, "0")}` : ""}`
    : ""
  return `${yearStr}${month}月${day}日${periodStr}${timeStr}`
}

export const 任务Tag = {
  DETAIL: "detail",
  ADD: "add",
  FEAT: "feat",
  FIX: "fix",
  REFACTOR: "refactor",
  BIG_CHANGE: "BIG_CHANGE",
  CHORE: "chore",
  ADJUST: "adjust",
  REVERT: "revert",
  TEST: "test",
  EXPLORE: "explore_in_progress",
  MERGE: "merge",
  MILESTONE: "milestone",
} as const

export type 任务Tag = typeof 任务Tag[keyof typeof 任务Tag]

const 合法的Tag列表 = Object.values(任务Tag)

function 校验Tag合法性(tag: string): boolean {
  return 合法的Tag列表.includes(tag as 任务Tag)
}

function 校验所有Tag( tags: string[]): string | null {
  for (const tag of tags) {
    if (!校验Tag合法性(tag)) {
      return `存在无效的Tag，必须且只能在以下Tag中选择：${合法的Tag列表.join("、")}`
    }
  }
  return null
}

export class 任务 {
  id?: number
  标题?: string
  父任务ID?: number | null
  Tag?: string[]
  任务描述?: string
  是否完成: boolean = false
  创建时间UTC?: string
  优先级序号?: number
  依赖?: string
  已删除: boolean = false
  动态: 动态记录[] = []
}

export class 任务依赖 {
  "依赖任务ID"?: number
  "依赖任务"!: string
  "原因"!: string
}

export class 动态记录 {
  时间UTC!: string
  角色!: string
  消息!: string
}

// 检查规则：同父任务的子任务互相依赖时，前者(优先级序号更小)不能依赖后者，否则报错
// 即，强制符合只能后者依赖前者的关系，不允许非典型依赖顺序
// 当然，跨父任务的子任务就不用管了（允许跨级非典型依赖顺序）
function 校验同级依赖规则(
  任务标题: string,
  父任务ID: number | null,
  优先级序号: number,
  依赖: 任务依赖[],
): 任务操作结果 | null {
  if (依赖.length === 0 || 父任务ID === null) return null
  const 同级任务 = 获取任务表Db().prepare(
    "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID) as 任务Row[]
  for (const dep of 依赖) {
    // 通过依赖任务ID查找同级任务
    const 依赖任务 = 同级任务.find(t => t.id === dep.依赖任务ID)
    if (依赖任务) {
      const 依赖任务优先级 = 解析任务行(依赖任务).优先级序号 ?? 0
      if (优先级序号 <= 依赖任务优先级) {
        return { 成功: false, 消息: `同级任务情况下，前者(优先级序号更小)不能依赖后者（优先级序号更大），请重新从整体依赖设计出发，权衡任务《${任务标题}》和《${dep.依赖任务}》的优先级，判断是否是错误的优先级规划或错误的依赖关系。如果重要任务一定要提前做，也可以考虑采取将这个重要任务拆成两个任务：一个开发时过渡性任务、一个正式态完善/补足任务， 让开发时过渡提前做完，形成更细的任务顺序：过渡性任务->依赖过渡性任务的任务->正式态完善/补足` }
      }
    }
  }
  return null
}

function 统计子任务数(父任务ID: number): number {
  const children = 获取任务表Db().prepare(
    "SELECT id FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID) as { id: number }[]
  let count = children.length
  for (const child of children) {
    count += 统计子任务数(child.id)
  }
  return count
}

function 检查所有子任务是否已完成(父任务ID: number): boolean {
  const children = 获取任务表Db().prepare(
    "SELECT id, 是否完成 FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID) as { id: number, 是否完成: number }[]
  for (const child of children) {
    if (!child.是否完成) return false
    if (!检查所有子任务是否已完成(child.id)) return false
  }
  return true
}

/**
 * 尝试向上自动完成父任务。
 * 当子任务完成时调用，检查同级任务是否全部完成，
 * 如果是则将父任务标记为完成，并继续向上递归检查祖父任务。
 * 只更新父任务本身，不级联更新其子任务。
 */
function 尝试向上自动完成(刚完成的任务ID: number): void {
  // 获取刚完成的任务信息
  const 刚完成的任务 = 获取任务表Db().prepare(
    "SELECT 父任务ID FROM 任务表 WHERE id = ? AND 是否删除 = 0"
  ).get(刚完成的任务ID) as { 父任务ID: number | null } | undefined

  if (!刚完成的任务 || 刚完成的任务.父任务ID === null) {
    // 没有父任务，递归终止
    return
  }

  const 父任务ID = 刚完成的任务.父任务ID

  // 检查同级任务（父任务的其他子任务）是否全部完成
  const 同级任务 = 获取任务表Db().prepare(
    "SELECT 是否完成 FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID) as { 是否完成: number }[]

  const allSiblingsDone = 同级任务.every(s => s.是否完成)

  if (allSiblingsDone) {
    // 所有同级任务都完成了，标记父任务为完成
    获取任务表Db().prepare(
      "UPDATE 任务表 SET 是否完成 = 1 WHERE id = ?"
    ).run(父任务ID)

    // 递归继续向上检查祖父任务
    尝试向上自动完成(父任务ID)
  }
}

function 级联更新字段(父任务ID: number, 字段: string, 值: number | string | null): void {
  const children = 获取任务表Db().prepare(
    "SELECT id FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
  ).all(父任务ID) as { id: number }[]
  for (const child of children) {
    级联更新字段(child.id, 字段, 值)
  }
  获取任务表Db().prepare(`UPDATE 任务表 SET ${字段} = ? WHERE id = ?`).run(值, 父任务ID)
}

export type 任务Row = Omit<任务, "Tag" | "动态"> & { Tag?: string | string[], 动态?: string }

export interface AddedTaskMsg {
  任务描述: string
  是否完成: boolean
  创建时间: string
  优先级序号: number
}

type 任务操作结果 = {
  成功: boolean
  消息: string
  res任务?: 任务 | AddedTaskMsg
  需要确认?: boolean
  子任务数?: number
}

let db: Database.Database
export let 任务表dbPath: string
export let 当前项目名: string

function 获取任务表Db() {
  if (!db) throw new Error("任务表数据库未初始化，请先调用 initDb()")
  return db
}

export function initDb(项目名: string, 数据库目录?: string) {
  当前项目名 = 项目名
  const 项目目录 = join(数据库目录 ?? scriptDir, "data", `.taskTable.${项目名}`)
  if (!existsSync(项目目录)) {
    mkdirSync(项目目录, { recursive: true })
  }
  任务表dbPath = join(项目目录, `${项目名}TaskTable.db`)
  db = new Database(任务表dbPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS 任务表 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      标题 TEXT UNIQUE NOT NULL,
      父任务ID INTEGER,
      Tag TEXT NOT NULL,
      任务描述 TEXT NOT NULL,
      是否完成 INTEGER DEFAULT 0,
      创建时间UTC TEXT NOT NULL,
      优先级序号 INTEGER DEFAULT 0,
      依赖 TEXT,
      是否删除 INTEGER DEFAULT 0,
      动态 TEXT
    )
  `)
  return db
}

export function initDbStrict(项目名: string) {
  const 项目目录 = join(scriptDir, "data", `.taskTable.${项目名}`)
  if (existsSync(项目目录)) {
    throw new Error(`项目目录已存在: ${项目目录}`)
  }
  return initDb(项目名)
}

export function 检查环境完整性(项目名: string): { 成功: boolean, 消息: string } {
  const 项目目录 = join(scriptDir, "data", `.taskTable.${项目名}`)
  if (!existsSync(项目目录)) {
    return { 成功: false, 消息: `项目目录不存在: ${项目目录}` }
  }
  const dbPath = join(项目目录, `${项目名}TaskTable.db`)
  if (!existsSync(dbPath)) {
    return { 成功: false, 消息: `数据库丢失: ${dbPath}，项目目录存在但数据库文件不存在` }
  }
  return { 成功: true, 消息: "环境检查通过" }
}

export function getDb() { return 获取任务表Db() }

export function 当前表中全部任务数(): number {
  const result = 获取任务表Db().prepare("SELECT COUNT(*) as count FROM 任务表 WHERE 是否删除 = 0").get() as { count: number }
  return result?.count ?? 0
}

export function 当前表中总任务数_仅末端(): number {
  const result = 获取任务表Db().prepare("SELECT COUNT(*) as count FROM 任务表 WHERE 是否删除 = 0 AND id NOT IN (SELECT DISTINCT 父任务ID FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS NOT NULL)").get() as { count: number }
  return result?.count ?? 0
}

export function 加载根任务(): 任务[] {
  const rows = 获取任务表Db().prepare(
    "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS NULL ORDER BY 优先级序号 ASC"
  ).all() as 任务Row[]
  return rows.map(解析任务行)
}

function 计算移动目标优先级(
  父任务ID: number | null,
  新任务优先级序号: number,
): number {
  let maxResult: { maxPri: number }
  if (父任务ID === null) {
    maxResult = 获取任务表Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), 0) as maxPri FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS NULL"
    ).get() as { maxPri: number }
  } else {
    maxResult = 获取任务表Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), 0) as maxPri FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
    ).get(父任务ID) as { maxPri: number }
  }
  if (新任务优先级序号 < 0) return 0
  return 新任务优先级序号 > maxResult.maxPri ? maxResult.maxPri : 新任务优先级序号
}

function 计算实际优先级序号(
  父任务ID: number | null,
  新任务优先级序号: number,
): number {
  let maxResult: { maxPri: number }
  if (父任务ID === null) {
    maxResult = 获取任务表Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), -1) as maxPri FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS NULL"
    ).get() as { maxPri: number }
  } else {
    maxResult = 获取任务表Db().prepare(
      "SELECT COALESCE(MAX(优先级序号), -1) as maxPri FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
    ).get(父任务ID) as { maxPri: number }
  }
  const clamped = 新任务优先级序号 < 0 ? 0 : 新任务优先级序号
  return clamped > maxResult.maxPri + 1 ? maxResult.maxPri + 1 : clamped
}

function 插入任务并更新同级优先级(
  父任务ID: number | null,
  新任务优先级序号: number,
): number {
  const 实际优先级序号 = 计算实际优先级序号(父任务ID, 新任务优先级序号)

  if (父任务ID === null) {
    获取任务表Db().prepare(
      "UPDATE 任务表 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务ID IS NULL AND 优先级序号 >= ?"
    ).run(实际优先级序号)
    return 实际优先级序号
  }

  获取任务表Db().prepare(
    "UPDATE 任务表 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务ID = ? AND 优先级序号 >= ?"
  ).run(父任务ID, 实际优先级序号)
  return 实际优先级序号
}

function 检测里程碑(父任务ID: number | null): 任务Tag | null {
  if (父任务ID === null) return null
  const parent = 获取任务表Db().prepare("SELECT 父任务ID FROM 任务表 WHERE id = ? AND 是否删除 = 0").get(父任务ID) as { 父任务ID: number | null } | undefined
  if (parent?.父任务ID === null) {
    return 任务Tag.MILESTONE
  }
  return null
}

export function 解析任务行(raw: 任务Row | 任务): 任务 {
  if ("Tag" in raw && Array.isArray(raw.Tag) && "动态" in raw && Array.isArray(raw.动态)) {
    return raw as 任务
  }
  const task = raw as 任务Row
  let tags: string[] = []
  if (typeof task.Tag === 'string') {
    try {
      tags = JSON.parse(task.Tag) as string[]
    } catch {
      tags = []
    }
  } else if (Array.isArray(task.Tag)) {
    tags = task.Tag
  }
  let 动态: 动态记录[] = []
  if (typeof task.动态 === 'string') {
    try {
      动态 = JSON.parse(task.动态) as 动态记录[]
    } catch {
      动态 = []
    }
  } else if (Array.isArray(task.动态)) {
    动态 = task.动态
  }
  return {
    ...task,
    Tag: tags,
    是否完成: Boolean(task.是否完成),
    已删除: Boolean((task as Record<string, unknown>)["是否删除"] ?? task.已删除),
    动态,
  }
}

export const 任务表 = {
  添加任务(
    添加到哪个父任务之下: string | null,
    任务描述: string,
    标题: string,
    优先级序号: number,
    任务类型Tag: 任务Tag,
    依赖: 任务依赖[] = [],
    其它Tag: string[] = [],
  ): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    if (!任务描述 || !任务描述.trim()) return { 成功: false, 消息: "任务描述不能为空" }

    // 获取父任务ID
    let 父任务ID: number | null = null
    if (添加到哪个父任务之下 !== null) {
      const parent = 获取任务表Db().prepare("SELECT id FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(添加到哪个父任务之下) as { id: number } | undefined
      if (!parent) return { 成功: false, 消息: `父任务「${添加到哪个父任务之下}」不存在` }
      父任务ID = parent.id
    }

    // 检查标题唯一性（只拒绝未删除的同名任务；软删除的同名任务会先被清理再新增）
    const existing = 获取任务表Db().prepare("SELECT id FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim)
    if (existing) return { 成功: false, 消息: `标题「${标题trim}」在当前项目「${当前项目名}」已存在` }

    const 任务类型Tag校验 = 校验所有Tag([任务类型Tag])
    if (任务类型Tag校验) return { 成功: false, 消息: 任务类型Tag校验 }
    if (其它Tag.length > 0) {
      const 其它Tag校验 = 校验所有Tag(其它Tag)
      if (其它Tag校验) return { 成功: false, 消息: 其它Tag校验 }
    }

    // 处理软删除的任务（如果标题已存在但被软删除，先删除）
    const softDeleted = 获取任务表Db().prepare("SELECT id FROM 任务表 WHERE 标题 = ? AND 是否删除 = 1").get(标题trim)
    if (softDeleted) {
      获取任务表Db().prepare("DELETE FROM 任务表 WHERE 标题 = ? AND 是否删除 = 1").run(标题trim)
    }

    // 处理依赖：验证依赖任务存在，并转换为id存储
    for (const dep of 依赖) {
      if (typeof dep.依赖任务 !== "string") return { 成功: false, 消息: "依赖任务不能为空" }
      const depTitle = dep.依赖任务.trim()
      if (!depTitle) return { 成功: false, 消息: "依赖任务不能为空" }
      const depTask = 获取任务表Db().prepare("SELECT id, 标题 FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(depTitle) as { id: number, 标题: string } | undefined
      if (!depTask) return { 成功: false, 消息: `依赖任务「${depTitle}」不存在` }
      dep.依赖任务ID = depTask.id
      dep.依赖任务 = depTask.标题
    }

    const 实际优先级序号 = 计算实际优先级序号(父任务ID, 优先级序号)
    const 依赖校验结果 = 校验同级依赖规则(标题trim, 父任务ID, 实际优先级序号, 依赖)
    if (依赖校验结果) return 依赖校验结果
    const mileStone = 检测里程碑(父任务ID)
    const 所有Tag = [...new Set([其它Tag, 任务类型Tag, mileStone].flat().filter((t): t is string => t !== null))]
    if (所有Tag.length === 0) return { 成功: false, 消息: "至少需要一个Tag" }
    插入任务并更新同级优先级(父任务ID, 优先级序号)
    const 创建时间UTC = new Date().toISOString()

    // 插入任务获取自增id
    const insertResult = 获取任务表Db().prepare(
      "INSERT INTO 任务表 (标题, 父任务ID, Tag, 任务描述, 是否完成, 创建时间UTC, 优先级序号, 依赖, 是否删除, 动态) VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, ?)"
    ).run(标题trim, 父任务ID, JSON.stringify(所有Tag), 任务描述.trim(), 创建时间UTC, 实际优先级序号, JSON.stringify(依赖), JSON.stringify([]))

    const newTaskId = insertResult.lastInsertRowid as number

    const isRoot = 父任务ID === null
    const 父任务标题信息 = isRoot ? "" : `（父任务：${添加到哪个父任务之下}）`
    const 依赖提醒 = 依赖.length === 0 ? "（当前依赖数量为0，请掂量是否有未考虑周到的隐性依赖，依赖链是极为重要的，不要忽视隐性依赖）" : ""

    return {
      成功: true,
      消息: `已添加${isRoot ? "根任务" : "子任务"}「${标题trim}」${父任务标题信息}（优先级：${实际优先级序号}，ID：${newTaskId}）${依赖提醒}`,
      res任务: {
        任务描述: 任务描述.trim(),
        是否完成: false,
        创建时间: 创建时间UTC,
        优先级序号: 实际优先级序号,
      },
    }
  },

  删除任务(标题: string): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim) as 任务Row | undefined
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` }

    const 子任务总数 = 统计子任务数(existing.id!)
    if (子任务总数 > 0) {
      return { 成功: false, 消息: `该操作将把全部子任务级联标记为删除，请确认：`, 需要确认: true, 子任务数: 子任务总数 }
    }

    级联更新字段(existing.id!, "是否删除", 1)
    return { 成功: true, 消息: `已删除任务「${标题trim}」` }
  },

  确认删除(标题: string): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim) as 任务Row | undefined
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` }

    级联更新字段(existing.id!, "是否删除", 1)
    return { 成功: true, 消息: `已删除任务「${标题trim}」及其所有子任务` }
  },

  查询已删除任务(数量: number, 从: string | undefined, 到: string | undefined, 描述字数阈值: number, 动态字数阈值: number): string {
    const taskDb = 获取任务表Db()

    if (数量 <= 0) {
      return `【已删除任务错误】数量必须大于0，当前值: ${数量}`
    }

    const { sql: 时间过滤, params: 时间参数, 校验失败消息 } = 构建时间过滤条件(从, 到)
    if (校验失败消息) {
      return `【已删除任务错误】${校验失败消息}`
    }

    const deletedTasks = taskDb.prepare(
      `SELECT * FROM 任务表 WHERE 是否删除 = 1${时间过滤} ORDER BY 创建时间UTC DESC LIMIT ?`
    ).all(...时间参数, 数量) as 任务Row[]

    const parsedTasks = deletedTasks.map(解析任务行)

    const lines: string[] = []
    lines.push(``)
    lines.push(`【已删除任务统计】`)
    lines.push(`- 已删除任务数: ${parsedTasks.length}`)
    lines.push(``)
    lines.push(`【已删除任务列表】（按删除时间倒序）`)
    lines.push(``)

    for (const task of parsedTasks) {
      const tagsStr = task.Tag?.join('、') ?? ''
      const 依赖信息 = task.依赖 ? JSON.parse(task.依赖) : []
      const 依赖Str = Array.isArray(依赖信息) && 依赖信息.length > 0
        ? 依赖信息.map((d: 任务依赖) => d.依赖任务).join('、')
        : '无'

      const 描述原文 = task.任务描述 ?? 'N/A'
      const 描述展示 = 描述原文.length > 描述字数阈值
        ? 描述原文.slice(0, 描述字数阈值) + `(..折叠${描述原文.length - 描述字数阈值}字)`
        : 描述原文

      lines.push(`${task.标题}`)
      lines.push(`  创建时间: ${task.创建时间UTC ? formatDateTime({ isoString: task.创建时间UTC, showYear: false, showPeriod: true, showTime: true, showSeconds: false }) : 'N/A'}`)
      lines.push(`  (${tagsStr})${描述展示}`)
      lines.push(`  依赖: ${依赖Str}`)
      lines.push(`  ${task.是否完成 ? '✅ ' : '☕️ '}`)
      if (task.动态 && task.动态.length > 0) {
        const 动态行: string[] = []
        let 累计消息字数 = 0
        let 已折叠数 = 0
        for (let i = 0; i < task.动态.length; i++) {
          const d = task.动态[i]
          const timeStr = formatDateTime({ isoString: d.时间UTC, showYear: false, showPeriod: false, showTime: true, showSeconds: false })
          const 消息字数 = d.消息.length
          if (累计消息字数 + 消息字数 > 动态字数阈值) {
            if (动态行.length === 0) {
              const 可显示字数 = 动态字数阈值
              if (可显示字数 > 0) {
                动态行.push(`  ${i + 1}.「${timeStr} ${d.角色}：${d.消息.slice(0, 可显示字数)}」`)
              }
            }
            已折叠数 = task.动态.length - i
            break
          }
          累计消息字数 += 消息字数
          动态行.push(`  ${i + 1}.「${timeStr} ${d.角色}：${d.消息}」`)
        }
        if (已折叠数 > 0) {
          动态行.push(`  (..折叠${已折叠数}个动态)`)
        }
        lines.push(`  动态：`)
        lines.push(...动态行)
      }
      else {
        lines.push(`  无动态`)
      }
      lines.push(``)
    }

    return lines.join('\n')
  },

  按标题查(标题: string, 模糊: boolean = false): 任务[] {
    if (模糊) {
      const rows = 获取任务表Db().prepare(
        "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 标题 LIKE ? ORDER BY 优先级序号 ASC"
      ).all(`%${标题}%`) as 任务Row[]
      return rows.map(解析任务行)
    }
    const row = 获取任务表Db().prepare(
      "SELECT * FROM 任务表 WHERE 标题 = ?"
    ).get(标题) as 任务Row | undefined
    return row ? [解析任务行(row)] : []
  },

  按ID查(id: number): 任务 | null {
    const row = 获取任务表Db().prepare(
      "SELECT * FROM 任务表 WHERE id = ? AND 是否删除 = 0"
    ).get(id) as 任务Row | undefined
    return row ? 解析任务行(row) : null
  },

  /**
   * 递归构建任务依赖链。
   *
   * @param 标题 要查询的任务标题
   * @param 最大层数 递归最大深度，默认 3
   * @returns 任务详情 + 分层的依赖链，每层包含【标题、依赖原因、动态】
   */
  查询依赖链(标题: string, 最大层数: number = 3) {
    const taskRow = 获取任务表Db().prepare(
      "SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0"
    ).get(标题) as 任务Row | undefined
    if (!taskRow) return { 成功: false, 消息: `任务"${标题}"不存在` }

    const task = 解析任务行(taskRow)
    const visited = new Set<number>([task.id!])

    /**
     * 解析任务的依赖 JSON，返回依赖任务详情数组。
     */
    function 获取依赖任务(依赖JSON: string | undefined): { 依赖任务ID: number, 标题: string, 原因: string }[] {
      if (!依赖JSON) return []
      try {
        const deps = JSON.parse(依赖JSON) as 任务依赖[]
        return deps.map(d => ({ 依赖任务ID: d.依赖任务ID!, 标题: d["依赖任务"], 原因: d["原因"] }))
      } catch {
        return []
      }
    }

    /**
     * 递归构建某一层依赖。返回该层所有依赖的详情列表。
     */
    function 递归收集依赖(depInfos: { 依赖任务ID: number, 标题: string, 原因: string }[], depthRemaining: number): {
      层: number
      依赖: { 标题: string, 原因: string, 动态: 动态记录[] }[]
    }[] {
      if (depthRemaining <= 0 || depInfos.length === 0) return []

      const currentLayer: { 标题: string, 原因: string, 动态: 动态记录[] }[] = []
      const nextDepInfos: { 依赖任务ID: number, 标题: string, 原因: string }[] = []

      for (const dep of depInfos) {
        if (visited.has(dep.依赖任务ID)) continue
        visited.add(dep.依赖任务ID)

        const depRow = 获取任务表Db().prepare(
          "SELECT * FROM 任务表 WHERE id = ? AND 是否删除 = 0"
        ).get(dep.依赖任务ID) as 任务Row | undefined
        if (!depRow) continue

        const depTask = 解析任务行(depRow)
        // 使用真实任务的标题，而非依赖JSON中存储的旧标题快照
        currentLayer.push({ 标题: depTask.标题!, 原因: dep.原因, 动态: depTask.动态 })

        const subDeps = 获取依赖任务(depTask.依赖)
        nextDepInfos.push(...subDeps)
      }

      if (currentLayer.length === 0) return []

      const nextLayers = 递归收集依赖(nextDepInfos, depthRemaining - 1)
      return [{ 层: 最大层数 - depthRemaining + 1, 依赖: currentLayer }, ...nextLayers]
    }

    const topDeps = 获取依赖任务(task.依赖)
    const 依赖链 = 递归收集依赖(topDeps, 最大层数)

    return {
      成功: true,
      任务: { 标题: task.标题, Tag: task.Tag, 任务描述: task.任务描述 },
      依赖链,
    }
  },

  按Tag查询(Tag: string): 任务[] {
    const rows = 获取任务表Db().prepare(
      "SELECT * FROM 任务表 WHERE 是否删除 = 0"
    ).all() as 任务Row[]
    return rows
      .map(解析任务行)
      .filter(task => task.Tag?.includes(Tag))
  },

  改描述(标题: string, 新描述: string): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    if (!新描述 || !新描述.trim()) return { 成功: false, 消息: "新描述不能为空" }
    const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim) as 任务Row | undefined
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` }
    获取任务表Db().prepare("UPDATE 任务表 SET 任务描述 = ? WHERE id = ?").run(新描述.trim(), existing.id)
    const updated = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE id = ?").get(existing.id) as 任务Row | undefined
    return { 成功: true, 消息: `已更新任务「${标题trim}」的描述`, res任务: updated ? 解析任务行(updated) : undefined }
  },

  改标题(旧标题: string, 新标题: string): 任务操作结果 {
    const 旧标题trim = 旧标题.trim()
    const 新标题trim = 新标题.trim()
    if (!旧标题trim) return { 成功: false, 消息: "旧标题不能为空" }
    if (!新标题trim) return { 成功: false, 消息: "新标题不能为空" }
    const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(旧标题trim) as 任务Row | undefined
    if (!existing) return { 成功: false, 消息: `任务「${旧标题trim}」不存在` }
    const duplicate = 获取任务表Db().prepare("SELECT id FROM 任务表 WHERE 标题 = ?").get(新标题trim)
    if (duplicate) return { 成功: false, 消息: `新标题「${新标题trim}」在当前项目「${当前项目名}」已存在` }

    获取任务表Db().prepare("UPDATE 任务表 SET 标题 = ? WHERE id = ?").run(新标题trim, existing.id)

    const updated = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE id = ?").get(existing.id) as 任务Row | undefined
    return { 成功: true, 消息: `已将任务「${旧标题trim}」更名为「${新标题trim}」（ID：${existing.id}不变，父子关系和依赖关系不受影响）`, res任务: updated ? 解析任务行(updated) : undefined }
  },

  改依赖(标题: string, 新依赖: 任务依赖[]): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim) as 任务Row | undefined
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` }
    const existingTask = 解析任务行(existing)

    // 处理依赖：验证依赖任务存在，并转换为id存储
    for (const dep of 新依赖) {
      if (typeof dep.依赖任务 !== "string") return { 成功: false, 消息: "依赖任务不能为空" }
      const depTitle = dep.依赖任务.trim()
      if (!depTitle) return { 成功: false, 消息: "依赖任务不能为空" }
      const depTask = 获取任务表Db().prepare("SELECT id, 标题 FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(depTitle) as { id: number, 标题: string } | undefined
      if (!depTask) return { 成功: false, 消息: `依赖任务「${depTitle}」不存在` }
      dep.依赖任务ID = depTask.id
      dep.依赖任务 = depTask.标题
    }

    const 依赖校验结果 = 校验同级依赖规则(标题trim, existingTask.父任务ID ?? null, existingTask.优先级序号 ?? 0, 新依赖)
    if (依赖校验结果) return 依赖校验结果
    获取任务表Db().prepare("UPDATE 任务表 SET 依赖 = ? WHERE id = ?").run(JSON.stringify(新依赖), existing.id)
    const updated = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE id = ?").get(existing.id) as 任务Row | undefined
    const 依赖提醒 = 新依赖.length === 0 ? "（当前依赖数量为0，请掂量是否有未考虑周到的隐性依赖，依赖链是极为重要的，不要忽视隐性依赖）" : ""
    return { 成功: true, 消息: `已更新任务「${标题trim}」的依赖${依赖提醒}`, res任务: updated ? 解析任务行(updated) : undefined }
  },

  改优先级(标题: string, 新优先级序号: number): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim) as 任务Row | undefined
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` }
    const existingTask = 解析任务行(existing)
    const 原优先级序号 = existingTask.优先级序号 ?? 0
    const 父任务ID = existingTask.父任务ID ?? null
    const 实际优先级序号 = 计算移动目标优先级(父任务ID, 新优先级序号)

    const 同级任务 = 获取任务表Db().prepare(
      "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS ?"
    ).all(父任务ID) as 任务Row[]

    for (const other of 同级任务) {
      const otherTask = 解析任务行(other)
      if (otherTask.id === existing.id || !otherTask.依赖) continue
      try {
        const otherDeps: 任务依赖[] = JSON.parse(otherTask.依赖)
        const depOnThis = otherDeps.find(d => d.依赖任务ID === existing.id)
        if (depOnThis) {
          const otherPri = otherTask.优先级序号 ?? 0
          if (原优先级序号 < 实际优先级序号 && otherPri > 原优先级序号 && otherPri <= 实际优先级序号) {
            return { 成功: false, 消息: `该任务被同级任务《${otherTask.标题}》依赖，将其优先级从 ${原优先级序号} 改为 ${实际优先级序号} 会导致依赖顺序颠倒，请重新考虑优先级或依赖关系` }
          }
          if (原优先级序号 < 实际优先级序号 && otherPri < 原优先级序号) {
            return { 成功: false, 消息: `该任务被同级任务《${otherTask.标题}》依赖，将其优先级从 ${原优先级序号} 改为 ${实际优先级序号} 会导致依赖顺序颠倒，请重新考虑优先级或依赖关系` }
          }
        }
      } catch { /* skip invalid JSON */ }
    }

    if (existingTask.依赖) {
      try {
        const selfDeps: 任务依赖[] = JSON.parse(existingTask.依赖)
        const 自身依赖校验 = 校验同级依赖规则(标题trim, 父任务ID, 实际优先级序号, selfDeps)
        if (自身依赖校验) return 自身依赖校验
      } catch { /* skip invalid JSON */ }
    }

    const taskDb = 获取任务表Db()
    taskDb.exec("BEGIN TRANSACTION")
    try {
      if (原优先级序号 < 实际优先级序号) {
        taskDb.prepare("UPDATE 任务表 SET 优先级序号 = 优先级序号 - 1 WHERE 是否删除 = 0 AND 父任务ID IS ? AND 优先级序号 > ? AND 优先级序号 <= ? AND id != ?")
          .run(父任务ID, 原优先级序号, 实际优先级序号, existing.id)
      } else if (原优先级序号 > 实际优先级序号) {
        taskDb.prepare("UPDATE 任务表 SET 优先级序号 = 优先级序号 + 1 WHERE 是否删除 = 0 AND 父任务ID IS ? AND 优先级序号 >= ? AND 优先级序号 < ? AND id != ?")
          .run(父任务ID, 实际优先级序号, 原优先级序号, existing.id)
      }
      taskDb.prepare("UPDATE 任务表 SET 优先级序号 = ? WHERE id = ?")
        .run(实际优先级序号, existing.id)
      taskDb.exec("COMMIT")
    } catch (e) {
      taskDb.exec("ROLLBACK")
      return { 成功: false, 消息: `更新优先级失败: ${e instanceof Error ? e.message : String(e)}` }
    }

    const 更新后同级 = 获取任务表Db().prepare(
      "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS ? ORDER BY 优先级序号 ASC"
    ).all(父任务ID) as 任务Row[]
    const 当前任务索引 = 更新后同级.findIndex(t => t.id === existing.id)
    const 前两个任务 = 更新后同级.slice(Math.max(0, 当前任务索引 - 2), 当前任务索引).map(t => 解析任务行(t))
    const 后两个任务 = 更新后同级.slice(当前任务索引 + 1, 当前任务索引 + 3).map(t => 解析任务行(t))

    const 前两个描述 = 前两个任务.length > 0 ? 前两个任务.map(t => `《${t.标题}》(优先级${t.优先级序号})`).join("、") : "无"
    const 后两个描述 = 后两个任务.length > 0 ? 后两个任务.map(t => `《${t.标题}》(优先级${t.优先级序号})`).join("、") : "无"

    const updated = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE id = ?").get(existing.id) as 任务Row | undefined
    return { 成功: true, 消息: `已将任务「${标题trim}」的优先级从 ${原优先级序号} 改为 ${实际优先级序号}。当前位置：前两个任务[${前两个描述}] <- 本任务 -> 后两个任务[${后两个描述}]`, res任务: updated ? 解析任务行(updated) : undefined }
  },

  标记为已完成(标题: string): 任务操作结果 {
    return _完成任务(标题)
  },

  确认完成(标题: string): 任务操作结果 {
    return _完成任务(标题)
  },

  添加动态(标题: string, 角色: string, 消息: string): 任务操作结果 {
    const 标题trim = 标题.trim()
    if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
    if (!角色 || !角色.trim()) return { 成功: false, 消息: "角色不能为空" }
    if (!消息 || !消息.trim()) return { 成功: false, 消息: "消息不能为空" }
    const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim) as 任务Row | undefined
    if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` }
    const 现有动态: 动态记录[] = existing.动态 ? JSON.parse(existing.动态 as string) : []
    const 新动态: 动态记录 = { 时间UTC: new Date().toISOString(), 角色: 角色.trim(), 消息: 消息.trim() }
    现有动态.push(新动态)
    获取任务表Db().prepare("UPDATE 任务表 SET 动态 = ? WHERE id = ?").run(JSON.stringify(现有动态), existing.id)
    const updated = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE id = ?").get(existing.id) as 任务Row | undefined
    return { 成功: true, 消息: `已为任务「${标题trim}」添加动态`, res任务: updated ? 解析任务行(updated) : undefined }
  },
}

/**
 * 内部函数：完成任务
 */
function _完成任务(标题: string): 任务操作结果 {
  const 标题trim = 标题.trim()
  if (!标题trim) return { 成功: false, 消息: "标题不能为空" }
  const existing = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE 标题 = ? AND 是否删除 = 0").get(标题trim) as 任务Row | undefined
  if (!existing) return { 成功: false, 消息: `任务「${标题trim}」不存在` }

  const 子任务总数 = 统计子任务数(existing.id!)
  // 如果是父任务，检查所有子任务是否都已完成
  if (子任务总数 > 0) {
    if (!检查所有子任务是否已完成(existing.id!)) {
      return { 成功: false, 消息: `不允许直接将父任务标记为完成，请先确保所有子任务完成` }
    }
    // 所有子任务都已完成，只标记父任务自身为完成（子任务已完成，无需重复更新）
    获取任务表Db().prepare("UPDATE 任务表 SET 是否完成 = 1 WHERE id = ?").run(existing.id)
    const updated = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE id = ?").get(existing.id) as 任务Row | undefined
    return { 成功: true, 消息: `已将任务「${标题trim}」标记为已完成`, res任务: updated ? 解析任务行(updated) : undefined }
  }

  // 末端任务：标记为完成后，尝试向上自动完成父任务
  获取任务表Db().prepare("UPDATE 任务表 SET 是否完成 = 1 WHERE id = ?").run(existing.id)
  尝试向上自动完成(existing.id!)

  const updated = 获取任务表Db().prepare("SELECT * FROM 任务表 WHERE id = ?").get(existing.id) as 任务Row | undefined
  return { 成功: true, 消息: `已将任务「${标题trim}」标记为已完成`, res任务: updated ? 解析任务行(updated) : undefined }
}

function 构建时间过滤条件(从: string | undefined, 到: string | undefined): { sql: string, params: string[], 校验失败消息: string | null } {
  const sqlParts: string[] = []
  const params: string[] = []

  if (从 !== undefined) {
    const date = new Date(从)
    if (isNaN(date.getTime())) {
      return { sql: "", params: [], 校验失败消息: `--从 参数无效的ISO时间格式: ${从}` }
    }
    sqlParts.push("创建时间UTC >= ?")
    params.push(date.toISOString())
  }

  if (到 !== undefined) {
    const date = new Date(到)
    if (isNaN(date.getTime())) {
      return { sql: "", params: [], 校验失败消息: `--到 参数无效的ISO时间格式: ${到}` }
    }
    sqlParts.push("创建时间UTC <= ?")
    params.push(date.toISOString())
  }

  return {
    sql: sqlParts.length > 0 ? ` AND ${sqlParts.join(" AND ")}` : "",
    params,
    校验失败消息: null,
  }
}

/**
 * 返回结构化的视图
 */
export function 查询任务表_返回视图(一次性聚焦数量上限: number, 从: string | undefined, 到: string | undefined, 描述字数展示阈值: number, 任务动态字数展示阈值: number): string {
  const taskDb = 获取任务表Db()

  if (一次性聚焦数量上限 <= 0) {
    return `【任务表错误】一次性聚焦数量上限必须大于0，当前值: ${一次性聚焦数量上限}`
  }

  const { sql: 时间过滤, params: 时间参数, 校验失败消息 } = 构建时间过滤条件(从, 到)
  if (校验失败消息) {
    return `【任务表错误】${校验失败消息}`
  }

  const 末端任务数 = 当前表中总任务数_仅末端()
  const 总任务数 = 当前表中全部任务数()
  const n = 一次性聚焦数量上限

  function 计算任务树层数(): number {
    function 获取子任务层级(父任务ID: number | null, currentDepth: number): number {
      const children = taskDb.prepare(
        "SELECT id FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID = ?"
      ).all(父任务ID) as { id: number }[]

      if (children.length === 0) return currentDepth

      let maxDepth = currentDepth
      for (const child of children) {
        const childDepth = 获取子任务层级(child.id, currentDepth + 1)
        if (childDepth > maxDepth) maxDepth = childDepth
      }
      return maxDepth
    }

    const roots = 加载根任务()
    if (roots.length === 0) return 0

    let maxDepth = 0
    for (const root of roots) {
      const depth = 获取子任务层级(root.id!, 1)
      if (depth > maxDepth) maxDepth = depth
    }
    return maxDepth
  }

  const 任务树最深处层数 = 计算任务树层数()
  const 根任务列表 = 时间过滤
    ? taskDb.prepare(
        `SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS NULL${时间过滤} ORDER BY 优先级序号 ASC`
      ).all(...时间参数) as 任务Row[]
    : 加载根任务()

  const recentTasks = taskDb.prepare(
    `SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务ID IS NOT NULL${时间过滤} ORDER BY 创建时间UTC DESC LIMIT ?`
  ).all(...时间参数, n) as 任务Row[]

  function 追溯父任务链(任务ID: number | null, visited: Set<number>): 任务[] {
    if (任务ID === null) return []
    if (visited.has(任务ID)) return []

    const parent = taskDb.prepare(
      "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND id = ?"
    ).get(任务ID) as 任务Row | undefined
    if (!parent) return []
    if (parent.父任务ID === null) return [解析任务行(parent)]

    visited.add(任务ID)
    const ancestors = 追溯父任务链(parent.父任务ID ?? null, visited)
    return [解析任务行(parent), ...ancestors]
  }

  const allTasksMap = new Map<number, 任务>()
  // 设计阐明：所有根任务必须纳入视图（无论是否在时间窗口内）
  // 根任务是任务树的骨架，即使没有符合时间条件的子任务，也应展示根任务的存在
  for (const root of 根任务列表) {
    if (root.id) allTasksMap.set(root.id, 解析任务行(root))
  }

  for (const recent of recentTasks) {
    if (recent.id) {
      allTasksMap.set(recent.id, 解析任务行(recent))
      const ancestors = 追溯父任务链(recent.父任务ID ?? null, new Set())
      for (const ancestor of ancestors) {
        if (ancestor.id) allTasksMap.set(ancestor.id, 解析任务行(ancestor))
      }
    }
  }

  const allTasks = Array.from(allTasksMap.values())

  const 构建序号路径 = (任务: 任务): string => {
    const chain: number[] = []
    let current: 任务 | undefined = 任务
    const visited = new Set<number>()
    while (current) {
      if (current.id && visited.has(current.id)) break
      if (current.id) visited.add(current.id)
      chain.unshift(current.优先级序号 ?? 0)
      if (current.父任务ID === null || current.父任务ID === undefined) break
      current = allTasksMap.get(current.父任务ID) ?? (() => {
        const parent = taskDb.prepare(
          "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND id = ?"
        ).get(current!.父任务ID) as 任务Row | undefined
        return parent ? 解析任务行(parent) : undefined
      })()
    }
    return chain.join('.')
  }

  const 优先级序列 = (路径: string): number[] => {
    return 路径.split('.').map(num => parseInt(num, 10))
  }

  const 获取任务深度 = (任务: 任务): number => {
    let depth = 0
    let current: 任务 | undefined = 任务
    const visited = new Set<number>()
    while (current) {
      if (current.id && visited.has(current.id)) break
      if (current.id) visited.add(current.id)
      depth++
      if (current.父任务ID === null || current.父任务ID === undefined) break
      current = allTasksMap.get(current.父任务ID) ?? (() => {
        const parent = taskDb.prepare(
          "SELECT * FROM 任务表 WHERE 是否删除 = 0 AND id = ?"
        ).get(current!.父任务ID) as 任务Row | undefined
        return parent ? 解析任务行(parent) : undefined
      })()
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
  lines.push(`- 任务树最深处层数: ${任务树最深处层数}`)
  lines.push(``)
  lines.push(`【任务表视图】（优先级序号从0到n排序，靠前=优先；✅ =已完成，☕️ =未完成）`)
  lines.push(`- 当前展示数量: ${sortedTasks.length}`)
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

    const 描述原文 = task.任务描述 ?? 'N/A'
    const 描述展示 = 描述原文.length > 描述字数展示阈值
      ? 描述原文.slice(0, 描述字数展示阈值) + `(..折叠${描述原文.length - 描述字数展示阈值}字)`
      : 描述原文

    lines.push(`${序号Str}.${task.标题}`)
    lines.push(`${prefix} 创建时间: ${task.创建时间UTC ? formatDateTime({ isoString: task.创建时间UTC, showYear: false, showPeriod: true, showTime: true, showSeconds: false }) : 'N/A'}`)
    lines.push(`${prefix} (${tagsStr})${描述展示}`)
    lines.push(`${prefix} 依赖: ${依赖Str}`)
    lines.push(`${prefix} ${task.是否完成 ? '✅ ' : '☕️ '}`)
    if (task.动态 && task.动态.length > 0) {
      const 动态行: string[] = []
      let 累计消息字数 = 0
      let 已折叠数 = 0
      const 动态前缀 = `${prefix}  `
      for (let i = 0; i < task.动态.length; i++) {
        const d = task.动态[i]
        const timeStr = formatDateTime({ isoString: d.时间UTC, showYear: false, showPeriod: false, showTime: true, showSeconds: false })
        const 消息字数 = d.消息.length
        if (累计消息字数 + 消息字数 > 任务动态字数展示阈值) {
          if (动态行.length === 0) {
            const 可显示字数 = 任务动态字数展示阈值
            if (可显示字数 > 0) {
              动态行.push(`${动态前缀}${i + 1}.「${timeStr} ${d.角色}：${d.消息.slice(0, 可显示字数)}」`)
            }
          }
          已折叠数 = task.动态.length - i
          break
        }
        累计消息字数 += 消息字数
        动态行.push(`${动态前缀}${i + 1}.「${timeStr} ${d.角色}：${d.消息}」`)
      }
      if (已折叠数 > 0) {
        动态行.push(`${动态前缀}(..折叠${已折叠数}个动态)`)
      }
      lines.push(`${prefix} 动态：`)
      lines.push(...动态行)
    }
    else{
      lines.push(`${prefix} 无动态`)
    }
    lines.push(``)
  }

  return lines.join('\n')
}

// ==================== CLI Harness ====================

const CLI_COMMANDS = {
  help: "显示帮助信息",
  init: "初始化数据库 --项目 <项目名>",
  add: "添加任务 --标题 <标题> --描述 <描述> [--父任务 <父任务>] [--优先级 <序号>] [--Tag <Tag>] [--依赖 <JSON>] [--其它Tag <JSON>]",
  delete: "删除任务 --标题 <标题>",
  "query-deleted": "查询已删除任务 --数量 <n> --描述字数阈值 <字数> --动态字数阈值 <字数> [--从 <ISO>] [--到 <ISO>]",
  query: "查询任务表视图 --数量 <n> --描述字数阈值 <字数> --动态字数阈值 <字数> [--从 <ISO>] [--到 <ISO>]",
  "query-by-title": "按标题查询 --标题 <标题> [--模糊 <true|false>]",
  "query-by-id": "按ID查询 --id <ID>",
  "query-by-tag": "按Tag查询 --Tag <Tag>",
  "update-description": "改描述 --标题 <标题> --新描述 <描述>",
  "update-title": "改标题 --标题 <旧标题> --新标题 <新标题>",
  "update-dependency": "改依赖 --标题 <标题> --新依赖 <JSON>",
  "update-priority": "改优先级 --标题 <标题> --新优先级 <序号>",
  "mark-complete": "标记为已完成 --标题 <标题>",
  "add-activity": "添加动态 --标题 <标题> --角色 <角色> --消息 <消息>",
  "query-dependency-chain": "查询依赖链 --标题 <标题> [--最大层数 <n>]",
} as const

type CliCommand = keyof typeof CLI_COMMANDS

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2)
      const value = args[i + 1] ?? ""
      result[key] = value
      i++
    }
  }
  return result
}

function outputResult(data: unknown) {
  console.log(JSON.stringify(data, null, 2))
}

function printHelp() {
  const lines = ["任务表CLI - 任务管理工具", "", "用法: npx tsx 任务表CLI.ts <命令> [选项]", ""]
  for (const [cmd, desc] of Object.entries(CLI_COMMANDS)) {
    lines.push(`  ${cmd.padEnd(22)} ${desc}`)
  }
  lines.push("")
  console.log(lines.join("\n"))
}

async function runCli() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    printHelp()
    process.exit(0)
  }

  const command = args[0] as CliCommand
  const flags = parseArgs(args.slice(1))

  if (command === "help") {
    printHelp()
    process.exit(0)
  }

  if (command === "init") {
    if (!flags.项目) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --项目" })
      process.exit(1)
    }
    try {
      initDbStrict(flags.项目)
      outputResult({ 成功: true, 消息: `任务表数据库已初始化 (项目: ${flags.项目})，可以使用任务表啦！`, 路径: 任务表dbPath })
      process.exit(0)
    } catch (e) {
      outputResult({ 成功: false, 消息: e instanceof Error ? e.message : String(e) })
      process.exit(1)
    }
  }

  if (!process.env.TASKTABLE_PROJECT_NAME) {
    outputResult({ 成功: false, 消息: "未指定项目，请设置环境变量 TASKTABLE_PROJECT_NAME 或在 init 命令中指定 --项目" })
    process.exit(1)
  }

  const 项目名 = process.env.TASKTABLE_PROJECT_NAME
  const 环境检查 = 检查环境完整性(项目名)
  if (!环境检查.成功) {
    const readline = await import("readline")
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>(resolve => {
      rl.question(`${环境检查.消息}。y新建，n退出: `, resolve)
    })
    rl.close()
    if (answer.toLowerCase() !== "y") {
      outputResult({ 成功: false, 消息: "已取消操作" })
      process.exit(0)
    }
  }
  initDb(项目名)

  if (command === "add") {
    if (!flags.标题 || !flags.描述 || flags.优先级 === undefined) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --描述, --优先级" })
      process.exit(1)
    }
    let 依赖: 任务依赖[] = []
    let 其它Tag: string[] = []
    try {
      依赖 = flags.依赖 ? JSON.parse(flags.依赖) as 任务依赖[] : []
      其它Tag = flags.其它Tag ? JSON.parse(flags.其它Tag) as string[] : []
    } catch (e) {
      outputResult({ 成功: false, 消息: `JSON参数解析失败: ${e instanceof Error ? e.message : String(e)}` })
      process.exit(1)
    }
    try {
      const result = 任务表.添加任务(
        flags.父任务 ?? null,
        flags.描述,
        flags.标题,
        parseInt(flags.优先级),
        (flags.Tag ?? 任务Tag.DETAIL) as 任务Tag,
        依赖,
        其它Tag,
      )
      outputResult(result)
      process.exit(result.成功 ? 0 : 1)
    } catch (e) {
      outputResult({ 成功: false, 消息: e instanceof Error ? e.message : String(e) })
      process.exit(1)
    }
  }

  if (command === "delete") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" })
      process.exit(1)
    }
    const result = 任务表.删除任务(flags.标题)
    if (result.需要确认) {
      const readline = await import("readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>(resolve => {
        rl.question(`${result.消息} (y/n): `, resolve)
      })
      rl.close()
      if (answer.toLowerCase() === "y") {
        const confirmResult = 任务表.确认删除(flags.标题)
        outputResult(confirmResult)
        process.exit(confirmResult.成功 ? 0 : 1)
      } else {
        outputResult({ 成功: false, 消息: "已取消删除" })
        process.exit(0)
      }
    }
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "query-by-title") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" })
      process.exit(1)
    }
    const 模糊 = flags.模糊 === "true"
    const result = 任务表.按标题查(flags.标题, 模糊)
    outputResult({ 成功: true, 数量: result.length, 任务: result })
    process.exit(0)
  }

  if (command === "query-by-id") {
    if (!flags.id) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --id" })
      process.exit(1)
    }
    const id = parseInt(flags.id)
    if (isNaN(id)) {
      outputResult({ 成功: false, 消息: "id必须是有效的整数" })
      process.exit(1)
    }
    const result = 任务表.按ID查(id)
    if (result) {
      outputResult({ 成功: true, 任务: result })
    } else {
      outputResult({ 成功: false, 消息: `ID为${id}的任务不存在或已删除` })
      process.exit(1)
    }
    process.exit(0)
  }

  if (command === "query-by-tag") {
    if (!flags.Tag) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --Tag" })
      process.exit(1)
    }
    const result = 任务表.按Tag查询(flags.Tag)
    outputResult({ 成功: true, 数量: result.length, 任务: result })
    process.exit(0)
  }

  if (command === "query-dependency-chain") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" })
      process.exit(1)
    }
    const 最大层数 = flags.最大层数 ? parseInt(flags.最大层数) : 1
    if (isNaN(最大层数) || 最大层数 < 1) {
      outputResult({ 成功: false, 消息: "最大层数必须为正整数" })
      process.exit(1)
    }
    const result = 任务表.查询依赖链(flags.标题, 最大层数)
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "query-deleted") {
    if (!flags.数量 || !flags.描述字数阈值 || !flags.动态字数阈值) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --数量, --描述字数阈值, --动态字数阈值" })
      process.exit(1)
    }
    const result = 任务表.查询已删除任务(
      parseInt(flags.数量),
      flags.从 || undefined,
      flags.到 || undefined,
      parseInt(flags.描述字数阈值),
      parseInt(flags.动态字数阈值),
    )
    if (result.includes("错误")) {
      outputResult({ 成功: false, 消息: result })
      process.exit(1)
    }
    console.log(result)
    process.exit(0)
  }

  if (command === "update-description") {
    if (!flags.标题 || !flags.新描述) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新描述" })
      process.exit(1)
    }
    const result = 任务表.改描述(flags.标题, flags.新描述)
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "update-title") {
    if (!flags.标题 || !flags.新标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新标题" })
      process.exit(1)
    }
    const result = 任务表.改标题(flags.标题, flags.新标题)
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "update-dependency") {
    if (!flags.标题 || !flags.新依赖) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新依赖" })
      process.exit(1)
    }
    let 新依赖: 任务依赖[]
    try {
      新依赖 = JSON.parse(flags.新依赖) as 任务依赖[]
    } catch (e) {
      outputResult({ 成功: false, 消息: `JSON参数解析失败: ${e instanceof Error ? e.message : String(e)}` })
      process.exit(1)
    }
    const result = 任务表.改依赖(flags.标题, 新依赖)
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "update-priority") {
    if (!flags.标题 || flags.新优先级 === undefined) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --新优先级" })
      process.exit(1)
    }
    const result = 任务表.改优先级(flags.标题, parseInt(flags.新优先级))
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "mark-complete") {
    if (!flags.标题) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题" })
      process.exit(1)
    }
    const result = 任务表.标记为已完成(flags.标题)
    if (result.需要确认) {
      const readline = await import("readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>(resolve => {
        rl.question(`${result.消息} (y/n): `, resolve)
      })
      rl.close()
      if (answer.toLowerCase() === "y") {
        const confirmResult = 任务表.确认完成(flags.标题)
        outputResult(confirmResult)
        process.exit(confirmResult.成功 ? 0 : 1)
      } else {
        outputResult({ 成功: false, 消息: "已取消操作" })
        process.exit(0)
      }
    }
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "add-activity") {
    if (!flags.标题 || !flags.角色 || !flags.消息) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --标题, --角色, --消息" })
      process.exit(1)
    }
    const result = 任务表.添加动态(flags.标题, flags.角色, flags.消息)
    outputResult(result)
    process.exit(result.成功 ? 0 : 1)
  }

  if (command === "query") {
    if (!flags.数量 || !flags.描述字数阈值 || !flags.动态字数阈值) {
      outputResult({ 成功: false, 消息: "缺少必需参数: --数量, --描述字数阈值, --动态字数阈值" })
      process.exit(1)
    }
    const result = 查询任务表_返回视图(
      parseInt(flags.数量),
      flags.从 || undefined,
      flags.到 || undefined,
      parseInt(flags.描述字数阈值),
      parseInt(flags.动态字数阈值),
    )
    if (result.includes("错误")) {
      outputResult({ 成功: false, 消息: result })
      process.exit(1)
    }
    console.log(result)
    process.exit(0)
  }

  outputResult({ 成功: false, 消息: `未知命令: ${command}`, 可用命令: Object.keys(CLI_COMMANDS) })
  process.exit(1)
}

if (process.argv[1] === __filename) {
  runCli().catch(err => {
    outputResult({ 成功: false, 消息: `执行错误: ${err instanceof Error ? err.message : String(err)}` })
    process.exit(1)
  })
}
