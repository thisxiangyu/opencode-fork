import { consoleAndLogFile, LOG_COLOR } from "../../../common/logger"
import {
  规划者,
  initDb,
  getDb,
  加载根任务,
  当前表中全部任务数,
  当前表中总任务数_仅末端,
  任务表dbPath,
} from "../任务表驱动的PEE"
import { 任务Tag } from "../任务表驱动的PEE"

initDb("Test")

function clearAllTasks() {
  getDb().query("DELETE FROM 任务表").run()
}

function insertTestTask(params: {
  标题: string
  父任务标题?: string | null
  Tag: string[]
  任务描述: string
  是否完成?: boolean
  优先级序号?: number
  依赖?: { 依赖任务: string; 原因: string }[]
  创建时间UTC?: string
}) {
  const {
    标题,
    父任务标题 = null,
    Tag,
    任务描述,
    是否完成 = false,
    优先级序号 = 0,
    依赖 = [],
    创建时间UTC = new Date().toISOString(),
  } = params

  const existing = getDb().query("SELECT 标题 FROM 任务表 WHERE 标题 = ?").get(标题)
  if (existing) return

  getDb().query(
    "INSERT INTO 任务表 (标题, 父任务标题, Tag, 任务描述, 是否完成, 创建时间UTC, 优先级序号, 依赖, 是否删除) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"
  ).run(标题, 父任务标题, JSON.stringify(Tag), 任务描述, 是否完成 ? 1 : 0, 创建时间UTC, 优先级序号, JSON.stringify(依赖))
}

function insertTasksRaw(tasks: Array<{
  标题: string
  父任务标题?: string | null
  Tag: string[]
  任务描述: string
  是否完成?: boolean
  优先级序号?: number
  依赖?: { 依赖任务: string; 原因: string }[]
  创建时间UTC?: string
}>) {
  for (const t of tasks) {
    insertTestTask(t)
  }
}

async function runTestCase(name: string, setupFn: () => void) {

  const 任务树一次性聚焦数量上限 = 30;

  consoleAndLogFile.info("")
  consoleAndLogFile.infoC(LOG_COLOR.CYAN, `【测试用例: ${name}】`)
  consoleAndLogFile.info("")
  consoleAndLogFile.info(`数据库路径: ${任务表dbPath}`)
  consoleAndLogFile.info(`任务树一次性聚焦数量上限: ${任务树一次性聚焦数量上限}`)

  setupFn()

  consoleAndLogFile.info("")
  consoleAndLogFile.infoC(LOG_COLOR.YELLOW, `  数据统计: 总任务数=${当前表中全部任务数()}, 末端任务数=${当前表中总任务数_仅末端()}, 根任务数=${加载根任务().length}`)

  const planner = new 规划者()
  const prompt = planner.查询任务表(任务树一次性聚焦数量上限)

  consoleAndLogFile.info("")
  consoleAndLogFile.info(prompt)
}

async function testCase1_MultiRootTasks() {
  await runTestCase("多根任务", () => {
    clearAllTasks()
    const baseTime = new Date()
    baseTime.setHours(10, 0, 0, 0)

    insertTasksRaw([
      { 标题: "项目A", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目A总体规划", 优先级序号: 0, 创建时间UTC: baseTime.toISOString() },
      { 标题: "项目A-功能1", 父任务标题: "项目A", Tag: [任务Tag.FEAT], 任务描述: "功能1", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 1000).toISOString() },
      { 标题: "项目A-功能2", 父任务标题: "项目A", Tag: [任务Tag.FEAT], 任务描述: "功能2", 优先级序号: 1, 创建时间UTC: new Date(baseTime.getTime() + 2000).toISOString() },
      { 标题: "项目B", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目B总体规划", 优先级序号: 1, 创建时间UTC: new Date(baseTime.getTime() + 3000).toISOString() },
      { 标题: "项目B-功能1", 父任务标题: "项目B", Tag: [任务Tag.FEAT], 任务描述: "功能1", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 4000).toISOString() },
      { 标题: "项目C", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目C总体规划", 优先级序号: 2, 创建时间UTC: new Date(baseTime.getTime() + 5000).toISOString() },
    ])
  })
}

async function testCase2_DeepNesting() {
  await runTestCase("深层嵌套（深度=10）", () => {
    clearAllTasks()
    const baseTime = new Date()
    baseTime.setHours(10, 0, 0, 0)

    type TestTask = {
      标题: string
      父任务标题?: string | null
      Tag: string[]
      任务描述: string
      是否完成?: boolean
      优先级序号?: number
      依赖?: { 依赖任务: string; 原因: string }[]
      创建时间UTC?: string
    }
    const tasks: TestTask[] = [{ 标题: "L0-任务", 父任务标题: null, Tag: [任务Tag.FEAT], 任务描述: "第0层", 优先级序号: 0, 创建时间UTC: baseTime.toISOString() }]
    for (let i = 1; i <= 10; i++) {
      const prevTitle = `L${i-1}-任务`
      tasks.push({
        标题: `L${i}-任务`,
        父任务标题: prevTitle,
        Tag: [任务Tag.FEAT],
        任务描述: `第${i}层`,
        优先级序号: 0,
        创建时间UTC: new Date(baseTime.getTime() + i * 1000).toISOString()
      })
    }
    insertTasksRaw(tasks)
  })
}

async function testCase3_WideBranching() {
  await runTestCase("宽分支（单个父任务有10个子任务）", () => {
    clearAllTasks()
    const baseTime = new Date()
    baseTime.setHours(10, 0, 0, 0)

    insertTasksRaw([
      { 标题: "根任务", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "根", 优先级序号: 0, 创建时间UTC: baseTime.toISOString() },
    ])
    for (let i = 0; i < 10; i++) {
      insertTasksRaw([
        { 标题: `子任务-${i}`, 父任务标题: "根任务", Tag: [任务Tag.FEAT], 任务描述: `第${i}个子任务`, 优先级序号: i, 创建时间UTC: new Date(baseTime.getTime() + (i + 1) * 1000).toISOString() },
      ])
    }
  })
}

async function testCase9_SparseTree() {
  await runTestCase("稀疏树（不同根不同深度）", () => {
    clearAllTasks()
    const baseTime = new Date()
    baseTime.setHours(10, 0, 0, 0)

    insertTasksRaw([
      { 标题: "项目1", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目1", 优先级序号: 0, 创建时间UTC: baseTime.toISOString() },
      { 标题: "项目1-功能", 父任务标题: "项目1", Tag: [任务Tag.FEAT], 任务描述: "功能", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 1000).toISOString() },
      { 标题: "项目2", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目2", 优先级序号: 1, 创建时间UTC: new Date(baseTime.getTime() + 2000).toISOString() },
      { 标题: "项目2-功能", 父任务标题: "项目2", Tag: [任务Tag.FEAT], 任务描述: "功能", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 3000).toISOString() },
      { 标题: "项目2-功能-子功能", 父任务标题: "项目2-功能", Tag: [任务Tag.FEAT], 任务描述: "子功能", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 4000).toISOString() },
      { 标题: "项目3", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目3", 优先级序号: 2, 创建时间UTC: new Date(baseTime.getTime() + 5000).toISOString() },
      { 标题: "项目3-功能", 父任务标题: "项目3", Tag: [任务Tag.FEAT], 任务描述: "功能", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 6000).toISOString() },
      { 标题: "项目3-功能-子功能", 父任务标题: "项目3-功能", Tag: [任务Tag.FEAT], 任务描述: "子功能", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 7000).toISOString() },
      { 标题: "项目3-功能-子功能-孙功能", 父任务标题: "项目3-功能-子功能", Tag: [任务Tag.FEAT], 任务描述: "孙功能", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 8000).toISOString() },
    ])
  })
}

async function testCase10_SamePriorityDifferentPaths() {
  await runTestCase("不同路径相同优先级序号", () => {
    clearAllTasks()
    const baseTime = new Date()
    baseTime.setHours(10, 0, 0, 0)

    insertTasksRaw([
      { 标题: "项目", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目", 优先级序号: 0, 创建时间UTC: baseTime.toISOString() },
      { 标题: "分支A", 父任务标题: "项目", Tag: [任务Tag.FEAT], 任务描述: "分支A", 优先级序号: 0, 创建时间UTC: baseTime.toISOString() },
      { 标题: "分支A-任务0", 父任务标题: "分支A", Tag: [任务Tag.FEAT], 任务描述: "A的任务0", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 1000).toISOString() },
      { 标题: "分支A-任务1", 父任务标题: "分支A", Tag: [任务Tag.FEAT], 任务描述: "A的任务1", 优先级序号: 1, 创建时间UTC: new Date(baseTime.getTime() + 2000).toISOString() },
      { 标题: "分支B", 父任务标题: "项目", Tag: [任务Tag.FEAT], 任务描述: "分支B", 优先级序号: 1, 创建时间UTC: new Date(baseTime.getTime() + 3000).toISOString() },
      { 标题: "分支B-任务0", 父任务标题: "分支B", Tag: [任务Tag.FEAT], 任务描述: "B的任务0", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 4000).toISOString() },
      { 标题: "分支B-任务1", 父任务标题: "分支B", Tag: [任务Tag.FEAT], 任务描述: "B的任务1", 优先级序号: 1, 创建时间UTC: new Date(baseTime.getTime() + 5000).toISOString() },
    ])
  })
}

async function testCase11_ExceedFocusLimit() {
  await runTestCase("超过任务树一次性聚焦数量上限（复杂树结构）", () => {
    clearAllTasks()
    const baseTime = new Date()
    baseTime.setHours(10, 0, 0, 0)

    // 4个根项目，不同创建时间
    insertTasksRaw([
      { 标题: "项目A-总规划", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目A总体规划", 优先级序号: 0, 创建时间UTC: baseTime.toISOString() },                                    // 10:00
      { 标题: "项目B-总规划", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目B总体规划", 优先级序号: 1, 创建时间UTC: new Date(baseTime.getTime() + 10000).toISOString() },   // 10:00:10
      { 标题: "项目C-总规划", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目C总体规划", 优先级序号: 2, 创建时间UTC: new Date(baseTime.getTime() + 20000).toISOString() },   // 10:00:20
      { 标题: "项目D-总规划", 父任务标题: null, Tag: [任务Tag.MILESTONE], 任务描述: "项目D总体规划", 优先级序号: 3, 创建时间UTC: new Date(baseTime.getTime() + 100000).toISOString() },  // 10:01:40
    ])

    // 项目A：2个一级子任务 + 各10个二级子任务 (早期，大量任务)
    for (let i = 0; i < 2; i++) {
      insertTasksRaw([
        { 标题: `A-分支${i}`, 父任务标题: "项目A-总规划", Tag: [任务Tag.FEAT], 任务描述: `A分支${i}`, 优先级序号: i, 创建时间UTC: new Date(baseTime.getTime() + 20000 + i * 1000).toISOString() },
      ])
      for (let j = 0; j < 10; j++) {
        insertTasksRaw([
          { 标题: `A-分支${i}-任务${j}`, 父任务标题: `A-分支${i}`, Tag: [任务Tag.FEAT, 任务Tag.TEST], 任务描述: `A${i}任务${j}`, 优先级序号: j, 创建时间UTC: new Date(baseTime.getTime() + 30000 + i * 100 + j).toISOString() },
        ])
      }
    }

    // 项目B：1个一级子任务 + 各20个二级子任务 (中期)
    insertTasksRaw([
      { 标题: "B-分支0", 父任务标题: "项目B-总规划", Tag: [任务Tag.FEAT], 任务描述: "B分支0", 优先级序号: 0, 创建时间UTC: new Date(baseTime.getTime() + 40000).toISOString() },
    ])
    for (let j = 0; j < 20; j++) {
      insertTasksRaw([
        { 标题: `B-分支0-任务${j}`, 父任务标题: "B-分支0", Tag: [任务Tag.FEAT], 任务描述: `B0任务${j}`, 优先级序号: j, 创建时间UTC: new Date(baseTime.getTime() + 50000 + j * 100).toISOString() },
      ])
    }

    // 项目C：3个一级子任务 + 各15个二级子任务 (中期靠后)
    for (let i = 0; i < 3; i++) {
      insertTasksRaw([
        { 标题: `C-分支${i}`, 父任务标题: "项目C-总规划", Tag: [任务Tag.FEAT], 任务描述: `C分支${i}`, 优先级序号: i, 创建时间UTC: new Date(baseTime.getTime() + 60000 + i * 1000).toISOString() },
      ])
      for (let j = 0; j < 15; j++) {
        insertTasksRaw([
          { 标题: `C-分支${i}-任务${j}`, 父任务标题: `C-分支${i}`, Tag: [任务Tag.FEAT, 任务Tag.TEST], 任务描述: `C${i}任务${j}`, 优先级序号: j, 是否完成: j % 3 === 0, 创建时间UTC: new Date(baseTime.getTime() + 70000 + i * 100 + j).toISOString() },
        ])
      }
    }

    // 项目D：5个一级子任务 + 各10个二级子任务 (最新)
    for (let i = 0; i < 5; i++) {
      insertTasksRaw([
        { 标题: `D-分支${i}`, 父任务标题: "项目D-总规划", Tag: [任务Tag.FEAT], 任务描述: `D分支${i}`, 优先级序号: i, 创建时间UTC: new Date(baseTime.getTime() + 110000 + i * 1000).toISOString() },
      ])
      for (let j = 0; j < 10; j++) {
        insertTasksRaw([
          { 标题: `D-分支${i}-任务${j}`, 父任务标题: `D-分支${i}`, Tag: [任务Tag.FEAT], 任务描述: `D${i}任务${j}`, 优先级序号: j, 是否完成: j % 2 === 0, 创建时间UTC: new Date(baseTime.getTime() + 120000 + i * 100 + j).toISOString() },
        ])
      }
    }

    // 总任务：4根 + 2+20 + 3+45 + 5+50 = 129个非根任务，超过100限制
  })
}

async function runAllTests() {
  consoleAndLogFile.infoC(LOG_COLOR.GREEN, "=".repeat(70))
  consoleAndLogFile.infoC(LOG_COLOR.GREEN, "【任务表Prompt方法 - 完整测试套件】")
  consoleAndLogFile.infoC(LOG_COLOR.GREEN, "=".repeat(70))

  await testCase1_MultiRootTasks()
  await testCase2_DeepNesting()
  await testCase3_WideBranching()
  await testCase9_SparseTree()
  await testCase10_SamePriorityDifferentPaths()
  await testCase11_ExceedFocusLimit()

  consoleAndLogFile.info("")
  consoleAndLogFile.infoC(LOG_COLOR.GREEN, "=".repeat(70))
  consoleAndLogFile.infoC(LOG_COLOR.GREEN, "【所有测试完成】")
  consoleAndLogFile.infoC(LOG_COLOR.GREEN, "=".repeat(70))
}

runAllTests().catch((err) => {
  consoleAndLogFile.error("测试执行失败:", err)
  console.error("详细错误:", err)
  process.exit(1)
})