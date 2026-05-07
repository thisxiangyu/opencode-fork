/**
 * 任务表CLI 全面测试
 * 使用独立test项目数据库，每项操作后验证状态
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { rmSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"
import {
  initDb,
  任务表,
  查询任务表_返回视图,
  当前表中全部任务数,
  当前表中总任务数_仅末端,
  加载根任务,
  任务Tag,
  type 任务依赖,
  type 动态记录,
  getDb,
  任务表dbPath,
  解析任务行,
  type 任务Row,
  type 任务,
  type AddedTaskMsg,
} from "../任务表CLI"

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_PROJECT_DIR = join(__dirname, "data", ".taskTable.test")
const TEST_DB_PATH = join(TEST_PROJECT_DIR, "testTaskTable.db")

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
  const db = getDb()
  db.exec("DELETE FROM 任务表")
}

function 获取所有子任务(父任务标题: string): 任务[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM 任务表 WHERE 是否删除 = 0 AND 父任务标题 = ? ORDER BY 优先级序号 ASC").all(父任务标题) as 任务Row[]
  return rows.map(解析任务行)
}

describe("1. 添加任务", () => {
  beforeAll(() => clearAllTasks())

  test("添加根任务成功", () => {
    const result = 任务表.添加任务(
      null,
      "这是一个根任务的描述，用于测试添加功能",
      "根任务A",
      0,
      任务Tag.FEAT,
    )
    expect(result.成功).toBe(true)
    expect(result.res任务).toBeDefined()
    expect(result.res任务!.任务描述).toBe("这是一个根任务的描述，用于测试添加功能")
    expect(result.res任务!.是否完成).toBe(false)
    expect((result.res任务 as AddedTaskMsg).创建时间).toBeDefined()
    expect(result.res任务!.优先级序号).toBe(0)
    expect(当前表中全部任务数()).toBe(1)
  })

  test("添加子任务成功", () => {
    const result = 任务表.添加任务(
      "根任务A",
      "这是子任务B的描述",
      "子任务B",
      0,
      任务Tag.DETAIL,
    )
    expect(result.成功).toBe(true)
    expect(result.res任务!.任务描述).toBe("这是子任务B的描述")
    expect(result.res任务!.是否完成).toBe(false)
    expect(result.res任务!.优先级序号).toBe(0)
    expect(当前表中全部任务数()).toBe(2)
  })

  test("添加带依赖的任务", () => {
    const deps: 任务依赖[] = [{ 依赖任务: "子任务B", 原因: "需要先完成B" }]
    const result = 任务表.添加任务(
      "根任务A",
      "这是子任务C的描述，依赖B",
      "子任务C",
      1,
      任务Tag.FIX,
      deps,
    )
    expect(result.成功).toBe(true)
    expect(result.res任务!.任务描述).toBe("这是子任务C的描述，依赖B")
    expect(result.res任务!.是否完成).toBe(false)
    expect(result.res任务!.优先级序号).toBe(1)
  })

  test("添加带其它Tag的任务", () => {
    const result = 任务表.添加任务(
      null,
      "根任务D的描述",
      "根任务D",
      1,
      任务Tag.REFACTOR,
      [],
      [任务Tag.DETAIL, 任务Tag.CHORE],
    )
    expect(result.成功).toBe(true)
    expect(result.res任务!.任务描述).toBe("根任务D的描述")
    expect(result.res任务!.是否完成).toBe(false)
    expect(result.res任务!.优先级序号).toBe(1)
  })

  test("标题为空应失败", () => {
    const result = 任务表.添加任务(null, "描述", "  ", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("标题不能为空")
  })

  test("描述为空应失败", () => {
    const result = 任务表.添加任务(null, "", "新任务", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("任务描述不能为空")
  })

  test("重复标题应失败", () => {
    const result = 任务表.添加任务(null, "描述", "根任务A", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("已存在")
  })

  test("父任务不存在应失败", () => {
    const result = 任务表.添加任务("不存在的父任务", "描述", "新任务", 0, 任务Tag.FEAT)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("传入超大优先级序号自动截断到末尾", () => {
    const result = 任务表.添加任务(null, "大序号描述", "大序号任务", 99999, 任务Tag.FEAT)
    expect(result.成功).toBe(true)
    expect(result.res任务!.优先级序号).toBeGreaterThan(1)
    expect(result.消息).toContain("优先级")
  })

  test("传入合理优先级序号不被截断", () => {
    const result = 任务表.添加任务(null, "中间描述", "中间任务", 2, 任务Tag.FEAT)
    expect(result.成功).toBe(true)
    expect(result.res任务!.优先级序号).toBe(2)
  })
})

describe("1.1 同级任务依赖校验", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "根任务X", 0, 任务Tag.MILESTONE)
  })

  test("同级任务后者依赖前者应成功", () => {
    任务表.添加任务("根任务X", "任务A描述", "任务A", 0, 任务Tag.FEAT)
    const deps: 任务依赖[] = [{ 依赖任务: "任务A", 原因: "需要先做A" }]
    const result = 任务表.添加任务("根任务X", "任务B描述", "任务B", 1, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(true)
  })

  test("同级任务前者依赖后者应失败", () => {
    const deps: 任务依赖[] = [{ 依赖任务: "任务B", 原因: "错误依赖" }]
    const result = 任务表.添加任务("根任务X", "任务C描述", "任务C", 0, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("任务C")
    expect(result.消息).toContain("任务B")
  })

  test("跨父任务的依赖不受限制", () => {
    任务表.添加任务(null, "根2描述", "根任务Y", 0, 任务Tag.MILESTONE)
    任务表.添加任务("根任务Y", "跨级任务D描述", "跨级任务D", 5, 任务Tag.FEAT)
    const deps: 任务依赖[] = [{ 依赖任务: "跨级任务D", 原因: "跨父依赖" }]
    const result = 任务表.添加任务("根任务X", "跨级任务E描述", "跨级任务E", 0, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(true)
  })

  test("添加任务时混合依赖应检测出第一个无效同级", () => {
    任务表.添加任务("根任务X", "高优描述", "高优任务P", 2, 任务Tag.FEAT)
    任务表.添加任务("根任务X", "低优描述", "低优任务Q", 5, 任务Tag.FEAT)
    const mixedDeps: 任务依赖[] = [
      { 依赖任务: "低优任务Q", 原因: "无效-前者依赖后者" },
      { 依赖任务: "高优任务P", 原因: "有效-后者依赖前者" },
    ]
    const result = 任务表.添加任务("根任务X", "混合依赖描述", "混合依赖任务R", 3, 任务Tag.FEAT, mixedDeps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("混合依赖任务R")
    expect(result.消息).toContain("低优任务Q")
  })

  test("新增任务同优先级插入并依赖该已有任务应失败", () => {
    任务表.添加任务("根任务X", "已有任务S", "已有任务S", 2, 任务Tag.FEAT)
    const deps: 任务依赖[] = [{ 依赖任务: "已有任务S", 原因: "同优先级插入依赖" }]
    const result = 任务表.添加任务("根任务X", "新增同优任务T", "新增同优任务T", 2, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("新增同优任务T")
    expect(result.消息).toContain("已有任务S")
  })

  test("添加任务依赖不存在的任务应失败", () => {
    const deps: 任务依赖[] = [{ 依赖任务: "不存在的依赖目标", 原因: "测试" }]
    const result = 任务表.添加任务("根任务X", "描述", "依赖不存在任务", 5, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("根任务添加依赖不受同级限制", () => {
    const deps: 任务依赖[] = [{ 依赖任务: "根任务Y", 原因: "根任务依赖" }]
    const result = 任务表.添加任务(null, "新根任务描述", "新根任务Z", 0, 任务Tag.FEAT, deps)
    expect(result.成功).toBe(true)
  })
})

describe("2. 删除任务（软删除）", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "待删任务", 0, 任务Tag.FEAT)
    任务表.添加任务(null, "描述2", "保留任务", 1, 任务Tag.FEAT)
  })

  test("软删除成功", () => {
    const result = 任务表.删除任务("待删任务")
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("已删除")
  })

  test("软删除后精确查询仍能找到但标记为已删除", () => {
    const found = 任务表.按标题查("待删任务")
    expect(found).toHaveLength(1)
    expect(found[0].已删除).toBe(true)
  })

  test("软删除后总数减少", () => {
    expect(当前表中全部任务数()).toBe(1)
  })

  test("删除不存在的任务应失败", () => {
    const result = 任务表.删除任务("不存在的任务")
    expect(result.成功).toBe(false)
  })

  test("删除空标题应失败", () => {
    const result = 任务表.删除任务("")
    expect(result.成功).toBe(false)
  })
})

describe("2.1 级联删除", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "级联根任务", 0, 任务Tag.MILESTONE)
    任务表.添加任务("级联根任务", "子A描述", "级联子A", 0, 任务Tag.FEAT)
    任务表.添加任务("级联子A", "孙A描述", "级联孙A", 0, 任务Tag.FEAT)
    任务表.添加任务("级联根任务", "子B描述", "级联子B", 1, 任务Tag.FEAT)
  })

  test("删除有子任务的任务应返回需要确认", () => {
    const result = 任务表.删除任务("级联根任务")
    expect(result.成功).toBe(false)
    expect(result.需要确认).toBe(true)
    expect(result.子任务数).toBe(3)
    expect(result.消息).toContain("级联根任务")
    expect(result.消息).toContain("3个子任务")
  })

  test("确认删除应级联删除所有子任务", () => {
    const result = 任务表.确认删除("级联根任务")
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("级联根任务")
    expect(result.消息).toContain("所有子任务")
  })

  test("级联删除后所有子任务均标记为已删除", () => {
    const 根 = 任务表.按标题查("级联根任务")
    expect(根[0].已删除).toBe(true)
    const 子A = 任务表.按标题查("级联子A")
    expect(子A[0].已删除).toBe(true)
    const 孙A = 任务表.按标题查("级联孙A")
    expect(孙A[0].已删除).toBe(true)
    const 子B = 任务表.按标题查("级联子B")
    expect(子B[0].已删除).toBe(true)
  })

  test("删除无子任务的任务应静默删除", () => {
    clearAllTasks()
    任务表.添加任务(null, "描述", "孤立任务", 0, 任务Tag.FEAT)
    const result = 任务表.删除任务("孤立任务")
    expect(result.成功).toBe(true)
    expect(result.需要确认).toBeUndefined()
    expect(result.消息).toContain("已删除")
  })
})

describe("2.2 查询已删除任务", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "删除任务A", 0, 任务Tag.FEAT)
    任务表.添加任务(null, "描述2", "删除任务B", 1, 任务Tag.FEAT)
    任务表.添加任务(null, "描述3", "保留任务C", 2, 任务Tag.FEAT)
    任务表.删除任务("删除任务A")
    任务表.确认删除("删除任务B")
  })

  test("查询已删除任务返回视图字符串", () => {
    const result = 任务表.查询已删除任务(10, undefined, undefined, 100, 100)
    expect(typeof result).toBe("string")
    expect(result).toContain("已删除任务统计")
    expect(result).toContain("已删除任务列表")
  })

  test("查询已删除任务包含已删除的任务", () => {
    const result = 任务表.查询已删除任务(10, undefined, undefined, 100, 100)
    expect(result).toContain("删除任务A")
    expect(result).toContain("删除任务B")
    expect(result).not.toContain("保留任务C")
  })

  test("查询数量为0应返回错误", () => {
    const result = 任务表.查询已删除任务(0, undefined, undefined, 100, 100)
    expect(result).toContain("错误")
  })

  test("无效时间格式应返回错误", () => {
    const result = 任务表.查询已删除任务(10, "invalid-date", undefined, 100, 100)
    expect(result).toContain("错误")
  })

  test("从到都不传时应查全部（无时间约束）", () => {
    const result = 任务表.查询已删除任务(10, undefined, undefined, 100, 100)
    expect(result).toContain("已删除任务统计")
    expect(result).toContain("已删除任务列表")
  })

  test("仅传从时查从时间起点以后的任务（2020起点会包含2026年任务）", () => {
    const result = 任务表.查询已删除任务(10, "2020-01-01T00:00:00Z", undefined, 100, 100)
    expect(result).toContain("删除任务A")
    expect(result).toContain("删除任务B")
    expect(result).toContain("已删除任务数: 2")
  })

  test("仅传到时查到时间终点以前的任务（当前时间任务在窗口外应排除）", () => {
    const result = 任务表.查询已删除任务(10, undefined, "2020-01-01T00:00:00Z", 100, 100)
    expect(result).toContain("已删除任务数: 0")
    expect(result).not.toContain("删除任务A")
  })

  test("从到都有时查时间段内的任务（当前时间任务在窗口外应排除）", () => {
    const result = 任务表.查询已删除任务(10, "2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z", 100, 100)
    expect(result).toContain("已删除任务数: 0")
    expect(result).not.toContain("删除任务A")
  })
})

describe("3. 按标题查", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "精确匹配任务", 0, 任务Tag.FEAT)
    任务表.添加任务(null, "描述2", "模糊任务A", 1, 任务Tag.DETAIL)
    任务表.添加任务(null, "描述3", "模糊任务B", 2, 任务Tag.FIX)
  })

  test("精确查询找到任务", () => {
    const result = 任务表.按标题查("精确匹配任务")
    expect(result).toHaveLength(1)
    expect(result[0].标题).toBe("精确匹配任务")
  })

  test("精确查询未找到返回空", () => {
    const result = 任务表.按标题查("不存在的任务")
    expect(result).toHaveLength(0)
  })

  test("模糊查询找到多个", () => {
    const result = 任务表.按标题查("模糊任务", true)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const titles = result.map(t => t.标题)
    expect(titles).toContain("模糊任务A")
    expect(titles).toContain("模糊任务B")
  })

  test("模糊查询无匹配返回空", () => {
    const result = 任务表.按标题查("xyz不存在的", true)
    expect(result).toHaveLength(0)
  })
})

describe("4. 按Tag查询", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "Tag任务1", 0, 任务Tag.FEAT)
    任务表.添加任务(null, "描述2", "Tag任务2", 1, 任务Tag.FEAT)
    任务表.添加任务(null, "描述3", "Tag任务3", 2, 任务Tag.FIX)
    任务表.添加任务(null, "描述4", "Tag任务4", 3, 任务Tag.REFACTOR, [], [任务Tag.DETAIL])
  })

  test("按FEAT Tag查询", () => {
    const result = 任务表.按Tag查询(任务Tag.FEAT)
    expect(result.length).toBeGreaterThanOrEqual(2)
    for (const task of result) {
      expect(task.Tag).toContain(任务Tag.FEAT)
    }
  })

  test("按FIX Tag查询", () => {
    const result = 任务表.按Tag查询(任务Tag.FIX)
    expect(result).toHaveLength(1)
    expect(result[0].标题).toBe("Tag任务3")
  })

  test("按DETAIL Tag查询（其它Tag）", () => {
    const result = 任务表.按Tag查询(任务Tag.DETAIL)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some(t => t.标题 === "Tag任务4")).toBe(true)
  })

  test("不存在的Tag返回空", () => {
    const result = 任务表.按Tag查询("不存在的Tag")
    expect(result).toHaveLength(0)
  })
})

describe("7. 改描述", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "原始描述内容", "改描述任务", 0, 任务Tag.FEAT)
  })

  test("修改描述成功", () => {
    const result = 任务表.改描述("改描述任务", "新的描述内容")
    expect(result.成功).toBe(true)
    expect(result.res任务).toBeDefined()
    expect(result.res任务!.任务描述).toBe("新的描述内容")
  })

  test("验证数据库已更新", () => {
    const found = 任务表.按标题查("改描述任务")
    expect(found).toHaveLength(1)
    expect(found[0].任务描述).toBe("新的描述内容")
  })

  test("修改不存在的任务应失败", () => {
    const result = 任务表.改描述("不存在的任务", "新描述")
    expect(result.成功).toBe(false)
  })

  test("空描述应失败", () => {
    const result = 任务表.改描述("改描述任务", "")
    expect(result.成功).toBe(false)
  })
})

describe("8. 改标题", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "旧标题任务", 0, 任务Tag.FEAT)
    任务表.添加任务("旧标题任务", "子任务描述", "旧标题的子任务", 0, 任务Tag.DETAIL)
    const deps: 任务依赖[] = [{ 依赖任务: "旧标题任务", 原因: "依赖它" }]
    任务表.添加任务(null, "描述2", "引用旧标题的任务", 1, 任务Tag.FIX, deps)
  })

  test("改标题成功", () => {
    const result = 任务表.改标题("旧标题任务", "新标题任务")
    expect(result.成功).toBe(true)
    expect((result.res任务 as 任务).标题).toBe("新标题任务")
  })

  test("子任务的父任务标题已级联更新", () => {
    const child = 任务表.按标题查("旧标题的子任务")
    expect(child).toHaveLength(1)
    expect(child[0].父任务标题).toBe("新标题任务")
  })

  test("依赖中的任务标题已级联更新", () => {
    const refTask = 任务表.按标题查("引用旧标题的任务")
    expect(refTask).toHaveLength(1)
    const deps = JSON.parse(refTask[0].依赖!) as 任务依赖[]
    expect(deps[0].依赖任务).toBe("新标题任务")
  })

  test("新标题已存在应失败", () => {
    const result = 任务表.改标题("新标题任务", "新标题任务")
    expect(result.成功).toBe(false)
  })

  test("旧标题不存在应失败", () => {
    const result = 任务表.改标题("不存在的旧标题", "新标题")
    expect(result.成功).toBe(false)
  })

  test("空标题应失败", () => {
    const result = 任务表.改标题("", "新标题")
    expect(result.成功).toBe(false)
  })
})

describe("9. 改依赖", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "依赖目标A", 0, 任务Tag.FEAT)
    任务表.添加任务(null, "描述2", "依赖目标B", 1, 任务Tag.DETAIL)
    任务表.添加任务(null, "描述3", "待改依赖任务", 2, 任务Tag.FIX)
  })

  test("修改依赖成功", () => {
    const newDeps: 任务依赖[] = [
      { 依赖任务: "依赖目标A", 原因: "新原因A" },
      { 依赖任务: "依赖目标B", 原因: "新原因B" },
    ]
    const result = 任务表.改依赖("待改依赖任务", newDeps)
    expect(result.成功).toBe(true)
    expect(result.res任务).toBeDefined()
    const deps = JSON.parse((result.res任务 as 任务).依赖!) as 任务依赖[]
    expect(deps).toHaveLength(2)
    expect(deps[0].依赖任务).toBe("依赖目标A")
    expect(deps[1].依赖任务).toBe("依赖目标B")
  })

  test("依赖任务不存在应失败", () => {
    const newDeps: 任务依赖[] = [{ 依赖任务: "不存在的任务", 原因: "原因" }]
    const result = 任务表.改依赖("待改依赖任务", newDeps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("不存在的任务应失败", () => {
    const newDeps: 任务依赖[] = []
    const result = 任务表.改依赖("不存在的任务", newDeps)
    expect(result.成功).toBe(false)
  })
})

describe("9.1 改依赖同级依赖校验", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "改依赖根任务", 0, 任务Tag.MILESTONE)
    任务表.添加任务("改依赖根任务", "任务A描述", "改依赖任务A", 0, 任务Tag.FEAT)
    任务表.添加任务("改依赖根任务", "任务B描述", "改依赖任务B", 1, 任务Tag.FEAT)
    任务表.添加任务("改依赖根任务", "任务C描述", "改依赖任务C", 2, 任务Tag.FEAT)
  })

  test("改依赖：后者依赖前者应成功", () => {
    const deps: 任务依赖[] = [{ 依赖任务: "改依赖任务A", 原因: "正确依赖" }]
    const result = 任务表.改依赖("改依赖任务B", deps)
    expect(result.成功).toBe(true)
  })

  test("改依赖：前者依赖后者应失败", () => {
    const deps: 任务依赖[] = [{ 依赖任务: "改依赖任务C", 原因: "错误依赖" }]
    const result = 任务表.改依赖("改依赖任务A", deps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("改依赖任务A")
    expect(result.消息).toContain("改依赖任务C")
  })

  test("改依赖：跨父任务依赖不受限制", () => {
    任务表.添加任务(null, "另一根描述", "另一根任务", 0, 任务Tag.MILESTONE)
    任务表.添加任务("另一根任务", "跨级任务D描述", "改依赖跨级任务D", 5, 任务Tag.FEAT)
    const deps: 任务依赖[] = [{ 依赖任务: "改依赖跨级任务D", 原因: "跨父依赖" }]
    const result = 任务表.改依赖("改依赖任务A", deps)
    expect(result.成功).toBe(true)
  })

  test("改依赖：混合依赖应检测出第一个无效同级", () => {
    任务表.添加任务("改依赖根任务", "高优E1", "改依赖高优E1", 3, 任务Tag.FEAT)
    任务表.添加任务("改依赖根任务", "低优E2", "改依赖低优E2", 6, 任务Tag.FEAT)
    const mixedDeps: 任务依赖[] = [
      { 依赖任务: "改依赖低优E2", 原因: "无效-前者依赖后者" },
      { 依赖任务: "改依赖跨级任务D", 原因: "有效-跨父依赖" },
    ]
    const result = 任务表.改依赖("改依赖高优E1", mixedDeps)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("同级任务情况下，前者(优先级序号更小)不能依赖后者")
    expect(result.消息).toContain("改依赖高优E1")
    expect(result.消息).toContain("改依赖低优E2")
  })

  test("改依赖：根任务依赖不受同级限制", () => {
    const deps: 任务依赖[] = [{ 依赖任务: "另一根任务", 原因: "根任务依赖" }]
    const result = 任务表.改依赖("改依赖根任务", deps)
    expect(result.成功).toBe(true)
  })
})

describe("9.2 改优先级", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "改优先级根任务", 0, 任务Tag.MILESTONE)
    任务表.添加任务("改优先级根任务", "任务A描述", "任务A", 0, 任务Tag.FEAT)
    任务表.添加任务("改优先级根任务", "任务B描述", "任务B", 1, 任务Tag.FEAT)
    任务表.添加任务("改优先级根任务", "任务C描述", "任务C", 2, 任务Tag.FEAT)
    任务表.添加任务("改优先级根任务", "任务D描述", "任务D", 3, 任务Tag.FEAT)
    任务表.添加任务("改优先级根任务", "任务E描述", "任务E", 4, 任务Tag.FEAT)
  })

  test("改优先级成功", () => {
    const result = 任务表.改优先级("任务E", 1)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("从 4 改为 1")
    expect(result.res任务!.优先级序号).toBe(1)
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
    const result = 任务表.改优先级("任务D", 0)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("前两个任务[无]")
    expect(result.消息).toContain("后两个任务[")
  })

  test("改优先级到末尾位置", () => {
    const result = 任务表.改优先级("任务A", 99999)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("后两个任务[无]")
    expect(result.消息).toContain("前两个任务[")
  })

  test("改优先级：根任务不受限制", () => {
    const result = 任务表.改优先级("改优先级根任务", 99999)
    expect(result.成功).toBe(true)
  })

  test("改优先级：不存在的任务应失败", () => {
    const result = 任务表.改优先级("不存在的任务", 0)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("改优先级：空标题应失败", () => {
    const result = 任务表.改优先级("", 0)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("标题不能为空")
  })

  test("改优先级不应制造非法依赖：被依赖任务移到依赖者后面应失败", () => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "依赖校验根", 0, 任务Tag.MILESTONE)
    任务表.添加任务("依赖校验根", "任务A描述", "依赖校验A", 0, 任务Tag.FEAT)
    const deps: 任务依赖[] = [{ 依赖任务: "依赖校验A", 原因: "依赖A" }]
    任务表.添加任务("依赖校验根", "任务B描述", "依赖校验B", 1, 任务Tag.FEAT, deps)
    const result = 任务表.改优先级("依赖校验A", 5)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("该任务被同级任务")
    expect(result.消息).toContain("依赖")
  })

  test("改优先级后序号连续无空洞", () => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "连续根", 0, 任务Tag.MILESTONE)
    任务表.添加任务("连续根", "X描述", "X", 0, 任务Tag.FEAT)
    任务表.添加任务("连续根", "Y描述", "Y", 1, 任务Tag.FEAT)
    任务表.添加任务("连续根", "Z描述", "Z", 2, 任务Tag.FEAT)
    const result = 任务表.改优先级("X", 2)
    expect(result.成功).toBe(true)
    const 子任务 = 获取所有子任务("连续根")
    const 优先级列表 = 子任务.map(t => t.优先级序号 ?? 0).sort((a, b) => a - b)
    expect(优先级列表).toEqual([0, 1, 2])
  })

  test("改优先级到超大值后序号连续无空洞", () => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "超大根", 0, 任务Tag.MILESTONE)
    任务表.添加任务("超大根", "A描述", "超大A", 0, 任务Tag.FEAT)
    任务表.添加任务("超大根", "B描述", "超大B", 1, 任务Tag.FEAT)
    任务表.添加任务("超大根", "C描述", "超大C", 2, 任务Tag.FEAT)
    const result = 任务表.改优先级("超大A", 99999)
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
    任务表.添加任务(null, "根描述", "负数根", 0, 任务Tag.MILESTONE)
    任务表.添加任务("负数根", "A描述", "负数A", 0, 任务Tag.FEAT)
    任务表.添加任务("负数根", "B描述", "负数B", 1, 任务Tag.FEAT)
    任务表.添加任务("负数根", "C描述", "负数C", 2, 任务Tag.FEAT)
    const result = 任务表.改优先级("负数C", -1)
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
    任务表.添加任务(null, "根描述", "自依赖根", 0, 任务Tag.MILESTONE)
    任务表.添加任务("自依赖根", "A描述", "自依赖A", 0, 任务Tag.FEAT)
    const deps: 任务依赖[] = [{ 依赖任务: "自依赖A", 原因: "依赖A" }]
    任务表.添加任务("自依赖根", "B描述", "自依赖B", 1, 任务Tag.FEAT, deps)
    const result = 任务表.改优先级("自依赖B", 0)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("依赖")
  })
})

describe("10. 标记为已完成", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "待完成任务", 0, 任务Tag.FEAT)
  })

  test("标记为已完成成功", () => {
    const result = 任务表.标记为已完成("待完成任务")
    expect(result.成功).toBe(true)
    expect(result.res任务!.是否完成).toBe(true)
  })

  test("验证数据库已更新", () => {
    const found = 任务表.按标题查("待完成任务")
    expect(found).toHaveLength(1)
    expect(found[0].是否完成).toBe(true)
  })

  test("不存在的任务应失败", () => {
    const result = 任务表.标记为已完成("不存在的任务")
    expect(result.成功).toBe(false)
  })

  test("空标题应失败", () => {
    const result = 任务表.标记为已完成("")
    expect(result.成功).toBe(false)
  })
})

describe("10.1 级联标记为已完成", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "完成根任务", 0, 任务Tag.MILESTONE)
    任务表.添加任务("完成根任务", "子A描述", "完成子A", 0, 任务Tag.FEAT)
    任务表.添加任务("完成子A", "孙A描述", "完成孙A", 0, 任务Tag.FEAT)
    任务表.添加任务("完成根任务", "子B描述", "完成子B", 1, 任务Tag.FEAT)
  })

  test("标记有子任务的任务应返回需要确认", () => {
    const result = 任务表.标记为已完成("完成根任务")
    expect(result.成功).toBe(false)
    expect(result.需要确认).toBe(true)
    expect(result.子任务数).toBe(3)
    expect(result.消息).toContain("完成根任务")
    expect(result.消息).toContain("3个子任务")
  })

  test("确认完成应级联标记所有子任务", () => {
    const result = 任务表.确认完成("完成根任务")
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("完成根任务")
    expect(result.消息).toContain("所有子任务")
    expect(result.res任务!.是否完成).toBe(true)
  })

  test("级联完成后所有子任务均标记为已完成", () => {
    const 根 = 任务表.按标题查("完成根任务")
    expect(根[0].是否完成).toBe(true)
    const 子A = 任务表.按标题查("完成子A")
    expect(子A[0].是否完成).toBe(true)
    const 孙A = 任务表.按标题查("完成孙A")
    expect(孙A[0].是否完成).toBe(true)
    const 子B = 任务表.按标题查("完成子B")
    expect(子B[0].是否完成).toBe(true)
  })

  test("标记无子任务的任务应静默完成", () => {
    clearAllTasks()
    任务表.添加任务(null, "描述", "孤立完成任务", 0, 任务Tag.FEAT)
    const result = 任务表.标记为已完成("孤立完成任务")
    expect(result.成功).toBe(true)
    expect(result.需要确认).toBeUndefined()
    expect(result.消息).toContain("已完成")
  })
})

describe("11. 添加动态", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "描述1", "动态测试任务", 0, 任务Tag.FEAT)
  })

  test("添加动态成功", () => {
    const result = 任务表.添加动态("动态测试任务", "planner", "开始规划")
    expect(result.成功).toBe(true)
    expect(result.res任务).toBeDefined()
    const res任务 = result.res任务 as 任务
    expect(res任务.动态).toHaveLength(1)
    expect(res任务.动态[0].角色).toBe("planner")
    expect(res任务.动态[0].消息).toBe("开始规划")
    expect(res任务.动态[0].时间UTC).toBeDefined()
  })

  test("添加第二条动态", () => {
    const result = 任务表.添加动态("动态测试任务", "executor", "执行中")
    expect(result.成功).toBe(true)
    const res任务 = result.res任务 as 任务
    expect(res任务.动态).toHaveLength(2)
    expect(res任务.动态[1].角色).toBe("executor")
  })

  test("验证数据库已更新", () => {
    const found = 任务表.按标题查("动态测试任务")
    expect(found).toHaveLength(1)
    expect(found[0].动态).toHaveLength(2)
  })

  test("不存在的任务应失败", () => {
    const result = 任务表.添加动态("不存在的任务", "planner", "消息")
    expect(result.成功).toBe(false)
  })

  test("空角色应失败", () => {
    const result = 任务表.添加动态("动态测试任务", "", "消息")
    expect(result.成功).toBe(false)
  })

  test("空消息应失败", () => {
    const result = 任务表.添加动态("动态测试任务", "planner", "")
    expect(result.成功).toBe(false)
  })
})

describe("查询任务表视图（含动态）", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "根描述", "视图根任务", 0, 任务Tag.FEAT)
    任务表.添加任务("视图根任务", "子描述", "视图子任务", 0, 任务Tag.DETAIL)
  })

  test("查询任务表返回格式化字符串", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 1000)
    expect(typeof result).toBe("string")
    expect(result).toContain("任务表统计")
    expect(result).toContain("任务表视图")
  })

  test("聚焦数量为0应返回错误", () => {
    const result = 查询任务表_返回视图(0, undefined, undefined, 1000, 1000)
    expect(result).toContain("错误")
  })

  test("无效时间格式应返回错误", () => {
    const result = 查询任务表_返回视图(10, "invalid-date", undefined, 1000, 1000)
    expect(result).toContain("错误")
  })

  test("从到都不传时应查全部（无时间约束）", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 1000)
    expect(result).toContain("视图根任务")
    expect(result).toContain("视图子任务")
  })

  test("仅传从时查从时间起点以后的任务（窗口内任务应包含）", () => {
    const result = 查询任务表_返回视图(10, "2020-01-01T00:00:00Z", undefined, 1000, 1000)
    expect(result).toContain("视图根任务")
    expect(result).toContain("视图子任务")
  })

  test("仅传到时查到时间终点以前的任务（当前时间任务在窗口外应排除）", () => {
    const result = 查询任务表_返回视图(10, undefined, "2020-01-01T00:00:00Z", 1000, 1000)
    expect(result).toContain("当前展示数量: 0")
    expect(result).not.toContain("视图根任务")
  })

  test("从到都有时查时间段内的任务（当前时间任务在窗口外应排除）", () => {
    const result = 查询任务表_返回视图(10, "2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z", 1000, 1000)
    expect(result).toContain("当前展示数量: 0")
    expect(result).not.toContain("视图根任务")
  })
})

describe("查询任务表视图 - 描述折叠", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "这是一段很长的任务描述，用于测试折叠功能是否正常工作，当描述超过阈值时应该被截断并显示折叠提示", "长描述任务", 0, 任务Tag.FEAT)
    任务表.添加任务(null, "短描述", "短描述任务", 1, 任务Tag.DETAIL)
  })

  test("描述超过阈值时被截断", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 10, 1000)
    expect(result).toContain("长描述任务")
    expect(result).toContain("(..折叠")
    expect(result).toContain("字)")
  })

  test("描述截断后保留前N字", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 5, 1000)
    expect(result).toContain("这是一段很(..折叠")
  })

  test("描述未超过阈值时不被截断", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 100, 1000)
    expect(result).toContain("短描述")
    expect(result).not.toContain("(..折叠")
  })

  test("描述恰好等于阈值时不被截断", () => {
    clearAllTasks()
    任务表.添加任务(null, "abc", "等长任务", 0, 任务Tag.FEAT)
    const result = 查询任务表_返回视图(10, undefined, undefined, 3, 1000)
    expect(result).toContain("abc")
    expect(result).not.toContain("(..折叠")
  })
})

describe("查询任务表视图 - 动态折叠", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "动态折叠测试任务", "动态折叠任务", 0, 任务Tag.FEAT)
    任务表.添加动态("动态折叠任务", "planner", "第一条新动态")
    任务表.添加动态("动态折叠任务", "executor", "第二条动态消息内容比较长一些")
    任务表.添加动态("动态折叠任务", "evaluator", "第三条旧动态")
  })

  test("动态消息总字数超过阈值时被截断", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 10)
    expect(result).toContain("动态折叠任务")
    expect(result).toContain("(..折叠")
    expect(result).toContain("个动态)")
  })

  test("动态折叠保留新动态，折叠旧动态", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 8)
    expect(result).toContain("第一条新动态")
    expect(result).not.toContain("第二条动态消息内容比较长一些")
    expect(result).not.toContain("第三条旧动态")
    expect(result).toContain("(..折叠2个动态)")
  })

  test("动态字数阈值仅统计消息内容，不统计序号时间角色前缀", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, "第一条新动态".length)
    expect(result).toContain("第一条新动态」")
    expect(result).toContain("1.「")
    expect(result).toContain("planner：")
    expect(result).not.toContain("第一条新动(..折叠")
    expect(result).toContain("(..折叠2个动态)")
  })

  test("超过动态字数阈值的首条消息被截断并以折叠数量结尾", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 5)
    expect(result).toContain("第一条新")
    expect(result).not.toContain("第一条新动态")
    expect(result).toContain("(..折叠3个动态)")
  })

  test("动态折叠仅折叠超出部分", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 15)
    expect(result).toContain("第一条新动态")
    expect(result).not.toContain("第二条动态消息内容比较长一些")
    expect(result).toContain("(..折叠2个动态)")
  })

  test("动态消息总字数未超过阈值时全部显示", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 50)
    expect(result).toContain("第一条新动态")
    expect(result).toContain("第二条动态消息内容比较长一些")
    expect(result).toContain("第三条旧动态")
    expect(result).not.toContain("(..折叠")
  })

  test("任务动态字数展示阈值为0时仅显示折叠提示", () => {
    const result = 查询任务表_返回视图(10, undefined, undefined, 1000, 0)
    expect(result).toContain("动态折叠任务")
    expect(result).toContain("(..折叠3个动态)")
  })
})

// 辅助函数：运行 CLI 命令
function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  return new Promise((resolve) => {
    const cliPath = join(__dirname, "../任务表CLI.ts")
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

describe("CLI命令集成测试", () => {
  const cliEnv = { TASKTABLE_PROJECT_NAME: "test" }

  test("CLI help命令", async () => {
    const { stdout } = await runCli(["help"], cliEnv)
    expect(stdout).toContain("任务表CLI")
    expect(stdout).toContain("add")
    expect(stdout).toContain("delete")
    expect(stdout).toContain("query-by-title")
  })

  test("CLI init命令", async () => {
    const uniqueProject = `clitest_${Date.now()}`
    const { stdout } = await runCli(["init", "--项目", uniqueProject], cliEnv)
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
    await runCli(["delete", "--标题", "CLI测试任务"], cliEnv)

    const { stdout } = await runCli([
      "add",
      "--标题", "CLI测试任务",
      "--描述", "这是一个通过CLI添加的任务",
      "--优先级", "0",
      "--Tag", "feat",
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
    const { stdout } = await runCli(["mark-complete", "--标题", "CLI测试任务"], cliEnv)
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
    ], cliEnv)

    const { stdout } = await runCli(["delete", "--标题", "CLI删除测试任务"], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
  })

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
    const { stdout } = await runCli(["add", "--标题", "缺少描述的任务"], cliEnv)
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
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

  test("CLI 任务不存在错误应返回JSON", async () => {
    const { stdout } = await runCli(["delete", "--标题", "不存在的任务XYZ"], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("不存在")
  })

  test("CLI 无效JSON参数应返回错误", async () => {
    const { stdout } = await runCli([
      "update-dependency",
      "--标题", "某任务",
      "--新依赖", "not-valid-json",
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
    ], cliEnv)

    const { stdout } = await runCli([
      "add-activity",
      "--标题", "CLI测试任务",
      "--角色", "planner",
      "--消息", "CLI动态测试消息",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
    expect(result.res任务.动态.length).toBeGreaterThanOrEqual(1)
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
    ], cliEnv)

    const { stdout } = await runCli([
      "update-priority",
      "--标题", "优先级测试任务",
      "--新优先级", "5",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(true)
    expect(result.消息).toContain("优先级")
  })

  test("CLI update-priority缺少参数应失败", async () => {
    const { stdout } = await runCli([
      "update-priority",
      "--标题", "优先级测试任务",
    ], cliEnv)
    const result = JSON.parse(stdout)
    expect(result.成功).toBe(false)
    expect(result.消息).toContain("缺少必需参数")
  })

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
    expect(stdout).toContain("任务表视图")
    expect(stdout).not.toContain("成功")
  })
})
