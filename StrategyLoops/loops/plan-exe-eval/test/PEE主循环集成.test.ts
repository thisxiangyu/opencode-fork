import { describe, expect, it, vi } from "vitest"
import { mkdir, writeFile, copyFile } from "fs/promises"
import { join } from "path"
import { consoleAndLogFile } from "../../../common/logger"
import { AbortError, INTERRUPTION_REASON, MSG_SOURCE, type InterruptedMsgContext, type SessionMessage } from "../../../common/types"
import type { IRole } from "../../../common/role"
import type { ISession } from "../../../common/session"
import { LoopConfig } from "../../../common/loopConfig"
import { main, 冗余枝剪者, 架构师, 质保员, 边缘质保员 } from "../规划图驱动的PEE"

const 静态检查模版Path = join(__dirname, "../../../common/CICD/Node静态检查模版.js")

/** 创建仅含 name 的 mock IRole，用于测试中的 commitAllowedRoles 配置 */
const role = (name: string): IRole => ({ name } as IRole)

class ScriptedSession implements ISession {
  id: string
  role: IRole
  directory: string
  private messages: SessionMessage[] = []
  private compactHistoryCalls: boolean[] = []
  private interruptionCallbacks: Array<(msg: InterruptedMsgContext) => void> = []
  private scriptedResponses: Array<() => Promise<string>>
  private waitResponse = ""

  constructor(role: IRole, directory: string, scriptedResponses: Array<() => Promise<string>>) {
    this.role = role
    this.directory = directory
    this.id = `${role.name}-session`
    this.scriptedResponses = scriptedResponses
  }

  onInterruption(callback: (msg: InterruptedMsgContext) => void): void {
    this.interruptionCallbacks.push(callback)
  }

  onMessage(): void {}
  setCurrentContext(): void {}
  getReceiveState() { return "EXPECTING_NEXT_MESSAGE" as any }
  async disposeAsync(): Promise<void> {}
  clearInterruption(): void {}
  async waitForInterruption(): Promise<string> { return "" }
  async getMessages(): Promise<SessionMessage[]> { return this.messages }
  getTokenUsage() { return undefined }

  getCompactHistoryCalls(): boolean[] { return [...this.compactHistoryCalls] }

  async sendMsg(message: SessionMessage, compactHistory?: boolean): Promise<string> {
    this.messages.push(message)
    this.compactHistoryCalls.push(compactHistory === true)
    const next = this.scriptedResponses.shift()
    if (!next) throw new Error(`No scripted response for role ${this.role.name}`)
    return next()
  }

  async waitForUserMessage(): Promise<string> {
    return this.waitResponse
  }

  setWaitResponse(message: string): void {
    this.waitResponse = message
  }

  emitInterruption(interrupt: InterruptedMsgContext): void {
    for (const callback of this.interruptionCallbacks) {
      callback(interrupt)
    }
  }
}

describe("PEE main loop integration", () => {
  async function runMainWithScript(options: {
    projectDir: string
    plannerResponses: Array<() => Promise<string>>
    compactorResponses?: Array<() => Promise<string>>
    executorResponses?: Array<() => Promise<string>>
    evaluatorResponses?: Array<() => Promise<string>>
    scissorResponses?: Array<() => Promise<string>>
    architectResponses?: Array<() => Promise<string>>
    qaResponses?: Array<() => Promise<string>>
    edgeQaResponses?: Array<() => Promise<string>>
    commitResponses?: Array<() => Promise<string>>
    taskMap: Map<string, any>
    relocateRole?: (allRoles: IRole[]) => Promise<IRole>
    waitResponse?: string
    interruptRoleName?: string
    interruptReason?: InterruptedMsgContext["reason"]
    interruptMessage?: string
    failOnActivityRole?: string
    askUserResponse?: string
    failSetup?: boolean
    failQueryByTitle?: boolean
    staticCheckMaxRetries?: number
    getGitHead?: (projectDir: string) => Promise<string | null>
    commitAllowedRoles?: IRole[]
    maxCycles?: number
  }) {
    const sessions = new Map<string, ScriptedSession>()
    const activities: Array<{ 标题: string; 角色: string; 消息: string }> = []
    const qaResponse = JSON.stringify({ 一句话动态: "检查无问题" })

    const makeSession = (role: IRole) => {
      if (sessions.has(role.name)) return sessions.get(role.name)!
      const scriptedResponses =
        role.name === "planner" ? options.plannerResponses :
        role.name === "compactor" ? (options.compactorResponses ?? [async () => JSON.stringify({ 是否压缩: false })]) :
        role.name === "executor" ? (options.executorResponses ?? [async () => "执行完成"]) :
        role.name === "evaluator" ? (options.evaluatorResponses ?? [async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] })]) :
        role.name === "scissorHands" ? (options.scissorResponses ?? [async () => JSON.stringify({ 一句话动态: "检查无问题" })]) :
        role.name === "architect" ? (options.architectResponses ?? [async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "" })]) :
        role.name === "QA" ? (options.qaResponses ?? [async () => qaResponse]) :
        role.name === "edgeQA" ? (options.edgeQaResponses ?? [async () => qaResponse]) :
        (options.commitResponses ?? [async () => JSON.stringify({ 一句话动态: "无提交，原因: 测试模式" })])
      const session = new ScriptedSession(role, options.projectDir, scriptedResponses)
      sessions.set(role.name, session)
      return session
    }

    const setupProjectEnvironment = vi.fn(async (directory: string) => {
      if (options.failSetup) {
        throw new Error("setup failed")
      }
      await mkdir(directory, { recursive: true })
      await writeFile(`${directory}/规划图CLI.js`, "// test stub\n", "utf-8")
      await copyFile(静态检查模版Path, `${directory}/静态检查脚本.js`)
    })
    const linkBackend = vi.fn().mockReturnValue("mock-backend")
    const selectOrCreateSession = vi.fn(async (role: IRole) => {
      const session = makeSession(role)
      session.setWaitResponse(options.waitResponse ?? "")
      return session
    })
    const createSession = vi.fn(async (role: IRole) => makeSession(role))
    const relocateRole = vi.fn(options.relocateRole ?? (async (allRoles: IRole[]) => allRoles.find((role) => role.name === "edgeQA")!))

    const runScheduleMapCli = vi.fn(async (_projectDir: string, args: string[]) => {
      const action = args[0]
      const result = (() => {
        if (action === "query-by-title") {
          const title = args[2]
          if (options.failQueryByTitle) {
            return { stdout: "", stderr: "forced query failure", exitCode: 1 }
          }
          return { stdout: JSON.stringify({ 成功: true, 数量: 1, 任务: [options.taskMap.get(title)] }), stderr: "", exitCode: 0 }
        }
        if (action === "query-by-id") {
          return { stdout: JSON.stringify({ 成功: false, 任务: null }), stderr: "", exitCode: 0 }
        }
        if (action === "query-dependency-chain") {
          return {
            stdout: JSON.stringify({
              成功: true,
              任务: options.taskMap.get("测试任务"),
              依赖链: [],
            }),
            stderr: "",
            exitCode: 0,
          }
        }
        if (action === "add-activity") {
          if (options.failOnActivityRole && args[4] === options.failOnActivityRole) {
            return { stdout: "", stderr: "forced activity failure", exitCode: 1 }
          }
          activities.push({ 标题: args[2]!, 角色: args[4]!, 消息: args[6]! })
          return { stdout: "OK", stderr: "", exitCode: 0 }
        }
        return { stdout: "", stderr: "unexpected command", exitCode: 1 }
      })()
      return result
    })

    const mainPromise = main({
      linkBackend,
      selectOrCreateSession,
      createSession,
      relocateRole,
      setupProjectEnvironment,
      loopConfig: new LoopConfig({ maxCycles: options.maxCycles ?? 1, startPrompt: "test-start", staticCheckMaxRetries: options.staticCheckMaxRetries }),
      askUser: vi.fn(async () => options.askUserResponse ?? ""),
      runScheduleMapCli,
      getGitHead: options.getGitHead ?? (async () => "abc123def"),
      commitAllowedRoles: options.commitAllowedRoles,
    })

    if (options.interruptRoleName) {
      const interruptedSession = sessions.get(options.interruptRoleName)
      interruptedSession?.emitInterruption({
        roleName: options.interruptRoleName,
        beforeMessage: "执行中",
        receivedMessage: options.interruptMessage ?? "用户改口",
        timestamp: new Date(),
        reason: options.interruptReason ?? INTERRUPTION_REASON.rollback,
      })
    }

    await mainPromise
    return { activities, sessions, setupProjectEnvironment, relocateRole }
  }

  it("reuses resumed response after abort, then lets user override next dispatch", async () => {
    const projectDir = "/tmp/pee-main-integration"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证中断恢复与派发覆盖",
        Tag: ["test", "fix"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])
    const { activities, sessions, setupProjectEnvironment, relocateRole } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "请执行并补测试" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      executorResponses: [
        async () => { throw new AbortError() },
        async () => "已根据新的用户引导补充了边缘测试",
      ],
      taskMap,
      relocateRole: async (allRoles: IRole[]) => allRoles.find((role) => role.name === "edgeQA")!,
      waitResponse: "用户改口：先只去找边缘用例",
      interruptRoleName: "executor",
      interruptReason: INTERRUPTION_REASON.rollback,
      interruptMessage: "用户改口：先只去找边缘用例",
    })

    expect(setupProjectEnvironment).toHaveBeenCalledWith(projectDir, "test-start", expect.any(Function))
    expect(relocateRole).toHaveBeenCalled()
    const executorSession = sessions.get("executor")
    expect(executorSession).toBeDefined()
    const executorMessages = await executorSession!.getMessages()
    expect(executorMessages.some((message) => message.msgSource === MSG_SOURCE.system)).toBe(true)
    expect(relocateRole).toHaveBeenCalledTimes(1)
    expect(activities.some((activity) => activity.角色 === "commitman")).toBe(true)
  })

  it("records evaluator rejection and routes executor through rejection loop with full json", async () => {
    const projectDir = "/tmp/pee-evaluator-rejection"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证评估者打回链",
        Tag: ["test", "fix"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { activities, sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "先修评估问题" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      executorResponses: [
        async () => "第一次实现",
        async () => "已按评估者意见补充边缘测试，暂无已知遗留风险。",
      ],
      evaluatorResponses: [
        async () => JSON.stringify({ 检查结果: "打回", 问题列表: ["缺测试"] }),
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] }),
      ],
      taskMap,
    })

    const executorSession = sessions.get("executor")
    const evaluatorSession = sessions.get("evaluator")
    expect(executorSession).toBeDefined()
    expect(evaluatorSession).toBeDefined()
    const executorMessages = await executorSession!.getMessages()
    const evaluatorMessages = await evaluatorSession!.getMessages()
    expect(executorMessages.some((message) => message.content.includes('"问题列表":["缺测试"]'))).toBe(true)
    expect(evaluatorMessages.some((message) => message.content.includes("评估者第1次打回"))).toBe(true)
    expect(evaluatorMessages.some((message) => message.content.includes("执行反馈: 已按评估者意见补充边缘测试，暂无已知遗留风险。"))).toBe(true)
    expect(activities.some((activity) => activity.角色 === "evaluator" && activity.消息 === "evaluator打回1次")).toBe(true)
  })

  it("does not re-compact follower roles during rejection loops", async () => {
    const projectDir = "/tmp/pee-no-recompact-in-rejection"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证打回循环不重复压缩",
        Tag: ["test", "fix"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "按流程执行" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      compactorResponses: [
        async () => JSON.stringify({ 是否压缩: true }),
      ],
      executorResponses: [
        async () => "第一次实现",
        async () => "已按打回意见调整实现",
      ],
      evaluatorResponses: [
        async () => JSON.stringify({ 检查结果: "打回", 问题列表: ["缺测试"] }),
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] }),
      ],
      taskMap,
    })

    const executorSession = sessions.get("executor")!
    const evaluatorSession = sessions.get("evaluator")!
    expect(executorSession.getCompactHistoryCalls()).toEqual([true, false])
    expect(evaluatorSession.getCompactHistoryCalls()).toEqual([true, false])
  })

  it("asks executor to fix static check failures before moving to evaluator", async () => {
    const projectDir = "/tmp/pee-static-check-failure"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证静态检查失败会打回执行者",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "先修静态检查" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      executorResponses: [
        async () => {
          await writeFile(
            join(projectDir, "tsconfig.json"),
            JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true }, include: ["*.ts"] }),
            "utf-8",
          )
          await writeFile(join(projectDir, "main.ts"), "const x: number = 'wrong type'\n", "utf-8")
          return "第一次实现"
        },
        async () => {
          await writeFile(join(projectDir, "main.ts"), "const x: number = 42\n", "utf-8")
          return "已修复静态检查问题"
        },
      ],
      taskMap,
    })

    const executorSession = sessions.get("executor")
    const evaluatorSession = sessions.get("evaluator")
    expect(executorSession).toBeDefined()
    expect(evaluatorSession).toBeDefined()
    const executorMessages = await executorSession!.getMessages()
    const staticCheckMessages = executorMessages.filter((message) => message.content.includes("静态检查未通过"))
    expect(staticCheckMessages.length).toBeGreaterThanOrEqual(1)
    // 验证消息中包含了 tsc 输出的具体类型错误信息
    expect(staticCheckMessages[0]!.content).toContain("error TS2322")
    expect(staticCheckMessages[0]!.content).toContain("Type 'string' is not assignable to type 'number'")
  })

  it("stops after configured static check retry limit", async () => {
    const projectDir = "/tmp/pee-static-check-limit"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证静态检查重试上限",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    await expect(runMainWithScript({
      projectDir,
      plannerResponses: [async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "触发静态检查上限" })],
      executorResponses: Array.from({ length: 3 }, () => async () => {
        await writeFile(`${projectDir}/静态检查脚本.js`, "process.stderr.write('still failed')\nprocess.exit(1)\n", "utf-8")
        return "仍未修复"
      }),
      taskMap,
      staticCheckMaxRetries: 3,
    })).rejects.toThrow("执行者连续3次未通过")
  })

  it("records architect rejection and walks full sub-loop evaluator -> scissor -> architect", async () => {
    const projectDir = "/tmp/pee-architect-rejection"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证架构师打回链",
        Tag: ["refactor", "test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { activities, sessions } = await runMainWithScript({
      projectDir,
      maxCycles: 2,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "关注架构一致性" }),
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "第2轮继续看架构" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      compactorResponses: Array.from({ length: 2 }, () => async () => JSON.stringify({ 是否压缩: false })),
      executorResponses: [
        async () => "第一次实现",
        async () => "已按架构建议重新分层，暂无已知遗留风险。",
        async () => "第二轮正常执行",
      ],
      evaluatorResponses: [
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] }),
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] }),
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] }),
      ],
      architectResponses: [
        async () => JSON.stringify({ 检查结果: "打回", 架构问题: ["分层不清晰"], 重构建议: "按领域拆分" }),
        async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "" }),
      ],
      scissorResponses: [
        async () => JSON.stringify({ 一句话动态: "检查无问题" }),
        async () => JSON.stringify({ 一句话动态: "检查无问题" }),
      ],
      commitResponses: [
        async () => JSON.stringify({ 一句话动态: "无提交，原因: 第1轮测试" }),
        async () => JSON.stringify({ 一句话动态: "无提交，原因: 第2轮测试" }),
      ],
      taskMap,
    })

    const executorSession = sessions.get("executor")
    const evaluatorSession = sessions.get("evaluator")
    const scissorSession = sessions.get("scissorHands")
    const architectSession = sessions.get("architect")
    expect(executorSession).toBeDefined()
    expect(evaluatorSession).toBeDefined()
    expect(scissorSession).toBeDefined()
    expect(architectSession).toBeDefined()
    const executorMessages = await executorSession!.getMessages()
    const evaluatorMessages = await evaluatorSession!.getMessages()
    const scissorMessages = await scissorSession!.getMessages()
    const architectMessages = await architectSession!.getMessages()
    expect(executorMessages.some((message) => message.content.includes('"架构问题":["分层不清晰"]'))).toBe(true)
    expect(executorMessages.some((message) => message.content.includes('"重构建议":"按领域拆分"'))).toBe(true)
    expect(evaluatorMessages.some((message) => message.content.includes("架构师第1次打回"))).toBe(true)
    expect(evaluatorMessages.length).toBeGreaterThanOrEqual(2)
    expect(scissorMessages.length).toBeGreaterThanOrEqual(2)
    expect(architectMessages.length).toBeGreaterThanOrEqual(2)
    expect(activities.some((activity) => activity.角色 === "architect" && activity.消息 === "architect打回1次")).toBe(true)
  })

  it("revalidates resumed planner output before dispatching next role", async () => {
    const projectDir = "/tmp/pee-planner-resume-validation"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证规划者恢复后仍走派发验证",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      taskMap,
      interruptRoleName: "planner",
      interruptReason: INTERRUPTION_REASON.rollback,
      interruptMessage: JSON.stringify({ 本轮任务标题: "测试任务", 留言: "先验证任务合法性" }),
    })

    const plannerSession = sessions.get("planner")
    expect(plannerSession).toBeDefined()
    const plannerMessages = await plannerSession!.getMessages()
    expect(plannerMessages.some((message) => message.content.includes("一步步来，慢思考"))).toBe(true)
  })

  it("throws when activity recording fails during real main loop", async () => {
    const projectDir = "/tmp/pee-activity-failure"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证动态落库失败会中断主循环",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    await expect(runMainWithScript({
      projectDir,
      maxCycles: 2,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "触发QA动态落库失败" }),
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "第2轮触发QA动态落库失败" }),
      ],
      compactorResponses: Array.from({ length: 2 }, () => async () => JSON.stringify({ 是否压缩: false })),
      executorResponses: Array.from({ length: 2 }, () => async () => "执行完成"),
      evaluatorResponses: Array.from({ length: 2 }, () => async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] })),
      taskMap,
      failOnActivityRole: "QA",
    })).rejects.toThrow("记录角色动态失败")
  })

  it("throws immediately when project setup fails", async () => {
    const projectDir = "/tmp/pee-setup-failure"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证初始化失败分支",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    await expect(runMainWithScript({
      projectDir,
      plannerResponses: [async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "不会执行到这里" })],
      taskMap,
      failSetup: true,
    })).rejects.toThrow("setup failed")
  })

  it("fails after planner dispatch retries when task query keeps failing", async () => {
    const projectDir = "/tmp/pee-query-failure"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证派发查询失败分支",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    await expect(runMainWithScript({
      projectDir,
      plannerResponses: Array.from({ length: 12 }, () => async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "查询会失败" })),
      taskMap,
      failQueryByTitle: true,
    })).rejects.toThrow("派发验证尝试超过10次")
  })

  it("sends exhaustion message to planner and exits when user presses Enter", async () => {
    const projectDir = "/tmp/pee-exhausted-exit"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证轮次耗尽退出",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { sessions, setupProjectEnvironment } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "已了解" }), // exhaustion通知的响应
      ],
      taskMap,
      askUserResponse: "", // 空输入 = 回车退出
    })

    expect(setupProjectEnvironment).toHaveBeenCalledWith(projectDir, "test-start", expect.any(Function))
    const plannerSession = sessions.get("planner")
    expect(plannerSession).toBeDefined()
    const plannerMessages = await plannerSession!.getMessages()
    // 最后一轮发送给规划者的消息应包含"所有轮次已耗尽"
    const exhaustionMsg = plannerMessages[plannerMessages.length - 1]
    expect(exhaustionMsg.content).toContain("所有轮次已耗尽")
  })

  it("adds n rounds and continues when user enters a positive number", async () => {
    const projectDir = "/tmp/pee-exhausted-continue"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证追加轮次",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    // 测试逻辑：
    // 1. maxCycles=1 运行 1 个 cycle，cycle 变为 1
    // 2. while (1 < 1) 退出，向规划者发送 exhaustion 通知
    // 3. AskUser 返回 "2"，maxCycles 变为 3，exitedViaEarlyCompletion 重置
    // 4. continue outer，继续运行 cycles 1, 2
    // 5. cycle 2 完成后，while (3 < 3) 退出
    // 6. exitedViaEarlyCompletion 已为 true，跳过 AskUser，break outer 退出
    //
    // 需要的响应：2 cycles + 1 notification + 2 early completion = 5 sets per role
    // 但实际上 notification 也消耗一轮完整响应链，所以是 2 + 1 + 2 = 5
    const { sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "第1轮" }),
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "exhaustion通知" }), // notification cycle response
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "第3轮" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      compactorResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 是否压缩: false })),
      executorResponses: Array.from({ length: 6 }, () => async () => "执行完成"),
      evaluatorResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] })),
      scissorResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 一句话动态: "无提交，原因: 测试" })),
      architectResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "" })),
      qaResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 一句话动态: "检查无问题" })),
      edgeQaResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 一句话动态: "无提交，原因: 测试" })),
      commitResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 一句话动态: "无提交，原因: 测试" })),
      taskMap,
      askUserResponse: "2", // 追加2轮
    })

    const plannerSession = sessions.get("planner")
    expect(plannerSession).toBeDefined()
    const plannerMessages = await plannerSession!.getMessages()
    // maxCycles=1 runs cycle 0, then AskUser返回"2"，追加2轮后继续 (cycles 1, 2)
    // plannerMessages: task1 + notification + task2 + early_completion = 4
    // (confirmation "是的" is sent via a separate sendMsg that doesn't push to messages)
    expect(plannerMessages.length).toBe(5)
    // 检查是否有包含"所有轮次已耗尽"的消息
    const hasExhaustionMsg = plannerMessages.some(m => m.content.includes("所有轮次已耗尽"))
    expect(hasExhaustionMsg).toBe(true)
  })

  it("detects abnormal commit by writable non-commitman role and blocks until fixed", async () => {
    const projectDir = "/tmp/pee-abnormal-commit"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证异常提交检测与修复闭环",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    // 模拟 git HEAD：先正常，执行者偷偷提交后变脏，修复后恢复
    let gitHeadValue = "abc123def"
    const mockGetGitHead = vi.fn(async () => gitHeadValue)

    const { sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => "收到",
      ],
      executorResponses: [
        async () => {
          gitHeadValue = "def456abc" // 模拟无权限角色偷偷提交
          return "执行完成"
        },
        async () => {
          gitHeadValue = "abc123def" // 按指令 git reset --soft 后恢复
          return "已撤回"
        },
      ],
      taskMap,
      getGitHead: mockGetGitHead,
    })

    const executorSession = sessions.get("executor")
    expect(executorSession).toBeDefined()
    const messages = await executorSession!.getMessages()

    // 验证执行者收到了异常提交错误消息
    const errorMsg = messages.find(m => m.content.includes("不合规定的提前提交"))
    expect(errorMsg).toBeDefined()
    expect(errorMsg!.content).toContain("git reset --soft")
    expect(errorMsg!.content).toContain("你缺少提交权限")

    // 验证 getGitHead 被多次调用（基线 + 检测 + 重检）
    expect(mockGetGitHead.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it("throws when abnormal commit fix exceeds max retries", async () => {
    const projectDir = "/tmp/pee-abnormal-commit-limit"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证异常提交修复超限后终止",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    // 执行者触发异常提交后持续不修复：基线正常，之后一直脏 HEAD
    let gitHeadValue = "abc123def"
    const mockGetGitHead = vi.fn(async () => gitHeadValue)

    await expect(runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "触发提交上限" }),
        async () => "收到",
      ],
      // 1 个任务回复 + 5 个错误回复（第 6 轮检测时 commitRetries>5 直接抛错，不再发消息）
      executorResponses: [
        async () => {
          gitHeadValue = "def456ab" // 触发异常提交
          return "执行完成"
        },
        ...Array.from({ length: 5 }, () => async () => "不撤回"),
      ],
      taskMap,
      getGitHead: mockGetGitHead,
    })).rejects.toThrow("异常提交修复超过5次")
  })

  it("allows commit when writable role is in commitAllowedRoles", async () => {
    const projectDir = "/tmp/pee-custom-authorized"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证自定义授权列表允许额外角色提交",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    // commitAllowedRoles 包含执行者，执行者提交合法，不应收到错误
    let gitHeadValue = "abc123def"
    const mockGetGitHead = vi.fn(async () => gitHeadValue)

    const { sessions } = await runMainWithScript({
      projectDir,
      commitAllowedRoles: [role("commitman"), role("executor")],
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => "收到",
      ],
      executorResponses: [
        async () => {
          gitHeadValue = "def456abc" // 执行者有权限，提交合法
          return "执行完成"
        },
      ],
      taskMap,
      getGitHead: mockGetGitHead,
    })

    const executorSession = sessions.get("executor")
    const messages = await executorSession!.getMessages()
    // 执行者不应收到异常提交错误
    expect(messages.some(m => m.content.includes("不合规定的提前提交"))).toBe(false)
  })

  it("refreshes baseline when authorized role arrives, even without committing", async () => {
    const projectDir = "/tmp/pee-baseline-no-commit"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证授权角色不提交时仍刷新基线",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    let gitHeadValue = "abc123def"
    const mockGetGitHead = vi.fn(async () => gitHeadValue)

    await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => "收到",
      ],
      taskMap,
      getGitHead: mockGetGitHead,
    })

    // 首轮所有角色都应介入，因此首轮调用数应恢复到包含全部 writable 角色检查的水平。
    expect(mockGetGitHead.mock.calls.length).toBeGreaterThan(6)
  })

  it("refreshes baseline after authorized role commits, so next cycle passes", async () => {
    const projectDir = "/tmp/pee-baseline-commit-follow"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证提交员提交后基线跟随刷新",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    // 提交员提交后 HEAD 变为新值，后续 unauthorized 角色应对照新基线
    let gitHeadValue = "abc123def"
    const mockGetGitHead = vi.fn(async () => gitHeadValue)

    // maxCycles=2，使第二轮规划者也能执行提交检测
    const qaResp = async () => JSON.stringify({ 一句话动态: "检查无问题" })
    const evalPassResp = async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] })
    const archPassResp = async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "" })

    await runMainWithScript({
      projectDir,
      maxCycles: 2,
      staticCheckMaxRetries: 0,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "第1轮" }),
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "第2轮" }),
        async () => "收到",
      ],
      compactorResponses: Array.from({ length: 4 }, () => async () => JSON.stringify({ 是否压缩: false })),
      executorResponses: Array.from({ length: 4 }, () => async () => "执行完成"),
      evaluatorResponses: Array.from({ length: 4 }, () => evalPassResp),
      scissorResponses: Array.from({ length: 4 }, () => qaResp),
      architectResponses: Array.from({ length: 4 }, () => archPassResp),
      qaResponses: Array.from({ length: 4 }, () => qaResp),
      edgeQaResponses: Array.from({ length: 4 }, () => qaResp),
      commitResponses: [
        async () => {
          gitHeadValue = "new00001" // 提交员合法提交，HEAD 前进
          return JSON.stringify({ 一句话动态: "已提交，git哈希: new00001" })
        },
        async () => JSON.stringify({ 一句话动态: "无提交，原因: 测试" }),
        async () => JSON.stringify({ 一句话动态: "无提交，原因: 测试" }),
      ],
      taskMap,
      getGitHead: mockGetGitHead,
    })

    // 若基线未刷新，第二轮规划者会对 "new00001" 参照旧基线 "abc123def" 报异常提交
    // 测试不抛异常即证明基线正确刷新
    expect(mockGetGitHead).toHaveBeenCalled()
  })

  it("adapts sparse-role assertions to current configured intervals", async () => {
    const projectDir = "/tmp/pee-sparse-filter-roles"
    const sparseRoles = [
      { name: "scissorHands", role: new 冗余枝剪者() },
      { name: "architect", role: new 架构师() },
      { name: "QA", role: new 质保员() },
      { name: "edgeQA", role: new 边缘质保员() },
    ]
    const maxInterval = Math.max(...sparseRoles.map((item) => item.role.介入间隔))
    const maxCycles = maxInterval + 1
    const taskMap = new Map<string, any>([
      ["测试任务1", {
        ID: 1,
        标题: "测试任务1",
        任务描述: "验证稀疏滤镜角色首轮介入",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
      ["测试任务2", {
        ID: 2,
        标题: "测试任务2",
        任务描述: "验证第二轮跳过",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
      ["测试任务3", {
        ID: 3,
        标题: "测试任务3",
        任务描述: "验证第三轮批量任务范围",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
      ["测试任务4", {
        ID: 4,
        标题: "测试任务4",
        任务描述: "验证更大介入间隔时的再次介入",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const consoleSpy = vi.spyOn(consoleAndLogFile, "info")
    try {
      const { sessions } = await runMainWithScript({
        projectDir,
        maxCycles,
        plannerResponses: [
          async () => JSON.stringify({ 本轮任务标题: "测试任务1", 留言: "第1轮" }),
          async () => JSON.stringify({ 本轮任务标题: "测试任务2", 留言: "第2轮" }),
          async () => JSON.stringify({ 本轮任务标题: "测试任务3", 留言: "第3轮" }),
          async () => JSON.stringify({ 本轮任务标题: "测试任务4", 留言: "第4轮" }),
          async () => "收到",
        ].slice(0, maxCycles + 1),
        compactorResponses: Array.from({ length: maxCycles }, () => async () => JSON.stringify({ 是否压缩: false })),
        executorResponses: Array.from({ length: maxCycles }, () => async () => "执行完成"),
        evaluatorResponses: Array.from({ length: maxCycles }, () => async () => JSON.stringify({ 检查结果: "通过", 问题列表: [] })),
        scissorResponses: Array.from({ length: maxCycles }, () => async () => JSON.stringify({ 一句话动态: "检查无问题" })),
        architectResponses: Array.from({ length: maxCycles }, () => async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "" })),
        qaResponses: Array.from({ length: maxCycles }, () => async () => JSON.stringify({ 一句话动态: "检查无问题" })),
        edgeQaResponses: Array.from({ length: maxCycles }, () => async () => JSON.stringify({ 一句话动态: "检查无问题" })),
        commitResponses: [
          async () => JSON.stringify({ 一句话动态: "无提交，原因: 第1轮测试" }),
          async () => JSON.stringify({ 一句话动态: "无提交，原因: 第2轮测试" }),
          async () => JSON.stringify({ 一句话动态: "无提交，原因: 第3轮测试" }),
          async () => JSON.stringify({ 一句话动态: "无提交，原因: 第4轮测试" }),
          async () => JSON.stringify({ 一句话动态: "无提交，原因: 额外测试" }),
        ].slice(0, maxCycles + 1),
        taskMap,
      })

      const commitDynamics = [
        "无提交，原因: 第1轮测试",
        "无提交，原因: 第2轮测试",
        "无提交，原因: 第3轮测试",
        "无提交，原因: 第4轮测试",
      ]

      for (const sparseRole of sparseRoles) {
        const messages = await sessions.get(sparseRole.name)?.getMessages()
        expect(messages).toBeDefined()
        const interveneCycles = Array.from({ length: maxCycles }, (_, cycle) => cycle)
          .filter((cycle) => cycle === 0 || cycle % sparseRole.role.介入间隔 === 0)
        expect(messages).toHaveLength(interveneCycles.length)
        expect(messages?.[0]?.content).toContain("暂无新增任务")

        for (let index = 1; index < interveneCycles.length; index++) {
          const currentCycle = interveneCycles[index]!
          const previousCycle = interveneCycles[index - 1]!
          const expectedTaskIndices = Array.from({ length: currentCycle - previousCycle - 1 }, (_, offset) => previousCycle + offset + 1)
          for (const taskIndex of expectedTaskIndices) {
            expect(messages?.[index]?.content).toContain(`测试任务${taskIndex + 1}: ${commitDynamics[taskIndex]}`)
          }
        }

        const skippedCycles = Array.from({ length: maxCycles }, (_, cycle) => cycle)
          .filter((cycle) => cycle > 0 && cycle % sparseRole.role.介入间隔 !== 0)
        for (const skippedCycle of skippedCycles) {
          expect(consoleSpy.mock.calls.some(([message]) => String(message).includes(`[稀疏角色跳过] 第${skippedCycle + 1}轮跳过 ${sparseRole.name}`))).toBe(true)
        }
      }
    } finally {
      consoleSpy.mockRestore()
    }
  })

  it("does not trigger commit detection for readonly roles", async () => {
    const projectDir = "/tmp/pee-readonly-skip"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证readonly角色不触发提交检测",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const mockGetGitHead = vi.fn(async () => "abc123def")

    const { sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => "收到",
      ],
      taskMap,
      getGitHead: mockGetGitHead,
    })

    // 评估者、架构师、压缩决策员均为 readonly，不应收到异常提交消息
    for (const roleName of ["evaluator", "architect", "compactor"]) {
      const s = sessions.get(roleName)
      if (!s) continue
      const messages = await s.getMessages()
      expect(messages.some(m => m.content.includes("不合规定的提前提交"))).toBe(false)
    }
  })

  it("after authorized role commits, next unauthorized writable role passes baseline check", async () => {
    const projectDir = "/tmp/pee-authorized-commit-no-false-positive"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证授权角色提交后，下一位无权限writable角色不会被误判",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    // commitAllowedRoles 含执行者，执行者提交后基线应刷新，
    // 后续 scissorHands/QA/edgeQA 不应被误判为异常提交
    let gitHeadValue = "abc123def"
    const mockGetGitHead = vi.fn(async () => gitHeadValue)

    const { sessions } = await runMainWithScript({
      projectDir,
      commitAllowedRoles: [role("commitman"), role("executor")],
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => "收到",
      ],
      executorResponses: [
        async () => {
          gitHeadValue = "def456abc" // 授权角色合法提交
          return "执行完成"
        },
      ],
      taskMap,
      getGitHead: mockGetGitHead,
    })

    // 后续无权限 writable 角色不应收到异常提交错误
    for (const roleName of ["scissorHands", "QA", "edgeQA"]) {
      const s = sessions.get(roleName)
      if (!s) continue
      const messages = await s.getMessages()
      expect(messages.some(m => m.content.includes("不合规定的提前提交"))).toBe(false)
    }
    // getGitHead 被调用次数应包括到达时刷新 + 结束后刷新（授权角色两轮刷新）
    expect(mockGetGitHead.mock.calls.length).toBeGreaterThan(5)
  })

  it("throws when commitAllowedRoles contains a name not matching any role in allRoles", async () => {
    const projectDir = "/tmp/pee-unknown-role"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证未知角色名配置即报错",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    // "nonexistent" 不存在于 allRoles 中，应直接抛错
    await expect(runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "不会执行到" }),
      ],
      commitAllowedRoles: [role("commitman"), role("nonexistent")],
      taskMap,
    })).rejects.toThrow("commitAllowedRoles 包含无法匹配的角色")
  })

  it("fails closed when git HEAD is unavailable before baseline is established", async () => {
    const projectDir = "/tmp/pee-null-head-initial"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证无法建立合法提交基线时直接报错",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    await expect(runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "不会执行到" }),
      ],
      getGitHead: async () => null,
      taskMap,
    })).rejects.toThrow("无法获取仓库 git HEAD")
  })

  it("injects runtime commit policy prompt for authorized writable role", async () => {
    const projectDir = "/tmp/pee-authorized-prompt"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证授权 writable 角色收到可提交提示",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { sessions } = await runMainWithScript({
      projectDir,
      commitAllowedRoles: [role("commitman"), role("executor")],
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => "收到",
      ],
      executorResponses: [async () => "执行完成"],
      taskMap,
      getGitHead: async () => "abc123def",
    })

    const executorSession = sessions.get("executor")
    expect(executorSession).toBeDefined()
    const messages = await executorSession!.getMessages()
    expect(messages.some(m => m.content.includes("当前策略配置允许你提交到仓库"))).toBe(true)
  })

  it("injects runtime commit policy prompt for unauthorized writable role", async () => {
    const projectDir = "/tmp/pee-unauthorized-prompt"
    const taskMap = new Map<string, any>([
      ["测试任务", {
        ID: 1,
        标题: "测试任务",
        任务描述: "验证未授权 writable 角色收到禁提提示",
        Tag: ["test"],
        是否完成: false,
        已删除: false,
        依赖: "[]",
        动态: [],
      }],
    ])

    const { sessions } = await runMainWithScript({
      projectDir,
      plannerResponses: [
        async () => JSON.stringify({ 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => "收到",
      ],
      executorResponses: [async () => "执行完成"],
      taskMap,
      getGitHead: async () => "abc123def",
    })

    const executorSession = sessions.get("executor")
    expect(executorSession).toBeDefined()
    const messages = await executorSession!.getMessages()
    expect(messages.some(m => m.content.includes("当前策略配置未授予你提交权限"))).toBe(true)
  })
})
