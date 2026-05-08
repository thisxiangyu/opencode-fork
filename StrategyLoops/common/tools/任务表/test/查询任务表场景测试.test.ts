/**
 * 查询任务表 场景测试
 * 测试各种树结构下的查询任务表视图输出
 * 场景迁移自 StrategyLoops/loops/plan-exe-eval/test/任务表Prompt测试.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { rmSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import {
  initDb,
  任务表,
  查询任务表_返回视图,
  当前表中全部任务数,
  当前表中总任务数_仅末端,
  加载根任务,
  任务Tag,
  getDb,
} from "../任务表CLI"

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_PROJECT_DIR = join(__dirname, "data", ".taskTable.scenario")
const TEST_DB_PATH = join(TEST_PROJECT_DIR, "scenarioTaskTable.db")

function cleanDb() {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH)
  if (existsSync(TEST_PROJECT_DIR)) rmSync(TEST_PROJECT_DIR, { recursive: true })
}

beforeAll(() => {
  cleanDb()
  initDb("scenario")
})

afterAll(() => {
  try { getDb().close() } catch {}
})

function clearAllTasks() {
  getDb().exec("DELETE FROM 任务表")
}

describe("场景1: 多根任务", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "项目A总体规划", "项目A", 0, 任务Tag.MILESTONE)
    任务表.添加任务("项目A", "功能1", "项目A-功能1", 0, 任务Tag.FEAT)
    任务表.添加任务("项目A", "功能2", "项目A-功能2", 1, 任务Tag.FEAT)
    任务表.添加任务(null, "项目B总体规划", "项目B", 1, 任务Tag.MILESTONE)
    任务表.添加任务("项目B", "功能1", "项目B-功能1", 0, 任务Tag.FEAT)
    任务表.添加任务(null, "项目C总体规划", "项目C", 2, 任务Tag.MILESTONE)
  })

  test("根任务数正确", () => {
    expect(加载根任务().length).toBe(3)
  })

  test("总任务数正确", () => {
    expect(当前表中全部任务数()).toBe(6)
  })

  test("视图包含所有根任务 - 按优先级排序", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toContain("项目A")
    expect(view).toContain("项目B")
    expect(view).toContain("项目C")
    const idxA = view.indexOf("项目A")
    const idxB = view.indexOf("项目B")
    const idxC = view.indexOf("项目C")
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)
  })

  test("视图包含所有子任务", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toContain("项目A-功能1")
    expect(view).toContain("项目A-功能2")
    expect(view).toContain("项目B-功能1")
  })

  test("视图包含末端任务数统计", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    const 末端 = 当前表中总任务数_仅末端()
    expect(view).toContain(`末端任务数`)
    expect(view).toContain(String(末端))
  })
})

describe("场景2: 深层嵌套（深度=10）", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "第0层", "L0-任务", 0, 任务Tag.FEAT)
    for (let i = 1; i <= 10; i++) {
      任务表.添加任务(`L${i - 1}-任务`, `第${i}层`, `L${i}-任务`, 0, 任务Tag.FEAT)
    }
  })

  test("所有层级任务都存在", () => {
    expect(当前表中全部任务数()).toBe(11)
  })

  test("视图包含所有层级", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    for (let i = 0; i <= 10; i++) {
      expect(view).toContain(`L${i}-任务`)
    }
  })

  test("深层任务有正确的缩进前缀", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    // L10 is at depth 11, should have long dash prefix
    expect(view).toContain("———")
  })

  test("末端任务数等于最深层任务数", () => {
    expect(当前表中总任务数_仅末端()).toBe(1)
  })
})

describe("场景3: 宽分支（单个父任务有10个子任务）", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "根", "根任务", 0, 任务Tag.MILESTONE)
    for (let i = 0; i < 10; i++) {
      任务表.添加任务("根任务", `第${i}个子任务`, `子任务-${i}`, i, 任务Tag.FEAT)
    }
  })

  test("所有任务存在", () => {
    expect(当前表中全部任务数()).toBe(11)
  })

  test("末端任务数为10", () => {
    expect(当前表中总任务数_仅末端()).toBe(10)
  })

  test("视图包含父子所有任务", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toContain("根任务")
    for (let i = 0; i < 10; i++) {
      expect(view).toContain(`子任务-${i}`)
    }
  })

  test("视图展示数量包含所有任务", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toContain("当前展示数量: 11")
  })
})

describe("场景4: 稀疏树（不同根不同深度）", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "项目1", "项目1", 0, 任务Tag.MILESTONE)
    任务表.添加任务("项目1", "功能", "项目1-功能", 0, 任务Tag.FEAT)

    任务表.添加任务(null, "项目2", "项目2", 1, 任务Tag.MILESTONE)
    任务表.添加任务("项目2", "功能", "项目2-功能", 0, 任务Tag.FEAT)
    任务表.添加任务("项目2-功能", "子功能", "项目2-功能-子功能", 0, 任务Tag.FEAT)

    任务表.添加任务(null, "项目3", "项目3", 2, 任务Tag.MILESTONE)
    任务表.添加任务("项目3", "功能", "项目3-功能", 0, 任务Tag.FEAT)
    任务表.添加任务("项目3-功能", "子功能", "项目3-功能-子功能", 0, 任务Tag.FEAT)
    任务表.添加任务("项目3-功能-子功能", "孙功能", "项目3-功能-子功能-孙功能", 0, 任务Tag.FEAT)
  })

  test("所有任务存在", () => {
    expect(当前表中全部任务数()).toBe(9)
  })

  test("根任务数正确", () => {
    expect(加载根任务().length).toBe(3)
  })

  test("不同深度的根按优先级排序", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    const idx1 = view.indexOf("项目1")
    const idx2 = view.indexOf("项目2")
    const idx3 = view.indexOf("项目3")
    expect(idx1).toBeLessThan(idx2)
    expect(idx2).toBeLessThan(idx3)
  })

  test("最深分支到孙功能", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toContain("项目3-功能-子功能-孙功能")
  })

  test("末端任务数正确（每棵子树最深末端）", () => {
    expect(当前表中总任务数_仅末端()).toBe(3)
  })
})

describe("场景5: 不同路径相同优先级序号", () => {
  beforeAll(() => {
    clearAllTasks()
    任务表.添加任务(null, "项目", "项目", 0, 任务Tag.MILESTONE)

    任务表.添加任务("项目", "分支A", "分支A", 0, 任务Tag.FEAT)
    任务表.添加任务("分支A", "A的任务0", "分支A-任务0", 0, 任务Tag.FEAT)
    任务表.添加任务("分支A", "A的任务1", "分支A-任务1", 1, 任务Tag.FEAT)

    任务表.添加任务("项目", "分支B", "分支B", 1, 任务Tag.FEAT)
    任务表.添加任务("分支B", "B的任务0", "分支B-任务0", 0, 任务Tag.FEAT)
    任务表.添加任务("分支B", "B的任务1", "分支B-任务1", 1, 任务Tag.FEAT)
  })

  test("所有任务存在", () => {
    expect(当前表中全部任务数()).toBe(7)
  })

  test("不同分支相同优先级不冲突", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toContain("分支A-任务0")
    expect(view).toContain("分支A-任务1")
    expect(view).toContain("分支B-任务0")
    expect(view).toContain("分支B-任务1")
  })

  test("分支A的序号路径以0.0开头", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toMatch(/0\.0\..*分支A-任务0/)
  })

  test("分支B的序号路径以0.1开头", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toMatch(/0\.1\..*分支B-任务0/)
  })

  test("末端任务数正确", () => {
    expect(当前表中总任务数_仅末端()).toBe(4)
  })
})

describe("场景6: 超过聚焦数量上限（复杂树结构）", () => {
  beforeAll(() => {
    clearAllTasks()

    // 4个根项目
    任务表.添加任务(null, "项目A总体规划", "项目A-总规划", 0, 任务Tag.MILESTONE)
    任务表.添加任务(null, "项目B总体规划", "项目B-总规划", 1, 任务Tag.MILESTONE)
    任务表.添加任务(null, "项目C总体规划", "项目C-总规划", 2, 任务Tag.MILESTONE)
    任务表.添加任务(null, "项目D总体规划", "项目D-总规划", 3, 任务Tag.MILESTONE)

    // 项目A：2个一级子任务 + 各10个二级子任务
    for (let i = 0; i < 2; i++) {
      任务表.添加任务("项目A-总规划", `A分支${i}`, `A-分支${i}`, i, 任务Tag.FEAT)
      for (let j = 0; j < 10; j++) {
        任务表.添加任务(`A-分支${i}`, `A${i}任务${j}`, `A-分支${i}-任务${j}`, j, 任务Tag.FEAT)
      }
    }

    // 项目B：1个一级子任务 + 20个二级子任务
    任务表.添加任务("项目B-总规划", "B分支0", "B-分支0", 0, 任务Tag.FEAT)
    for (let j = 0; j < 20; j++) {
      任务表.添加任务("B-分支0", `B0任务${j}`, `B-分支0-任务${j}`, j, 任务Tag.FEAT)
    }

    // 项目C：3个一级子任务 + 各15个二级子任务（部分已完成）
    for (let i = 0; i < 3; i++) {
      任务表.添加任务("项目C-总规划", `C分支${i}`, `C-分支${i}`, i, 任务Tag.FEAT)
      for (let j = 0; j < 15; j++) {
        任务表.添加任务(`C-分支${i}`, `C${i}任务${j}`, `C-分支${i}-任务${j}`, j, 任务Tag.FEAT)
      }
    }

    // 项目D：5个一级子任务 + 各10个二级子任务
    for (let i = 0; i < 5; i++) {
      任务表.添加任务("项目D-总规划", `D分支${i}`, `D-分支${i}`, i, 任务Tag.FEAT)
      for (let j = 0; j < 10; j++) {
        任务表.添加任务(`D-分支${i}`, `D${i}任务${j}`, `D-分支${i}-任务${j}`, j, 任务Tag.FEAT)
      }
    }
  })

  test("总任务数超过聚焦上限", () => {
    const total = 当前表中全部任务数()
    expect(total).toBeGreaterThan(100)
  })

  test("所有根任务都在视图中", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    expect(view).toContain("项目A-总规划")
    expect(view).toContain("项目B-总规划")
    expect(view).toContain("项目C-总规划")
    expect(view).toContain("项目D-总规划")
  })

  test("聚焦数量为30时展示数量不超过 root+30+ancestors", () => {
    const view = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    // 展示数量应在统计行中
    const match = view.match(/当前展示数量: (\d+)/)
    expect(match).not.toBeNull()
    const shown = parseInt(match![1] as string)
    // 根任务 4 + 最多30个近期非根任务 + 它们的祖先（不会重复计算根）
    // 实际展示数量取决于去重后的数量
    expect(shown).toBeGreaterThanOrEqual(4)
    expect(shown).toBeLessThanOrEqual(34 + 10) // 上限：root + focused + some ancestor chains
  })

  test("聚焦数量为0时返回错误", () => {
    const view = 查询任务表_返回视图(0, undefined, undefined, 100, 100)
    expect(view).toContain("错误")
  })

  test("聚焦数量更小时展示更少的任务", () => {
    const view10 = 查询任务表_返回视图(10, undefined, undefined, 100, 100)
    const view30 = 查询任务表_返回视图(30, undefined, undefined, 100, 100)
    const match10 = view10.match(/当前展示数量: (\d+)/)
    const match30 = view30.match(/当前展示数量: (\d+)/)
    expect(match10).not.toBeNull()
    expect(match30).not.toBeNull()
    const shown10 = parseInt(match10![1] as string)
    const shown30 = parseInt(match30![1] as string)
    expect(shown10).toBeLessThan(shown30)
  })
})
