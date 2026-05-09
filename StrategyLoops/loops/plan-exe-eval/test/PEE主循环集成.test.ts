import { describe, expect, it, vi } from "vitest"
import { mkdir, writeFile } from "fs/promises"
import { AbortError, INTERRUPTION_REASON, MSG_SOURCE, type InterruptedMsgContext, type SessionMessage } from "../../../common/types"
import type { IRole } from "../../../common/role"
import type { ISession } from "../../../common/session"
import { LoopConfig } from "../../../common/loopConfig"
import { main } from "../规划图驱动的PEE"

class ScriptedSession implements ISession {
  id: string
  role: IRole
  directory: string
  private messages: SessionMessage[] = []
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

  async sendMsg(message: SessionMessage): Promise<string> {
    this.messages.push(message)
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
        role.name === "evaluator" ? (options.evaluatorResponses ?? [async () => JSON.stringify({ 检查结果: "通过", 问题列表: [], 打回留言: "" })]) :
        role.name === "scissorHands" ? (options.scissorResponses ?? [async () => JSON.stringify({ 一句话动态: "检查无问题" })]) :
        role.name === "architect" ? (options.architectResponses ?? [async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "", 打回留言: "" })]) :
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
      loopConfig: new LoopConfig({ maxCycles: 1, startPrompt: "test-start" }),
      askUser: vi.fn(async () => options.askUserResponse ?? ""),
      runScheduleMapCli,
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
        async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "请执行并补测试" }),
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
    const edgeSession = sessions.get("edgeQA")
    expect(executorSession).toBeDefined()
    expect(edgeSession).toBeDefined()
    const executorMessages = await executorSession!.getMessages()
    const edgeMessages = await edgeSession!.getMessages()
    expect(executorMessages.some((message) => message.msgSource === MSG_SOURCE.system)).toBe(true)
    expect(edgeMessages.some((message) => message.msgSource === MSG_SOURCE.system)).toBe(true)
    expect(relocateRole).toHaveBeenCalledTimes(1)
    expect(activities.some((activity) => activity.角色 === "edgeQA")).toBe(true)
    expect(activities.some((activity) => activity.角色 === "commitman")).toBe(true)
  })

  it("records evaluator rejection and routes executor through rejection loop with extracted note", async () => {
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
        async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "先修评估问题" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      executorResponses: [
        async () => "第一次实现",
        async () => "已按评估者意见补充边缘测试，暂无已知遗留风险。",
      ],
      evaluatorResponses: [
        async () => JSON.stringify({ 检查结果: "打回", 问题列表: ["缺测试"], 打回留言: "请补边缘测试" }),
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [], 打回留言: "" }),
      ],
      taskMap,
    })

    const executorSession = sessions.get("executor")
    const evaluatorSession = sessions.get("evaluator")
    expect(executorSession).toBeDefined()
    expect(evaluatorSession).toBeDefined()
    const executorMessages = await executorSession!.getMessages()
    const evaluatorMessages = await evaluatorSession!.getMessages()
    expect(executorMessages.some((message) => message.content.includes("请补边缘测试"))).toBe(true)
    expect(evaluatorMessages.some((message) => message.content.includes("评估者第1次打回"))).toBe(true)
    expect(evaluatorMessages.some((message) => message.content.includes("执行反馈: 已按评估者意见补充边缘测试，暂无已知遗留风险。"))).toBe(true)
    expect(activities.some((activity) => activity.角色 === "evaluator" && activity.消息 === "evaluator打回1次")).toBe(true)
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
      plannerResponses: [
        async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "关注架构一致性" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      executorResponses: [
        async () => "第一次实现",
        async () => "已按架构建议重新分层，暂无已知遗留风险。",
      ],
      evaluatorResponses: [
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [], 打回留言: "" }),
        async () => JSON.stringify({ 检查结果: "通过", 问题列表: [], 打回留言: "" }),
      ],
      architectResponses: [
        async () => JSON.stringify({ 检查结果: "打回", 架构问题: ["分层不清晰"], 重构建议: "按领域拆分", 打回留言: "请按领域重新分层" }),
        async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "", 打回留言: "" }),
      ],
      scissorResponses: [
        async () => JSON.stringify({ 一句话动态: "检查无问题" }),
        async () => JSON.stringify({ 一句话动态: "检查无问题" }),
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
    expect(executorMessages.some((message) => message.content.includes("请按领域重新分层"))).toBe(true)
    expect(evaluatorMessages.some((message) => message.content.includes("执行反馈: 已按架构建议重新分层，暂无已知遗留风险。"))).toBe(true)
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
      interruptMessage: JSON.stringify({ 前情点评: "恢复后重派", 本轮任务标题: "测试任务", 留言: "先验证任务合法性" }),
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
      plannerResponses: [
        async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "触发QA动态落库失败" }),
      ],
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
      plannerResponses: [async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "不会执行到这里" })],
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
      plannerResponses: Array.from({ length: 12 }, () => async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "查询会失败" })),
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
        async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "执行测试" }),
        async () => JSON.stringify({ 前情点评: "收到通知", 本轮任务标题: "测试任务", 留言: "已了解" }), // exhaustion通知的响应
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
        async () => JSON.stringify({ 前情点评: "暂无", 本轮任务标题: "测试任务", 留言: "第1轮" }),
        async () => JSON.stringify({ 前情点评: "收到", 本轮任务标题: "测试任务", 留言: "exhaustion通知" }), // notification cycle response
        async () => JSON.stringify({ 前情点评: "继续", 本轮任务标题: "测试任务", 留言: "第3轮" }),
        async () => "<整个项目已全部提前完成>",
        async () => "是的",
      ],
      compactorResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 是否压缩: false })),
      executorResponses: Array.from({ length: 6 }, () => async () => "执行完成"),
      evaluatorResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 检查结果: "通过", 问题列表: [], 打回留言: "" })),
      scissorResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 一句话动态: "无提交，原因: 测试" })),
      architectResponses: Array.from({ length: 6 }, () => async () => JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "", 打回留言: "" })),
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
})
