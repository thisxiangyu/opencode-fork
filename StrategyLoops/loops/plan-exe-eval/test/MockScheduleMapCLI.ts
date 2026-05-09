/**
 * Mock 规划图CLI - 用于测试环境，不依赖实际CLI
 */

import { spawn, ChildProcess } from "child_process"

// 模拟的任务数据
export interface MockTask {
  ID?: number
  标题: string
  任务描述?: string
  Tag?: string[]
  是否完成?: boolean
  已删除?: boolean
  依赖?: string
  动态?: { 角色: string; 消息: string }[]
}

export interface MockDependencyChain {
  层: number
  依赖: {
    标题: string
    原因: string
    动态?: { 角色: string; 消息: string }[]
  }[]
}

export class MockScheduleMapCLI {
  private tasks: Map<string, MockTask> = new Map()
  private tasksById: Map<number, MockTask> = new Map()
  private nextId: number = 1
  private activities: { 标题: string; 角色: string; 消息: string }[] = []
  private throwError: boolean = false
  private errorMessage: string = ""

  constructor() {
    // 添加一些默认测试任务
    this.addTask({
      标题: "测试任务",
      任务描述: "这是一个测试任务",
      Tag: ["测试", "单元测试"],
      是否完成: false,
      依赖: "[]"
    })
    this.addTask({
      标题: "前置任务",
      任务描述: "这是前置任务",
      Tag: ["前置"],
      是否完成: true
    })
  }

  addTask(task: MockTask): number {
    const id = this.nextId++
    const taskWithId = { ...task, ID: id }
    this.tasks.set(task.标题, taskWithId)
    this.tasksById.set(id, taskWithId)
    return id
  }

  getTask(title: string): MockTask | undefined {
    return this.tasks.get(title)
  }

  getTaskById(id: number): MockTask | undefined {
    return this.tasksById.get(id)
  }

  completeTask(title: string): void {
    const task = this.tasks.get(title)
    if (task) {
      task.是否完成 = true
    }
  }

  deleteTask(title: string): void {
    const task = this.tasks.get(title)
    if (task) {
      task.已删除 = true
    }
  }

  addActivity(title: string, role: string, message: string): void {
    this.activities.push({ 标题: title, 角色: role, 消息: message })
  }

  getActivities(): { 标题: string; 角色: string; 消息: string }[] {
    return [...this.activities]
  }

  setThrowError(throwError: boolean, message: string = "CLI Error"): void {
    this.throwError = throwError
    this.errorMessage = message
  }

  // 模拟CLI命令解析和执行
  parseCommand(args: string[]): { command: string; options: Record<string, string> } {
    const command = args[0]
    const options: Record<string, string> = {}

    for (let i = 1; i < args.length; i += 2) {
      if (args[i].startsWith("--")) {
        options[args[i].substring(2)] = args[i + 1] || ""
      }
    }

    return { command, options }
  }

  executeCommand(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    if (this.throwError) {
      return { stdout: "", stderr: this.errorMessage, exitCode: 1 }
    }

    const { command, options } = this.parseCommand(args)

    try {
      switch (command) {
        case "query-by-title": {
          const title = options["标题"]
          const task = this.tasks.get(title)
          if (task) {
            return {
              stdout: JSON.stringify({ 成功: true, 数量: 1, 任务: [task] }),
              stderr: "",
              exitCode: 0
            }
          }
          return { stdout: JSON.stringify({ 成功: false, 数量: 0, 任务: [] }), stderr: "", exitCode: 0 }
        }

        case "query-by-id": {
          const id = parseInt(options["id"], 10)
          const task = this.tasksById.get(id)
          if (task) {
            return { stdout: JSON.stringify({ 成功: true, 任务: task }), stderr: "", exitCode: 0 }
          }
          return { stdout: JSON.stringify({ 成功: false, 任务: null }), stderr: "", exitCode: 0 }
        }

        case "query-dependency-chain": {
          const title = options["标题"]
          const maxDepth = parseInt(options["最大层数"] || "3", 10)
          const task = this.tasks.get(title)

          if (!task) {
            return {
              stdout: JSON.stringify({ 成功: false, 消息: "任务不存在" }),
              stderr: "",
              exitCode: 0
            }
          }

          // 解析依赖
          let dependencies: { 依赖任务ID?: number; 依赖任务: string; 原因: string }[] = []
          if (task.依赖) {
            try {
              dependencies = JSON.parse(task.依赖)
            } catch {}
          }

          // 构建依赖链
          const dependencyChain: MockDependencyChain[] = []
          for (let depth = 1; depth <= maxDepth; depth++) {
            const depsAtLevel: { 标题: string; 原因: string; 动态?: { 角色: string; 消息: string }[] }[] = []

            for (const dep of dependencies) {
              const depTask = dep.依赖任务ID
                ? this.tasksById.get(dep.依赖任务ID)
                : this.tasks.get(dep.依赖任务)

              if (depTask) {
                depsAtLevel.push({
                  标题: depTask.标题,
                  原因: dep.原因,
                  动态: depTask.动态 || []
                })
              }
            }

            if (depsAtLevel.length > 0) {
              dependencyChain.push({ 层: depth, 依赖: depsAtLevel })
            }

            // 准备下一层依赖
            const nextDeps: { 依赖任务ID?: number; 依赖任务: string; 原因: string }[] = []
            for (const dep of dependencies) {
              const depTask = dep.依赖任务ID
                ? this.tasksById.get(dep.依赖任务ID)
                : this.tasks.get(dep.依赖任务)
              if (depTask?.依赖) {
                try {
                  nextDeps.push(...JSON.parse(depTask.依赖))
                } catch {}
              }
            }
            dependencies = nextDeps
          }

          return {
            stdout: JSON.stringify({
              成功: true,
              任务: {
                标题: task.标题,
                任务描述: task.任务描述,
                Tag: task.Tag,
                动态: task.动态 || []
              },
              依赖链: dependencyChain
            }),
            stderr: "",
            exitCode: 0
          }
        }

        case "add-activity": {
          const title = options["标题"]
          const role = options["角色"]
          const message = options["消息"]
          this.addActivity(title, role, message)
          return { stdout: "OK", stderr: "", exitCode: 0 }
        }

        default:
          return { stdout: "", stderr: `Unknown command: ${command}`, exitCode: 1 }
      }
    } catch (e) {
      return {
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: 1
      }
    }
  }
}

// 全局单例
let globalMockCLI: MockScheduleMapCLI | null = null

export function getMockCLI(): MockScheduleMapCLI {
  if (!globalMockCLI) {
    globalMockCLI = new MockScheduleMapCLI()
  }
  return globalMockCLI
}

export function resetMockCLI(): void {
  globalMockCLI = new MockScheduleMapCLI()
}

export function setMockCLI(cli: MockScheduleMapCLI): void {
  globalMockCLI = cli
}

/**
 * 创建模拟 spawn 结果的工厂函数
 * 用于 stub spawn 让它返回预设的 MockCLI 结果
 */
export function createSpawnStub(mockCLI: MockScheduleMapCLI) {
  return function stubSpawn(
    command: string,
    args: string[],
    _options?: any
  ): ChildProcess {
    const { stdout, stderr, exitCode } = mockCLI.executeCommand(args)

    const mockProcess = {
      stdout: {
        on: (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from(stdout)), 0)
          }
        }
      },
      stderr: {
        on: (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from(stderr)), 0)
          }
        }
      },
      on: (event: string, callback: (code: number) => void) => {
        if (event === "close" || event === "exit") {
          setTimeout(() => callback(exitCode), 0)
        }
        if (event === "error") {
          // noop
        }
      },
      kill: () => {},
    } as unknown as ChildProcess

    return mockProcess
  }
}
