/**
 * 规划图CLI 全面测试
 * 使用独立test项目数据库，每项操作后验证状态
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { rmSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"
import {
  initDb,
  规划图,
  查询规划图_返回视图,
  当前表中全部任务数,
  当前表中总任务数_仅末端,
  加载根任务,
  任务Tag,
  type 任务依赖,
  type 任务依赖输入,
  type 动态记录,
  getDb,
  规划图dbPath,
  解析任务行,
  type 任务Row,
  type 任务,
} from "../规划图CLI"

const __dirname = dirname(fileURLToPath(import.meta.url))
const 写入Key = "ONLY_YOU_CAN_WRITE"
const TEST_PROJECT_DIR = join(__dirname, "data", ".scheduleMap.test")
const TEST_DB_PATH = join(TEST_PROJECT_DIR, "testScheduleMap.db")

function cleanDb() {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH)
  if (existsSync(TEST_PROJECT_DIR)) rmSync(TEST_PROJECT_DIR, { recursive: true })
}

beforeAll(() => {
  cleanDb()
  initDb("test")
})

afterAll(() => {
  try { getDb().close() } catch {}
})

function clearAllTasks() {
  try {
    getDb().exec("DELETE FROM 规划图")
  } catch {
    // 如果获取数据库失败，尝试重新初始化
    cleanDb()
    initDb("test")
  }
}

function 获取所有子任务(父任务标题: string): 任务[] {
  const db = getDb()
  // 先通过标题查找父任务的ID
  const parent = db.prepare("SELECT id FROM 规划图 WHERE 标题 = ? AND 是否删除 = 0").get(父任务标题) as { id: number } | undefined
  if (!parent) return []
  const rows = db.prepare("SELECT * FROM 规划图 WHERE 是否删除 = 0 AND 父任务ID = ? ORDER BY 优先级序号 ASC").all(parent.id) as 任务Row[]
  return rows.map(解析任务行)
}

describe("1. 添加任务", () => {
  beforeAll(() => clearAllTasks())

  test("添加根任务成功", () => {
    const result = 规划图.添加任务(
      null,
      "这是一个根任务的描述，用于测试添加功能",
      "根任务A",
      0,
      任务Tag.FEAT,
    )
    expect(result.成功).toBe(true)
    expect(当前表中全部任务数()).toBe(1)
  })

  test("添加子任务成功", () => {
    const result = 规划图.添加任务(
      "根任务A",
      "这是子任务B的描述",
      "子任务B",
      0,
      任务Tag.DETAIL,
    )
    expect(result.成功).toBe(true)
    expect(当前表中全部任务数()).toBe(2)
  })

  test("添加带依赖的任务", () => {
    const deps: 任务依赖输入[] = [{ 依赖任务: "子任务B", 原因: "需要先完成B" }]
    const result = 规划图.添加任务(
      "根任务A",
      "这是子任务C的描述，依赖B",
      "子任务C",
      1,
      任务Tag.FIX,
      deps,
    )
    expect(result.成功).toBe(true)
  })

  test("添加带其它Tag的任务", () => {
    const result = 规划图.添加任务(
      null,
      "根任务D的描述",
      "根任务D",
      1,
      任务Tag.REFACTOR,
      [],
      [任务Tag.DETAIL, 任务Tag.CHORE],
    )
    expect(result.成功).toBe(true)
  })

  test("标题为空应失败", () => {
    const result = 规划图.添加任务(null, "描述", "  ", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("标题不能为空")
  })

  test("描述为空应失败", () => {
    const result = 规划图.添加任务(null, "", "新任务", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("任务描述不能为空")
  })

  test("重复标题应失败", () => {
    const result = 规划图.添加任务(null, "描述", "根任务A", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("已存在")
  })

  test("父任务不存在应失败", () => {
    const result = 规划图.添加任务("不存在的父任务", "描述", "新任务", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("传入超大优先级序号自动截断到末尾", () => {
    const result = 规划图.添加任务(null, "大序号描述", "大序号任务", 99999, 任务Tag.FEAT)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("优先级")
  })

  test("传入合理优先级序号不被截断", () => {
    const result = 规划图.添加任务(null, "中间描述", "中间任务", 2, 任务Tag.FEAT)
    expect(result.成功).toBe(true)
  })
})

describe("1.1 同级任务依赖校验", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "根任务X", 0, 任务Tag.MILESTONE)
  })

  test("同级任务后者依赖前者应成功", () => {
    规划图.添加任务("根任务X", "任务A描述", "任务A", 0, 任务Tag.FEAT)
    const deps: 任务依赖输入[] = [{ 依赖任务: "任务A", 原因: "需要先做A" }]
    const result = 规划图.添加任务("根任务X", "任务B描述", "任务B", 1, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(true)
  })

  test("同级任务前者依赖后者应失败", () => {
    const deps: 任务依赖输入[] = [{ 依赖任务: "任务B", 原因: "错误依赖" }]
    const result = 规划图.添加任务("根任务X", "任务C描述", "任务C", 0, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("任务C")
    expect(result.消息).toContain("任务B")
  })

  test("跨父任务的依赖不受限制", () => {
    规划图.添加任务(null, "根2描述", "根任务Y", 0, 任务Tag.MILESTONE)
    规划图.添加任务("根任务Y", "跨级任务D描述", "跨级任务D", 5, 任务Tag.FEAT)
    const deps: 任务依赖输入[] = [{ 依赖任务: "跨级任务D", 原因: "跨父依赖" }]
    const result = 规划图.添加任务("根任务X", "跨级任务E描述", "跨级任务E", 0, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(true)
  })

  test("添加任务时混合依赖应检测出第一个无效同级", () => {
    规划图.添加任务("根任务X", "高优描述", "高优任务P", 2, 任务Tag.FEAT)
    规划图.添加任务("根任务X", "低优描述", "低优任务Q", 5, 任务Tag.FEAT)
    const mixedDeps: 任务依赖输入[] = [
      { 依赖任务: "低优任务Q", 原因: "无效-前者依赖后者" },
      { 依赖任务: "高优任务P", 原因: "有效-后者依赖前者" },
    ]
    const result = 规划图.添加任务("根任务X", "混合依赖描述", "混合依赖任务R", 3, 任务Tag.FEAT, mixedDeps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("混合依赖任务R")
    expect(result.消息).toContain("低优任务Q")
  })

  test("新增任务同优先级插入并依赖该已有任务应失败", () => {
    规划图.添加任务("根任务X", "已有任务S", "已有任务S", 2, 任务Tag.FEAT)
    const deps: 任务依赖输入[] = [{ 依赖任务: "已有任务S", 原因: "同优先级插入依赖" }]
    const result = 规划图.添加任务("根任务X", "新增同优任务T", "新增同优任务T", 2, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("新增同优任务T")
    expect(result.消息).toContain("已有任务S")
  })

  test("添加任务依赖不存在的任务应失败", () => {
    const deps: 任务依赖输入[] = [{ 依赖任务: "不存在的依赖目标", 原因: "测试" }]
    const result = 规划图.添加任务("根任务X", "描述", "依赖不存在任务", 5, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("根任务添加依赖不受同级限制", () => {
    const deps: 任务依赖输入[] = [{ 依赖任务: "根任务Y", 原因: "根任务依赖" }]
    const result = 规划图.添加任务(null, "新根任务描述", "新根任务Z", 0, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(true)
  })
})

describe("2. 删除任务（软删除）", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "待删任务", 0, 任务Tag.FEAT)
    规划图.添加任务(null, "描述2", "保留任务", 1, 任务Tag.FEAT)
  })

  test("软删除成功", () => {
    const result = 规划图.删除任务("待删任务")
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("已删除")
  })

  test("软删除后精确查询仍能找到但标记为已删除", () => {
    const found = 规划图.按标题查("待删任务")
    expect(found).toHaveLength(1)
    expect(found[0].已删除).toBe(true)
  })

  test("软删除后总数减少", () => {
    expect(当前表中全部任务数()).toBe(1)
  })

  test("删除不存在的任务应失败", () => {
    const result = 规划图.删除任务("不存在的任务")
    expect(result.成功).toBe(false)
  })

  test("删除空标题应失败", () => {
    const result = 规划图.删除任务("")
    expect(result.成功).toBe(false)
  })
})

describe("2.1 级联删除", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "级联根任务", 0, 任务Tag.MILESTONE)
    规划图.添加任务("级联根任务", "子A描述", "级联子A", 0, 任务Tag.FEAT)
    规划图.添加任务("级联子A", "孙A描述", "级联孙A", 0, 任务Tag.FEAT)
    规划图.添加任务("级联根任务", "子B描述", "级联子B", 1, 任务Tag.FEAT)
  })

  test("删除有子任务的任务应返回需要确认", () => {
    const result = 规划图.删除任务("级联根任务")
    expect(result.成功).toBe(false)
    expect(result.需要确认).toBe(true)
    expect(result.子任务数).toBe(3)
    expect(result.消息).toContain("该操作将把全部子任务级联标记为删除，请确认：")
  })

  test("确认删除应级联删除所有子任务", () => {
    const result = 规划图.确认删除("级联根任务")
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("级联根任务")
    expect(result.消息).toContain("所有子任务")
  })

  test("级联删除后所有子任务均标记为已删除", () => {
    const 根 = 规划图.按标题查("级联根任务")
    expect(根[0].已删除).toBe(true)
    const 子A = 规划图.按标题查("级联子A")
    expect(子A[0].已删除).toBe(true)
    const 孙A = 规划图.按标题查("级联孙A")
    expect(孙A[0].已删除).toBe(true)
    const 子B = 规划图.按标题查("级联子B")
    expect(子B[0].已删除).toBe(true)
  })

  test("删除无子任务的任务应静默删除", () => {
    clearAllTasks()
    规划图.添加任务(null, "描述", "孤立任务", 0, 任务Tag.FEAT)
    const result = 规划图.删除任务("孤立任务")
    expect(result.成功).toBe(true)
    expect(result.需要确认).toBeUndefined()
    expect(result.消息).toContain("已删除")
  })
})

describe("2.2 查询已删除任务", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "删除任务A", 0, 任务Tag.FEAT)
    规划图.添加任务(null, "描述2", "删除任务B", 1, 任务Tag.FEAT)
    规划图.添加任务(null, "描述3", "保留任务C", 2, 任务Tag.FEAT)
    规划图.删除任务("删除任务A")
    规划图.确认删除("删除任务B")
  })

  test("查询已删除任务返回视图字符串", () => {
    const result = 规划图.查询已删除任务(10, undefined, undefined, 100, 100)
    expect(typeof result).toBe("string")
    expect(result).toContain("已删除任务统计")
    expect(result).toContain("已删除任务列表")
  })

  test("查询已删除任务包含已删除的任务", () => {
    const result = 规划图.查询已删除任务(10, undefined, undefined, 100, 100)
    expect(result).toContain("删除任务A")
    expect(result).toContain("删除任务B")
    expect(result).not.toContain("保留任务C")
  })

  test("查询数量为0应返回错误", () => {
    const result = 规划图.查询已删除任务(0, undefined, undefined, 100, 100)
    expect(result).toContain("错误")
  })

  test("无效时间格式应返回错误", () => {
    const result = 规划图.查询已删除任务(10, "invalid-date", undefined, 100, 100)
    expect(result).toContain("错误")
  })

  test("从到都不传时应查全部（无时间约束）", () => {
    const result = 规划图.查询已删除任务(10, undefined, undefined, 100, 100)
    expect(result).toContain("已删除任务统计")
    expect(result).toContain("已删除任务列表")
  })

  test("仅传从时查从时间起点以后的任务（2020起点会包含2026年任务）", () => {
    const result = 规划图.查询已删除任务(10, "2020-01-01T00:00:00Z", undefined, 100, 100)
    expect(result).toContain("删除任务A")
    expect(result).toContain("删除任务B")
    expect(result).toContain("已删除任务数: 2")
  })

  test("仅传到时查到时间终点以前的任务（当前时间任务在窗口外应排除）", () => {
    const result = 规划图.查询已删除任务(10, undefined, "2020-01-01T00:00:00Z", 100, 100)
    expect(result).toContain("已删除任务数: 0")
    expect(result).not.toContain("删除任务A")
  })

  test("从到都有时查时间段内的任务（当前时间任务在窗口外应排除）", () => {
    const result = 规划图.查询已删除任务(10, "2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z", 100, 100)
    expect(result).toContain("已删除任务数: 0")
    expect(result).not.toContain("删除任务A")
  })
})

describe("3. 按标题查", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "精确匹配任务", 0, 任务Tag.FEAT)
    规划图.添加任务(null, "描述2", "模糊任务A", 1, 任务Tag.DETAIL)
    规划图.添加任务(null, "描述3", "模糊任务B", 2, 任务Tag.FIX)
  })

  test("精确查询找到任务", () => {
    const result = 规划图.按标题查("精确匹配任务")
    expect(result).toHaveLength(1)
    expect(result[0].标题).toBe("精确匹配任务")
  })

  test("精确查询未找到返回空", () => {
    const result = 规划图.按标题查("不存在的任务")
    expect(result).toHaveLength(0)
  })

  test("模糊查询找到多个", () => {
    const result = 规划图.按标题查("模糊任务", true)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const titles = result.map(t => t.标题)
    expect(titles).toContain("模糊任务A")
    expect(titles).toContain("模糊任务B")
  })

  test("模糊查询无匹配返回空", () => {
    const result = 规划图.按标题查("xyz不存在的", true)
    expect(result).toHaveLength(0)
  })
})

describe("4. 按Tag查询", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "Tag任务1", 0, 任务Tag.FEAT)
    规划图.添加任务(null, "描述2", "Tag任务2", 1, 任务Tag.FEAT)
    规划图.添加任务(null, "描述3", "Tag任务3", 2, 任务Tag.FIX)
    规划图.添加任务(null, "描述4", "Tag任务4", 3, 任务Tag.REFACTOR, [], [任务Tag.DETAIL])
  })

  test("按FEAT Tag查询", () => {
    const result = 规划图.按Tag查询(任务Tag.FEAT)
    expect(result.length).toBeGreaterThanOrEqual(2)
    for (const task of result) {
      expect(task.Tag).toContain(任务Tag.FEAT)
    }
  })

  test("按FIX Tag查询", () => {
    const result = 规划图.按Tag查询(任务Tag.FIX)
    expect(result).toHaveLength(1)
    expect(result[0].标题).toBe("Tag任务3")
  })

  test("按DETAIL Tag查询（其它Tag）", () => {
    const result = 规划图.按Tag查询(任务Tag.DETAIL)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some(t => t.标题 === "Tag任务4")).toBe(true)
  })

  test("不存在的Tag返回空", () => {
    const result = 规划图.按Tag查询("不存在的Tag")
    expect(result).toHaveLength(0)
  })
})

describe("7. 改描述", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "原始描述内容", "改描述任务", 0, 任务Tag.FEAT)
  })

  test("修改描述成功", () => {
    const result = 规划图.改描述("改描述任务", "新的描述内容")
    expect(result.成功).toBe(true)
  })

  test("验证数据库已更新", () => {
    const found = 规划图.按标题查("改描述任务")
    expect(found).toHaveLength(1)
    expect(found[0].任务描述).toBe("新的描述内容")
  })

  test("修改不存在的任务应失败", () => {
    const result = 规划图.改描述("不存在的任务", "新描述")
    expect(result.成功).toBe(false)
  })

  test("空描述应失败", () => {
    const result = 规划图.改描述("改描述任务", "")
    expect(result.成功).toBe(false)
  })
})

describe("8. 改标题", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "旧标题任务", 0, 任务Tag.FEAT)
    规划图.添加任务("旧标题任务", "子任务描述", "旧标题的子任务", 0, 任务Tag.DETAIL)
    const deps: 任务依赖输入[] = [{ 依赖任务: "旧标题任务", 原因: "依赖它" }]
    规划图.添加任务(null, "描述2", "引用旧标题的任务", 1, 任务Tag.FIX, deps)
  })

  test("改标题成功", () => {
    const result = 规划图.改标题("旧标题任务", "新标题任务")
    expect(result.成功).toBe(true)
  })

  test("子任务的父任务ID保持不变（基于ID的索引不受标题更名影响）", () => {
    const child = 规划图.按标题查("旧标题的子任务")
    expect(child).toHaveLength(1)
    // 父子关系基于ID存储，父任务ID保持不变
    expect(child[0].父任务ID).toBeDefined()
    // 通过父任务ID查询能正确找到更名后的父任务
    const parent = 规划图.按标题查("新标题任务")
    expect(parent).toHaveLength(1)
    expect(parent[0].id).toBe(child[0].父任务ID)
  })

  test("依赖中的任务ID保持不变（基于ID的索引不受标题更名影响）", () => {
    const refTask = 规划图.按标题查("引用旧标题的任务")
    expect(refTask).toHaveLength(1)
    const deps = JSON.parse(refTask[0].依赖!) as 任务依赖[]
    // 依赖基于ID存储，依赖任务ID保持不变
    expect(deps[0].依赖任务ID).toBeDefined()
    // 依赖关系只存ID，不存标题快照；标题仅在查询视图里按ID回查展示
    expect("依赖任务" in deps[0]).toBe(false)
    // 但通过ID能正确找到更名后的任务
    const actualTask = 规划图.按标题查("新标题任务")
    expect(actualTask).toHaveLength(1)
    expect(actualTask[0].id).toBe(deps[0].依赖任务ID)
  })

  test("查询视图中的依赖标题按ID回查当前标题", () => {
    const view = 查询规划图_返回视图(20, undefined, undefined, 9999, 9999)
    expect(view).toContain("依赖: 新标题任务")
    expect(view).not.toContain("依赖: 旧标题任务")
  })

  test("新标题已存在应失败", () => {
    const result = 规划图.改标题("新标题任务", "新标题任务")
    expect(result.成功).toBe(false)
  })

  test("旧标题不存在应失败", () => {
    const result = 规划图.改标题("不存在的旧标题", "新标题")
    expect(result.成功).toBe(false)
  })

  test("空标题应失败", () => {
    const result = 规划图.改标题("", "新标题")
    expect(result.成功).toBe(false)
  })
})

describe("9. 改依赖", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "依赖目标A", 0, 任务Tag.FEAT)
    规划图.添加任务(null, "描述2", "依赖目标B", 1, 任务Tag.DETAIL)
    规划图.添加任务(null, "描述3", "待改依赖任务", 2, 任务Tag.FIX)
  })

  test("修改依赖成功", () => {
    const newDeps: 任务依赖输入[] = [
      { 依赖任务: "依赖目标A", 原因: "新原因A" },
      { 依赖任务: "依赖目标B", 原因: "新原因B" },
    ]
    const result = 规划图.改依赖("待改依赖任务", newDeps)
    expect(result.成功).toBe(true)
    const found = 规划图.按标题查("待改依赖任务")
    const deps = JSON.parse(found[0].依赖!) as 任务依赖[]
    expect(deps).toHaveLength(2)
    expect("依赖任务" in deps[0]).toBe(false)
    expect("依赖任务" in deps[1]).toBe(false)
    expect(deps[0].依赖任务ID).toBe(规划图.按标题查("依赖目标A")[0].id)
    expect(deps[1].依赖任务ID).toBe(规划图.按标题查("依赖目标B")[0].id)
  })

  test("依赖任务不存在应失败", () => {
    const newDeps: 任务依赖输入[] = [{ 依赖任务: "不存在的任务", 原因: "原因" }]
    const result = 规划图.改依赖("待改依赖任务", newDeps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("不存在的任务应失败", () => {
    const newDeps: 任务依赖输入[] = []
    const result = 规划图.改依赖("不存在的任务", newDeps)
    expect(result.成功).toBe(false)
  })
})

describe("9.0 依赖旧数据迁移", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "旧依赖目标描述", "旧依赖目标", 0, 任务Tag.FEAT)
    const target = 规划图.按标题查("旧依赖目标")[0]
    getDb().prepare(
      "INSERT INTO 规划图 (标题, 父任务ID, Tag, 任务描述, 是否完成, 创建时间UTC, 优先级序号, 依赖, 是否删除, 动态) VALUES (?, NULL, ?, ?, 0, ?, 1, ?, 0, ?)"
    ).run(
      "旧格式依赖任务",
      JSON.stringify([任务Tag.FIX]),
      "旧格式依赖任务描述",
      new Date().toISOString(),
      JSON.stringify([{ 依赖任务: "旧依赖目标", 原因: "旧版本仅按标题存储" }]),
      JSON.stringify([]),
    )
    getDb().prepare(
      "INSERT INTO 规划图 (标题, 父任务ID, Tag, 任务描述, 是否完成, 创建时间UTC, 优先级序号, 依赖, 是否删除, 动态) VALUES (?, NULL, ?, ?, 0, ?, 2, ?, 0, ?)"
    ).run(
      "冗余标题依赖任务",
      JSON.stringify([任务Tag.FIX]),
      "冗余标题依赖任务描述",
      new Date().toISOString(),
      JSON.stringify([{ 依赖任务ID: target.id, 依赖任务: "旧依赖目标", 原因: "已有ID但冗余标题" }]),
      JSON.stringify([]),
    )
    initDb("test")
  })

  test("初始化时将title-only依赖迁移为ID-only", () => {
    const deps = JSON.parse(规划图.按标题查("旧格式依赖任务")[0].依赖!) as 任务依赖[]
    expect(deps).toEqual([{ 依赖任务ID: 规划图.按标题查("旧依赖目标")[0].id, 原因: "旧版本仅按标题存储" }])
  })

  test("初始化时移除已有ID依赖中的冗余标题字段", () => {
    const deps = JSON.parse(规划图.按标题查("冗余标题依赖任务")[0].依赖!) as 任务依赖[]
    expect(deps).toEqual([{ 依赖任务ID: 规划图.按标题查("旧依赖目标")[0].id, 原因: "已有ID但冗余标题" }])
  })

  test("迁移后查询视图仍显示可读标题", () => {
    expect(查询规划图_返回视图(20, undefined, undefined, 9999, 9999)).toContain("依赖: 旧依赖目标")
  })
})

describe("9.1 改依赖同级依赖校验", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "改依赖根任务", 0, 任务Tag.MILESTONE)
    规划图.添加任务("改依赖根任务", "任务A描述", "改依赖任务A", 0, 任务Tag.FEAT)
    规划图.添加任务("改依赖根任务", "任务B描述", "改依赖任务B", 1, 任务Tag.FEAT)
    规划图.添加任务("改依赖根任务", "任务C描述", "改依赖任务C", 2, 任务Tag.FEAT)
  })

  test("改依赖：后者依赖前者应成功", () => {
    const deps: 任务依赖输入[] = [{ 依赖任务: "改依赖任务A", 原因: "正确依赖" }]
    const result = 规划图.改依赖("改依赖任务B", deps)
    expect(result.成功).toBe(true)
  })

  test("改依赖：前者依赖后者应失败", () => {
    const deps: 任务依赖输入[] = [{ 依赖任务: "改依赖任务C", 原因: "错误依赖" }]
    const result = 规划图.改依赖("改依赖任务A", deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("改依赖任务A")
    expect(result.消息).toContain("改依赖任务C")
  })

  test("改依赖：跨父任务依赖不受限制", () => {
    规划图.添加任务(null, "另一根描述", "另一根任务", 0, 任务Tag.MILESTONE)
    规划图.添加任务("另一根任务", "跨级任务D描述", "改依赖跨级任务D", 5, 任务Tag.FEAT)
    const deps: 任务依赖输入[] = [{ 依赖任务: "改依赖跨级任务D", 原因: "跨父依赖" }]
    const result = 规划图.改依赖("改依赖任务A", deps)
    expect(result.成功).toBe(true)
  })

  test("改依赖：混合依赖应检测出第一个无效同级", () => {
    规划图.添加任务("改依赖根任务", "高优E1", "改依赖高优E1", 3, 任务Tag.FEAT)
    规划图.添加任务("改依赖根任务", "低优E2", "改依赖低优E2", 6, 任务Tag.FEAT)
    const mixedDeps: 任务依赖输入[] = [
      { 依赖任务: "改依赖低优E2", 原因: "无效-前者依赖后者" },
      { 依赖任务: "改依赖跨级任务D", 原因: "有效-跨父依赖" },
    ]
    const result = 规划图.改依赖("改依赖高优E1", mixedDeps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("改依赖高优E1")
    expect(result.消息).toContain("改依赖低优E2")
  })

  test("改依赖：根任务依赖不受同级限制", () => {
    const deps: 任务依赖输入[] = [{ 依赖任务: "另一根任务", 原因: "根任务依赖" }]
    const result = 规划图.改依赖("改依赖根任务", deps)
    expect(result.成功).toBe(true)
  })
})

describe("9.2 改优先级", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "改优先级根任务", 0, 任务Tag.MILESTONE)
    规划图.添加任务("改优先级根任务", "任务A描述", "任务A", 0, 任务Tag.FEAT)
    规划图.添加任务("改优先级根任务", "任务B描述", "任务B", 1, 任务Tag.FEAT)
    规划图.添加任务("改优先级根任务", "任务C描述", "任务C", 2, 任务Tag.FEAT)
    规划图.添加任务("改优先级根任务", "任务D描述", "任务D", 3, 任务Tag.FEAT)
    规划图.添加任务("改优先级根任务", "任务E描述", "任务E", 4, 任务Tag.FEAT)
  })

  test("改优先级成功", () => {
    const result = 规划图.改优先级("任务E", 1)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("从 4 改为 1")
  })

  test("改优先级后同级重新排序", () => {
    const 子任务 = 获取所有子任务("改优先级根任务")
    expect(子任务.find(t => t.标题 === "任务A")!.优先级序号).toBe(0)
    expect(子任务.find(t => t.标题 === "任务E")!.优先级序号).toBe(1)
    expect(子任务.find(t => t.标题 === "任务B")!.优先级序号).toBe(2)
    expect(子任务.find(t => t.标题 === "任务C")!.优先级序号).toBe(3)
    expect(子任务.find(t => t.标题 === "任务D")!.优先级序号).toBe(4)
  })

  test("改优先级消息包含前后任务位置", () => {
    const result = 规划图.改优先级("任务D", 0)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("前两个任务[无]")
    expect(result.消息).toContain("后两个任务[")
  })

  test("改优先级到末尾位置", () => {
    const result = 规划图.改优先级("任务A", 99999)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("后两个任务[无]")
    expect(result.消息).toContain("前两个任务[")
  })

  test("改优先级：根任务不受限制", () => {
    const result = 规划图.改优先级("改优先级根任务", 99999)
    expect(result.成功).toBe(true)
  })

  test("改优先级：不存在的任务应失败", () => {
    const result = 规划图.改优先级("不存在的任务", 0)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("改优先级：空标题应失败", () => {
    const result = 规划图.改优先级("", 0)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("标题不能为空")
  })

  test("改优先级不应制造非法依赖：被依赖任务移到依赖者后面应失败", () => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "依赖校验根", 0, 任务Tag.MILESTONE)
    规划图.添加任务("依赖校验根", "任务A描述", "依赖校验A", 0, 任务Tag.FEAT)
    const deps: 任务依赖输入[] = [{ 依赖任务: "依赖校验A", 原因: "依赖A" }]
    规划图.添加任务("依赖校验根", "任务B描述", "依赖校验B", 1, 任务Tag.FEAT, deps)
    const result = 规划图.改优先级("依赖校验A", 5)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("该任务被同级任务")
    expect(result.消息).toContain("依赖")
  })

  test("改优先级后序号连续无空洞", () => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "连续根", 0, 任务Tag.MILESTONE)
    规划图.添加任务("连续根", "X描述", "X", 0, 任务Tag.FEAT)
    规划图.添加任务("连续根", "Y描述", "Y", 1, 任务Tag.FEAT)
    规划图.添加任务("连续根", "Z描述", "Z", 2, 任务Tag.FEAT)
    const result = 规划图.改优先级("X", 2)
    expect(result.成功).toBe(true)
    const 子任务 = 获取所有子任务("连续根")
    const 优先级列表 = 子任务.map(t => t.优先级序号 ?? 0).sort((a, b) => a - b)
    expect(优先级列表).toEqual([0, 1, 2])
  })

  test("改优先级到超大值后序号连续无空洞", () => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "超大根", 0, 任务Tag.MILESTONE)
    规划图.添加任务("超大根", "A描述", "超大A", 0, 任务Tag.FEAT)
    规划图.添加任务("超大根", "B描述", "超大B", 1, 任务Tag.FEAT)
    规划图.添加任务("超大根", "C描述", "超大C", 2, 任务Tag.FEAT)
    const result = 规划图.改优先级("超大A", 99999)
    expect(result.成功).toBe(true)
    const 子任务 = 获取所有子任务("超大根")
    const 优先级列表 = 子任务.map(t => t.优先级序号 ?? 0).sort((a, b) => a - b)
    expect(优先级列表).toEqual([0, 1, 2])
    expect(子任务.find(t => t.标题 === "超大A")!.优先级序号).toBe(2)
    expect(子任务.find(t => t.标题 === "超大B")!.优先级序号).toBe(0)
    expect(子任务.find(t => t.标题 === "超大C")!.优先级序号).toBe(1)
  })

  test("改优先级到负数应被clamp到0", () => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "负数根", 0, 任务Tag.MILESTONE)
    规划图.添加任务("负数根", "A描述", "负数A", 0, 任务Tag.FEAT)
    规划图.添加任务("负数根", "B描述", "负数B", 1, 任务Tag.FEAT)
    规划图.添加任务("负数根", "C描述", "负数C", 2, 任务Tag.FEAT)
    const result = 规划图.改优先级("负数C", -1)
    expect(result.成功).toBe(true)
    const 子任务 = 获取所有子任务("负数根")
    const 优先级列表 = 子任务.map(t => t.优先级序号 ?? 0).sort((a, b) => a - b)
    expect(优先级列表).toEqual([0, 1, 2])
    expect(子任务.find(t => t.标题 === "负数C")!.优先级序号).toBe(0)
    expect(子任务.find(t => t.标题 === "负数A")!.优先级序号).toBe(1)
    expect(子任务.find(t => t.标题 === "负数B")!.优先级序号).toBe(2)
  })

  test("改优先级：自身有依赖时前移到依赖目标前面应失败", () => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "自依赖根", 0, 任务Tag.MILESTONE)
    规划图.添加任务("自依赖根", "A描述", "自依赖A", 0, 任务Tag.FEAT)
    const deps: 任务依赖输入[] = [{ 依赖任务: "自依赖A", 原因: "依赖A" }]
    规划图.添加任务("自依赖根", "B描述", "自依赖B", 1, 任务Tag.FEAT, deps)
    const result = 规划图.改优先级("自依赖B", 0)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("依赖")
  })
})

describe("9.3 改父任务", () => {
  beforeEach(() => {
    clearAllTasks()
    规划图.添加任务(null, "根A描述", "改父根A", 0, 任务Tag.MILESTONE)
    规划图.添加任务(null, "根B描述", "改父根B", 1, 任务Tag.MILESTONE)
    规划图.添加任务("改父根A", "子A描述", "改父子A", 0, 任务Tag.FEAT)
    规划图.添加任务("改父根A", "子B描述", "改父子B", 1, 任务Tag.FEAT)
    规划图.添加任务("改父子A", "孙A描述", "改父孙A", 0, 任务Tag.FEAT)
  })

  test("按标题修改父任务成功", () => {
    const result = 规划图.改父任务("改父子B", "改父根B")
    expect(result.成功).toBe(true)
    expect(规划图.按标题查("改父子B")[0].父任务ID).toBe(规划图.按标题查("改父根B")[0].id)
    expect(规划图.按标题查("改父子B")[0].Tag).toContain(任务Tag.MILESTONE)
  })

  test("按ID修改父任务成功", () => {
    const child = 规划图.按标题查("改父子B")[0]
    const parent = 规划图.按标题查("改父根B")[0]
    const result = 规划图.改父任务(undefined, undefined, child.id, parent.id)
    expect(result.成功).toBe(true)
    expect(规划图.按标题查("改父子B")[0].父任务ID).toBe(parent.id)
  })

  test("修改父任务后新旧同级优先级连续", () => {
    const result = 规划图.改父任务("改父子B", "改父根B")
    expect(result.成功).toBe(true)
    expect(获取所有子任务("改父根A").map(t => t.优先级序号)).toEqual([0])
    expect(获取所有子任务("改父根B").map(t => t.优先级序号)).toEqual([0])
  })

  test("不能移动到自己的后代任务之下", () => {
    const result = 规划图.改父任务("改父子A", "改父孙A")
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("后代")
  })

  test("根任务不能按子任务改父任务", () => {
    const result = 规划图.改父任务("改父根A", "改父根B")
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("根任务")
  })
})

describe("10. 标记为已完成", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "待完成任务", 0, 任务Tag.FEAT)
  })

  test("标记为已完成成功", () => {
    const result = 规划图.标记为已完成("待完成任务")
    expect(result.成功).toBe(true)
  })

  test("验证数据库已更新", () => {
    const found = 规划图.按标题查("待完成任务")
    expect(found).toHaveLength(1)
    expect(found[0].是否完成).toBe(true)
  })

  test("不存在的任务应失败", () => {
    const result = 规划图.标记为已完成("不存在的任务")
    expect(result.成功).toBe(false)
  })

  test("空标题应失败", () => {
    const result = 规划图.标记为已完成("")
    expect(result.成功).toBe(false)
  })
})

describe("10.1 级联标记为已完成", () => {
  beforeEach(() => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "完成根任务", 0, 任务Tag.MILESTONE)
    规划图.添加任务("完成根任务", "子A描述", "完成子A", 0, 任务Tag.FEAT)
    规划图.添加任务("完成子A", "孙A描述", "完成孙A", 0, 任务Tag.FEAT)
    规划图.添加任务("完成根任务", "子B描述", "完成子B", 1, 任务Tag.FEAT)
  })

  test("标记有未完成子任务的父任务应报错且不改变任何完成状态", () => {
    const result = 规划图.标记为已完成("完成根任务")
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不允许直接将父任务标记为完成")
    expect(result.消息).toContain("请先确保所有子任务完成")
    // 验证没有任何任务的完成状态被改变
    expect(规划图.按标题查("完成根任务")[0].是否完成).toBe(false)
    expect(规划图.按标题查("完成子A")[0].是否完成).toBe(false)
    expect(规划图.按标题查("完成孙A")[0].是否完成).toBe(false)
    expect(规划图.按标题查("完成子B")[0].是否完成).toBe(false)
  })

  test("确认完成有未完成子任务的父任务应报错且不改变任何完成状态", () => {
    const result = 规划图.确认完成("完成根任务")
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不允许直接将父任务标记为完成")
    expect(result.消息).toContain("请先确保所有子任务完成")
    // 验证没有任何任务的完成状态被改变
    expect(规划图.按标题查("完成根任务")[0].是否完成).toBe(false)
    expect(规划图.按标题查("完成子A")[0].是否完成).toBe(false)
    expect(规划图.按标题查("完成孙A")[0].是否完成).toBe(false)
    expect(规划图.按标题查("完成子B")[0].是否完成).toBe(false)
  })

  test("所有子任务完成后标记父任务应成功", () => {
    // 先完成所有子任务
    规划图.标记为已完成("完成孙A")
    规划图.标记为已完成("完成子A")
    规划图.标记为已完成("完成子B")
    // 再标记父任务
    const result = 规划图.标记为已完成("完成根任务")
    expect(result.成功).toBe(true)
  })

  test("级联完成后所有子任务均标记为已完成", () => {
    // 先完成所有子任务
    规划图.标记为已完成("完成孙A")
    规划图.标记为已完成("完成子A")
    规划图.标记为已完成("完成子B")
    // 标记父任务
    规划图.标记为已完成("完成根任务")

    const 根 = 规划图.按标题查("完成根任务")
    expect(根[0].是否完成).toBe(true)
    const 子A = 规划图.按标题查("完成子A")
    expect(子A[0].是否完成).toBe(true)
    const 孙A = 规划图.按标题查("完成孙A")
    expect(孙A[0].是否完成).toBe(true)
    const 子B = 规划图.按标题查("完成子B")
    expect(子B[0].是否完成).toBe(true)
  })

  test("标记无子任务的任务应静默完成", () => {
    clearAllTasks()
    规划图.添加任务(null, "描述", "孤立完成任务", 0, 任务Tag.FEAT)
    const result = 规划图.标记为已完成("孤立完成任务")
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("已完成")
  })
})

describe("10.2 末端任务完成时检查同级任务触发父任务级联完成", () => {
  beforeEach(() => {
    clearAllTasks()
    // 创建结构：父任务 -> 子任务A, 子任务B, 子任务C
    规划图.添加任务(null, "父描述", "级联父任务", 0, 任务Tag.MILESTONE)
    规划图.添加任务("级联父任务", "子A描述", "级联子A", 0, 任务Tag.FEAT)
    规划图.添加任务("级联父任务", "子B描述", "级联子B", 1, 任务Tag.FEAT)
    规划图.添加任务("级联父任务", "子C描述", "级联子C", 2, 任务Tag.FEAT)
  })

  test("完成第一个子任务后父任务不应自动完成", () => {
    const result = 规划图.标记为已完成("级联子A")
    expect(result.成功).toBe(true)
    const 父 = 规划图.按标题查("级联父任务")
    expect(父[0].是否完成).toBe(false)
  })

  test("完成第二个子任务后父任务仍不应自动完成", () => {
    const result = 规划图.标记为已完成("级联子B")
    expect(result.成功).toBe(true)
    const 父 = 规划图.按标题查("级联父任务")
    expect(父[0].是否完成).toBe(false)
  })

  test("完成最后一个同级子任务后父任务应自动标记为完成", () => {
    // 先完成子A和子B，确保它们标记为完成
    规划图.标记为已完成("级联子A")
    规划图.标记为已完成("级联子B")

    // 再完成子C，此时同级任务子A和子B都已完成，父任务应自动完成
    const result = 规划图.标记为已完成("级联子C")
    expect(result.成功).toBe(true)
    const 父 = 规划图.按标题查("级联父任务")
    expect(父[0].是否完成).toBe(true)
  })
})

describe("10.3 多层级联完成", () => {
  beforeEach(() => {
    clearAllTasks()
    // 创建三层结构：根 -> 父1/父2 -> 孙1/孙2/孙3/孙4
    规划图.添加任务(null, "多级根描述", "多级根任务", 0, 任务Tag.MILESTONE)
    规划图.添加任务("多级根任务", "父1描述", "多级父1", 0, 任务Tag.FEAT)
    规划图.添加任务("多级根任务", "父2描述", "多级父2", 1, 任务Tag.FEAT)
    规划图.添加任务("多级父1", "孙1描述", "多级孙1", 0, 任务Tag.FEAT)
    规划图.添加任务("多级父1", "孙2描述", "多级孙2", 1, 任务Tag.FEAT)
    规划图.添加任务("多级父2", "孙3描述", "多级孙3", 0, 任务Tag.FEAT)
    规划图.添加任务("多级父2", "孙4描述", "多级孙4", 1, 任务Tag.FEAT)
  })

  test("完成所有孙任务后只触发直接父任务自动完成", () => {
    // 完成孙1 - 父1不会自动完成因为孙2还没完成
    规划图.标记为已完成("多级孙1")
    expect(规划图.按标题查("多级父1")[0].是否完成).toBe(false)

    // 完成孙2 - 父1所有子任务完成，父1应自动完成
    规划图.标记为已完成("多级孙2")
    expect(规划图.按标题查("多级父1")[0].是否完成).toBe(true)
    // 父2不会受影响
    expect(规划图.按标题查("多级父2")[0].是否完成).toBe(false)
    // 根任务不会完成因为父2还有孙任务未完成
    expect(规划图.按标题查("多级根任务")[0].是否完成).toBe(false)
  })

  test("完成孙3不会触发父2自动完成因为孙4还未完成", () => {
    // 孙3的同级任务孙4还未完成，所以父2不会自动完成
    const result = 规划图.标记为已完成("多级孙3")
    expect(result.成功).toBe(true)
    expect(规划图.按标题查("多级父2")[0].是否完成).toBe(false)
  })

  test("孙任务完成后检查孙4状态确保多层级数据正确", () => {
    // 完成孙1、孙2、孙3、孙4
    规划图.标记为已完成("多级孙1")
    规划图.标记为已完成("多级孙2")
    规划图.标记为已完成("多级孙3")
    规划图.标记为已完成("多级孙4")

    // 验证所有孙任务都完成
    expect(规划图.按标题查("多级孙1")[0].是否完成).toBe(true)
    expect(规划图.按标题查("多级孙2")[0].是否完成).toBe(true)
    expect(规划图.按标题查("多级孙3")[0].是否完成).toBe(true)
    expect(规划图.按标题查("多级孙4")[0].是否完成).toBe(true)

    // 验证父1和父2都自动完成
    expect(规划图.按标题查("多级父1")[0].是否完成).toBe(true)
    expect(规划图.按标题查("多级父2")[0].是否完成).toBe(true)

    // 根任务应自动完成因为所有子任务（父1和父2）都完成了
    // 这是级联完成的正确行为：孙->父->根递归向上
    expect(规划图.按标题查("多级根任务")[0].是否完成).toBe(true)
  })
})

describe("10.4 根任务完成行为", () => {
  beforeEach(() => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "根完成测试", 0, 任务Tag.MILESTONE)
    规划图.添加任务("根完成测试", "子描述", "根子任务1", 0, 任务Tag.FEAT)
    规划图.添加任务("根完成测试", "子描述", "根子任务2", 1, 任务Tag.FEAT)
  })

  test("完成根任务的第一个子任务后根任务不应自动完成", () => {
    规划图.标记为已完成("根子任务1")
    const 根 = 规划图.按标题查("根完成测试")
    expect(根[0].是否完成).toBe(false)
  })

  test("完成根任务的所有子任务后根任务应自动完成", () => {
    规划图.标记为已完成("根子任务1")
    规划图.标记为已完成("根子任务2")
    const 根 = 规划图.按标题查("根完成测试")
    expect(根[0].是否完成).toBe(true)
  })

  test("只有单一子任务的根任务在子任务完成后根任务应自动完成", () => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "单子根", 0, 任务Tag.MILESTONE)
    规划图.添加任务("单子根", "子描述", "单子任务", 0, 任务Tag.FEAT)

    规划图.标记为已完成("单子任务")
    const 根 = 规划图.按标题查("单子根")
    expect(根[0].是否完成).toBe(true)
  })
})

describe("11. 添加动态", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "描述1", "动态测试任务", 0, 任务Tag.FEAT)
  })

  test("添加动态成功", () => {
    const result = 规划图.添加动态("动态测试任务", "planner", "开始规划")
    expect(result.成功).toBe(true)
  })

  test("验证数据库已更新", () => {
    const found = 规划图.按标题查("动态测试任务")
    expect(found[0].动态).toHaveLength(1)
  })

  test("添加第二条动态", () => {
    const result = 规划图.添加动态("动态测试任务", "executor", "执行中")
    expect(result.成功).toBe(true)
  })

  test("验证数据库已更新", () => {
    const found = 规划图.按标题查("动态测试任务")
    expect(found).toHaveLength(1)
    expect(found[0].动态).toHaveLength(2)
  })

  test("不存在的任务应失败", () => {
    const result = 规划图.添加动态("不存在的任务", "planner", "消息")
    expect(result.成功).toBe(false)
  })

  test("空角色应失败", () => {
    const result = 规划图.添加动态("动态测试任务", "", "消息")
    expect(result.成功).toBe(false)
  })

  test("空消息应失败", () => {
    const result = 规划图.添加动态("动态测试任务", "planner", "")
    expect(result.成功).toBe(false)
  })
})

describe("查询规划图视图（含动态）", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "根描述", "视图根任务", 0, 任务Tag.FEAT)
    规划图.添加任务("视图根任务", "子描述", "视图子任务", 0, 任务Tag.DETAIL)
  })

  test("查询规划图返回格式化字符串", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 1000)
    expect(typeof result).toBe("string")
    expect(result).toContain("规划图统计")
    expect(result).toContain("规划图视图")
  })

  test("聚焦数量为0应返回错误", () => {
    const result = 查询规划图_返回视图(0, undefined, undefined, 1000, 1000)
    expect(result).toContain("错误")
  })

  test("无效时间格式应返回错误", () => {
    const result = 查询规划图_返回视图(10, "invalid-date", undefined, 1000, 1000)
    expect(result).toContain("错误")
  })

  test("从到都不传时应查全部（无时间约束）", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 1000)
    expect(result).toContain("视图根任务")
    expect(result).toContain("视图子任务")
  })

  test("仅传从时查从时间起点以后的任务（窗口内任务应包含）", () => {
    const result = 查询规划图_返回视图(10, "2020-01-01T00:00:00Z", undefined, 1000, 1000)
    expect(result).toContain("视图根任务")
    expect(result).toContain("视图子任务")
  })

  test("仅传到时查到时间终点以前的任务（当前时间任务在窗口外应排除）", () => {
    const result = 查询规划图_返回视图(10, undefined, "2020-01-01T00:00:00Z", 1000, 1000)
    expect(result).toContain("当前展示数量: 0")
    expect(result).not.toContain("视图根任务")
  })

  test("从到都有时查时间段内的任务（当前时间任务在窗口外应排除）", () => {
    const result = 查询规划图_返回视图(10, "2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z", 1000, 1000)
    expect(result).toContain("当前展示数量: 0")
    expect(result).not.toContain("视图根任务")
  })
})

describe("查询规划图视图 - 描述折叠", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "这是一段很长的任务描述，用于测试折叠功能是否正常工作，当描述超过阈值时应该被截断并显示折叠提示", "长描述任务", 0, 任务Tag.FEAT)
    规划图.添加任务(null, "短描述", "短描述任务", 1, 任务Tag.DETAIL)
  })

  test("描述超过阈值时被截断", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 10, 1000)
    expect(result).toContain("长描述任务")
    expect(result).toContain("(..折叠")
    expect(result).toContain("字)")
  })

  test("描述截断后保留前N字", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 5, 1000)
    expect(result).toContain("这是一段很(..折叠")
  })

  test("描述未超过阈值时不被截断", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 100, 1000)
    expect(result).toContain("短描述")
    expect(result).not.toContain("(..折叠")
  })

  test("描述恰好等于阈值时不被截断", () => {
    clearAllTasks()
    规划图.添加任务(null, "abc", "等长任务", 0, 任务Tag.FEAT)
    const result = 查询规划图_返回视图(10, undefined, undefined, 3, 1000)
    expect(result).toContain("abc")
    expect(result).not.toContain("(..折叠")
  })
})

describe("查询规划图视图 - 动态折叠", () => {
  beforeAll(() => {
    clearAllTasks()
    规划图.添加任务(null, "动态折叠测试任务", "动态折叠任务", 0, 任务Tag.FEAT)
    规划图.添加动态("动态折叠任务", "planner", "第一条新动态")
    规划图.添加动态("动态折叠任务", "executor", "第二条动态消息内容比较长一些")
    规划图.添加动态("动态折叠任务", "evaluator", "第三条旧动态")
  })

  test("动态消息总字数超过阈值时被截断", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 10)
    expect(result).toContain("动态折叠任务")
    expect(result).toContain("(..折叠")
    expect(result).toContain("个动态)")
  })

  test("动态折叠保留新动态，折叠旧动态", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 8)
    expect(result).toContain("第一条新动态")
    expect(result).not.toContain("第二条动态消息内容比较长一些")
    expect(result).not.toContain("第三条旧动态")
    expect(result).toContain("(..折叠1个动态)")
  })

  test("动态字数阈值仅统计消息内容，不统计序号时间角色前缀", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, "第一条新动态".length)
    expect(result).toContain("第一条新动态」")
    expect(result).toContain("1.「")
    expect(result).toContain("planner：")
    expect(result).not.toContain("第一条新动(..折叠")
    expect(result).toContain("(..折叠2个动态)")
  })

  test("超过动态字数阈值的首条消息被截断并以折叠数量结尾", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 5)
    expect(result).toContain("第一条新")
    expect(result).not.toContain("第一条新动态")
    expect(result).toContain("(..折叠2个动态)")
  })

  test("动态折叠仅折叠超出部分", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 15)
    expect(result).toContain("第一条新动态")
    expect(result).not.toContain("第二条动态消息内容比较长一些")
    expect(result).toContain("第二条动态消息内")
    expect(result).toContain("(..折叠1个动态)")
  })

  test("动态消息总字数未超过阈值时全部显示", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 50)
    expect(result).toContain("第一条新动态")
    expect(result).toContain("第二条动态消息内容比较长一些")
    expect(result).toContain("第三条旧动态")
    expect(result).not.toContain("(..折叠")
  })

  test("任务动态字数展示阈值为0时仅显示折叠提示", () => {
    const result = 查询规划图_返回视图(10, undefined, undefined, 1000, 0)
    expect(result).toContain("动态折叠任务")
    expect(result).toContain("(..折叠3个动态)")
  })
})

// 辅助函数：运行 CLI 命令
function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  return new Promise((resolve) => {
    const cliPath = join(__dirname, "../规划图CLI.ts")
    const proc = spawn("npx", ["tsx", cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
    })

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 })
    })
  })
}

// 辅助函数：运行需要交互输入的 CLI 命令
// 注意：CLI 在需要确认时会先输出提示文本到 stdout，再输出 JSON
// 因此 stdout 可能是混合文本，需要提取其中的 JSON
function runCliWithInput(args: string[], input: string, env: Record<string, string> = {}): Promise<{ stdout: string, stderr: string, exitCode: number, jsonOutput?: object }> {
  return new Promise((resolve) => {
    const cliPath = join(__dirname, "../规划图CLI.ts")
    const proc = spawn("npx", ["tsx", cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let inputSent = false
    const sendInput = () => {
      if (inputSent) return
      inputSent = true
      proc.stdin?.end(input)
    }

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
      if (stdout.includes("(y/n)") || stdout.includes("y新建，n退出") || stdout.includes("选择y确认")) sendInput()
    })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (exitCode) => {
      // 尝试从 stdout 中提取 JSON（可能有提示文本在前）
      let jsonOutput: object | undefined
      const jsonStart = stdout.indexOf('{')
      if (jsonStart !== -1) {
        try {
          jsonOutput = JSON.parse(stdout.slice(jsonStart))
        } catch {
          // JSON 解析失败，忽略
        }
      }
      resolve({ stdout, stderr, exitCode: exitCode ?? 0, jsonOutput })
    })

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 })
    })

    setTimeout(sendInput, 1000).unref()
  })
}

describe("CLI命令集成测试", () => {
  const cliEnv = { SCHEDULEMAP_PROJECT_NAME: "test" }

  test("CLI help命令", async () => {
    const { stdout } = await runCli(["help"], cliEnv)
    expect(stdout).toContain("规划图CLI")
    expect(stdout).toContain("add")
    expect(stdout).toContain("delete")
    expect(stdout).toContain("query-by-title")
  })

  test("CLI init命令", async () => {
    const uniqueProject = `clitest_${Date.now()}`
    const { stdout } = await runCli(["init", "--项目", uniqueProject, "--WRITE_KEY", 写入Key], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain(uniqueProject)
  })

  test("CLI init命令缺少项目参数应失败", async () => {
    const { stdout } = await runCli(["init"], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI add命令", async () => {
    await runCli(["delete", "--标题", "CLI测试任务", "--WRITE_KEY", 写入Key], cliEnv)

    const { stdout } = await runCli([
      "add",
      "--标题", "CLI测试任务",
      "--描述", "这是一个通过CLI添加的任务",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
  })

  test("CLI query-by-title命令", async () => {
    const { stdout } = await runCli(["query-by-title", "--标题", "CLI测试任务"], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
    expect(result.数量).toBeGreaterThanOrEqual(1)
  })

  test("CLI mark-complete命令", async () => {
    const { stdout } = await runCli(["mark-complete", "--标题", "CLI测试任务", "--WRITE_KEY", 写入Key], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
  })

  test("CLI delete命令", async () => {
    await runCli([
      "add",
      "--标题", "CLI删除测试任务",
      "--描述", "用于测试删除",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)

    const { stdout } = await runCli(["delete", "--标题", "CLI删除测试任务", "--WRITE_KEY", 写入Key], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
  })

  test("CLI 删除有子任务的任务，输入 y 确认删除", async () => {
    // 先添加父任务和子任务
    await runCli([
      "add",
      "--标题", "CLI待删除父任务",
      "--描述", "用于测试交互删除",
      "--优先级", "0",
      "--Tag", "milestone",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    await runCliWithInput([
      "add",
      "--标题", "CLI待删除子任务",
      "--描述", "子任务描述",
      "--优先级", "0",
      "--Tag", "feat",
      "--父任务", "CLI待删除父任务",
      "--WRITE_KEY", 写入Key,
    ], "y\n", cliEnv)

    // 确认任务存在
    let { stdout: queryStdout } = await runCli(["query-by-title", "--标题", "CLI待删除父任务"], cliEnv)
    let queryResult = JSON.parse(queryStdout)
    expect(queryResult.成功).toBe(true)
    expect(queryResult.任务[0].已删除).toBe(false)

    // 输入 y 确认删除
    const { jsonOutput } = await runCliWithInput(["delete", "--标题", "CLI待删除父任务", "--WRITE_KEY", 写入Key], "y\n", cliEnv)
    expect(jsonOutput).toBeDefined()
    expect((jsonOutput as any).成功).toBe(true)
    expect((jsonOutput as any).消息).toContain("已删除任务")
    expect((jsonOutput as any).消息).toContain("所有子任务")

    // 验证任务已被删除
    queryStdout = await runCli(["query-by-title", "--标题", "CLI待删除父任务"], cliEnv).then(r => r.stdout)
    queryResult = JSON.parse(queryStdout)
    expect(queryResult.任务[0].已删除).toBe(true)
  }, 15000)

  test("CLI 删除有子任务的任务，输入 n 取消删除", async () => {
    // 先添加父任务和子任务
    await runCli([
      "add",
      "--标题", "CLI取消删除父任务",
      "--描述", "用于测试取消删除",
      "--优先级", "0",
      "--Tag", "milestone",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    await runCliWithInput([
      "add",
      "--标题", "CLI取消删除子任务",
      "--描述", "子任务描述",
      "--优先级", "0",
      "--Tag", "feat",
      "--父任务", "CLI取消删除父任务",
      "--WRITE_KEY", 写入Key,
    ], "y\n", cliEnv)

    // 确认任务存在
    let { stdout: queryStdout } = await runCli(["query-by-title", "--标题", "CLI取消删除父任务"], cliEnv)
    let queryResult = JSON.parse(queryStdout)
    expect(queryResult.成功).toBe(true)
    expect(queryResult.任务[0].已删除).toBe(false)

    // 输入 n 取消删除
    const { jsonOutput } = await runCliWithInput(["delete", "--标题", "CLI取消删除父任务", "--WRITE_KEY", 写入Key], "n\n", cliEnv)
    expect(jsonOutput).toBeDefined()
    expect((jsonOutput as any).成功).toBe(false)
    expect((jsonOutput as any).消息).toBe("已取消删除")

    // 验证任务未被删除
    queryStdout = await runCli(["query-by-title", "--标题", "CLI取消删除父任务"], cliEnv).then(r => r.stdout)
    queryResult = JSON.parse(queryStdout)
    expect(queryResult.任务[0].已删除).toBe(false)

    // 子任务也未被删除
    queryStdout = await runCli(["query-by-title", "--标题", "CLI取消删除子任务"], cliEnv).then(r => r.stdout)
    queryResult = JSON.parse(queryStdout)
    expect(queryResult.任务[0].已删除).toBe(false)
  }, 15000)

  test("CLI query-deleted命令", async () => {
    const { stdout } = await runCli([
      "query-deleted",
      "--数量", "10",
      "--描述字数阈值", "50",
      "--动态字数阈值", "100",
    ], cliEnv)
    expect(stdout).toContain("已删除任务")
    expect(stdout).not.toContain("成功")
  })

  test("CLI query-deleted缺少参数应失败", async () => {
    const { stdout } = await runCli(["query-deleted", "--数量", "10"], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI 缺少必需参数应失败", async () => {
    const { stdout } = await runCli(["add", "--标题", "缺少描述的任务", "--WRITE_KEY", 写入Key], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI add缺少优先级应失败", async () => {
    const { stdout } = await runCli([
      "add",
      "--标题", "缺少优先级任务",
      "--描述", "测试描述",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI 任务不存在错误应返回JSON", async () => {
    const { stdout } = await runCli(["delete", "--标题", "不存在的任务XYZ", "--WRITE_KEY", 写入Key], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("CLI 无效JSON参数应返回错误", async () => {
    const { stdout } = await runCli([
      "update-dependency",
      "--标题", "某任务",
      "--新依赖", "not-valid-json",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("JSON参数解析失败")
  })

  test("CLI 未知命令应返回错误", async () => {
    const { stdout } = await runCli(["unknown-command"], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("未知命令")
  })

  test("CLI add-activity命令", async () => {
    await runCli([
      "add",
      "--标题", "CLI测试任务",
      "--描述", "重新添加用于动态测试",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)

    const { stdout } = await runCli([
      "add-activity",
      "--标题", "CLI测试任务",
      "--角色", "planner",
      "--消息", "CLI动态测试消息",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
  })

  test("CLI add-activity缺少参数应失败", async () => {
    const { stdout } = await runCli([
      "add-activity",
      "--标题", "CLI测试任务",
      "--角色", "planner",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI update-priority命令", async () => {
    await runCli([
      "add",
      "--标题", "优先级测试任务",
      "--描述", "用于测试优先级变更",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)

    const { stdout } = await runCli([
      "update-priority",
      "--标题", "优先级测试任务",
      "--新优先级", "5",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("优先级")
  })

  test("CLI update-priority缺少参数应失败", async () => {
    const { stdout } = await runCli([
      "update-priority",
      "--标题", "优先级测试任务",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI update-parent命令支持标题和ID", async () => {
    const prefix = `CLI改父${Date.now()}`
    await runCli(["add", "--标题", `${prefix}根A`, "--描述", "根A", "--优先级", "0", "--Tag", "milestone", "--WRITE_KEY", 写入Key], cliEnv)
    await runCli(["add", "--标题", `${prefix}根B`, "--描述", "根B", "--优先级", "1", "--Tag", "milestone", "--WRITE_KEY", 写入Key], cliEnv)
    await runCliWithInput(["add", "--标题", `${prefix}子A`, "--描述", "子A", "--优先级", "0", "--父任务", `${prefix}根A`, "--Tag", "feat", "--WRITE_KEY", 写入Key], "y\n", cliEnv)
    await runCliWithInput(["add", "--标题", `${prefix}子B`, "--描述", "子B", "--优先级", "1", "--父任务", `${prefix}根A`, "--Tag", "feat", "--WRITE_KEY", 写入Key], "y\n", cliEnv)

    const titleResult = (await runCliWithInput(["update-parent", "--标题", `${prefix}子A`, "--新父任务", `${prefix}根B`, "--WRITE_KEY", 写入Key], "y\n", cliEnv)).jsonOutput as { 成功: boolean }
    expect(titleResult.成功).toBe(true)

    const child = JSON.parse((await runCli(["query-by-title", "--标题", `${prefix}子B`], cliEnv)).stdout).任务[0]
    const parent = JSON.parse((await runCli(["query-by-title", "--标题", `${prefix}根B`], cliEnv)).stdout).任务[0]
    const idResult = (await runCliWithInput(["update-parent", "--id", String(child.id), "--新父任务ID", String(parent.id), "--WRITE_KEY", 写入Key], "y\n", cliEnv)).jsonOutput as { 成功: boolean }
    expect(idResult.成功).toBe(true)
  }, 20000)

  test("CLI add设置为根后一级时允许反悔", async () => {
    const prefix = `CLI反悔${Date.now()}`
    await runCli(["add", "--标题", `${prefix}根`, "--描述", "根", "--优先级", "0", "--Tag", "milestone", "--WRITE_KEY", 写入Key], cliEnv)
    const { jsonOutput } = await runCliWithInput(["add", "--标题", `${prefix}子`, "--描述", "子", "--优先级", "0", "--父任务", `${prefix}根`, "--Tag", "feat", "--WRITE_KEY", 写入Key], "n\n", cliEnv)
    expect((jsonOutput as { 成功: boolean, 消息: string }).成功).toBe(false)
    expect((jsonOutput as { 成功: boolean, 消息: string }).消息).toBe("已取消操作")
  }, 10000)

  test("CLI query命令缺少阈值参数应失败", async () => {
    const { stdout } = await runCli([
      "query",
      "--数量", "10",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI query命令完整调用", async () => {
    const { stdout } = await runCli([
      "query",
      "--数量", "10",
      "--描述字数阈值", "50",
      "--动态字数阈值", "100",
    ], cliEnv)
    expect(stdout).toContain("规划图视图")
    expect(stdout).not.toContain("成功")
  })
})

describe("CLI写入Key验证", () => {
  const cliEnv = { SCHEDULEMAP_PROJECT_NAME: "test" }

  test("add命令缺少写入Key应失败", async () => {
    const { stdout } = await runCli([
      "add",
      "--标题", "缺少写入Key测试任务",
      "--描述", "测试描述",
      "--优先级", "0",
      "--Tag", "feat",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("旧WRITEIN_PASSWORD参数不再授予写入权限", async () => {
    const { stdout } = await runCli([
      "add",
      "--标题", "旧参数测试任务",
      "--描述", "测试描述",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITEIN_PASSWORD", 写入Key,
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("add命令写入Key错误应失败", async () => {
    const { stdout } = await runCli([
      "add",
      "--标题", "密码测试任务",
      "--描述", "测试描述",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("delete命令写入Key错误应失败", async () => {
    const { stdout } = await runCli([
      "delete",
      "--标题", "不存在的任务",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("update-description命令写入Key错误应失败", async () => {
    const { stdout } = await runCli([
      "update-description",
      "--标题", "某任务",
      "--新描述", "新描述",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("update-title命令写入Key错误应失败", async () => {
    const { stdout } = await runCli([
      "update-title",
      "--标题", "旧标题",
      "--新标题", "新标题",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("update-dependency命令写入Key错误应失败", async () => {
    const { stdout } = await runCli([
      "update-dependency",
      "--标题", "某任务",
      "--新依赖", "[]",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("update-priority命令写入Key错误应失败", async () => {
    const { stdout } = await runCli([
      "update-priority",
      "--标题", "某任务",
      "--新优先级", "5",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("mark-complete命令写入Key错误应失败", async () => {
    const { stdout } = await runCli([
      "mark-complete",
      "--标题", "某任务",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("add-activity命令不校验写入Key", async () => {
    await runCli([
      "add",
      "--标题", "动态免Key测试任务",
      "--描述", "测试描述",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)

    const { stdout } = await runCli([
      "add-activity",
      "--标题", "动态免Key测试任务",
      "--角色", "planner",
      "--消息", "测试消息",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
  })

  test("不需要写入Key的查询命令额外携带Key也应稳定成功", async () => {
    await runCli([
      "add",
      "--标题", "查询免Key测试任务",
      "--描述", "测试描述",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)

    const byTitle = JSON.parse((await runCli([
      "query-by-title",
      "--标题", "查询免Key测试任务",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)).stdout)
    expect(byTitle.成功).toBe(true)
    expect(byTitle.数量).toBeGreaterThanOrEqual(1)

    const byId = JSON.parse((await runCli([
      "query-by-id",
      "--id", String(byTitle.任务[0].id),
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)).stdout)
    expect(byId.成功).toBe(true)

    const byTag = JSON.parse((await runCli([
      "query-by-tag",
      "--Tag", "feat",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)).stdout)
    expect(byTag.成功).toBe(true)

    const dependencyChain = JSON.parse((await runCli([
      "query-dependency-chain",
      "--标题", "查询免Key测试任务",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)).stdout)
    expect(dependencyChain.成功).toBe(true)

    const query = await runCli([
      "query",
      "--数量", "10",
      "--描述字数阈值", "50",
      "--动态字数阈值", "100",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    expect(query.stdout).toContain("规划图视图")

    const deleted = await runCli([
      "query-deleted",
      "--数量", "10",
      "--描述字数阈值", "50",
      "--动态字数阈值", "100",
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    expect(deleted.stdout).toContain("已删除任务")
  }, 20000)

  test("init命令写入Key错误应失败", async () => {
    const uniqueProject = `pwtest_${Date.now()}`
    const { stdout } = await runCli([
      "init",
      "--项目", uniqueProject,
      "--WRITE_KEY", "wrong-key",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toBe("写入Key错误")
  })

  test("查询命令不需要密码", async () => {
    // query是只读命令，不应该需要密码
    const { stdout } = await runCli([
      "query-by-title",
      "--标题", "不存在的任务",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
    expect(result.数量).toBe(0)
  })

  test("写入Key正确时add命令成功", async () => {
    const { stdout } = await runCli([
      "add",
      "--标题", "正确密码测试任务",
      "--描述", "测试描述",
      "--优先级", "0",
      "--Tag", "feat",
      "--WRITE_KEY", 写入Key,
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
  })
})
