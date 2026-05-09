import { describe, expect, it } from "vitest"
import { AbortError, INTERRUPTION_REASON, MessageReceiveState, MSG_SOURCE, type InterruptedMsgContext } from "../../../common/types"
import { buildUpstreamForRole, enqueueRollbackInterruption, extractRejectionUpstream, planResumedValidation, takeLatestDispatchableInterruption, type RejectionState } from "../PEE.utils"

describe("PEE interruption and flow semantics", () => {
  const createInterrupt = (
    reason: InterruptedMsgContext["reason"],
    roleName: string,
    receivedMessage: string,
  ): InterruptedMsgContext => ({
    roleName,
    beforeMessage: "before",
    receivedMessage,
    timestamp: new Date(),
    reason,
  })

  it("uses evaluator rejection note as executor upstream during rejection loop", () => {
    const rejectionState: RejectionState = {
      evaluatorRejections: 1,
      architectRejections: 0,
      executorPractices: 1,
      totalRejectionLoops: 1,
      inRejectionLoop: true,
      rejectionSource: "evaluator",
    }
    const evaluatorResponse = JSON.stringify({
      检查结果: "打回",
      问题列表: ["变量命名不规范"],
      打回留言: "请修复变量命名问题",
    })

    const upstream = buildUpstreamForRole("executor", rejectionState, extractRejectionUpstream(evaluatorResponse))
    expect(upstream).toBe("请修复变量命名问题")
  })

  it("keeps first normal executor upstream free of rejection hint text", () => {
    const rejectionState: RejectionState = {
      evaluatorRejections: 0,
      architectRejections: 0,
      executorPractices: 0,
      totalRejectionLoops: 0,
      inRejectionLoop: false,
      frozenPlannerInfo: "本轮任务标题: 任务A\n留言: 正常推进\n",
    }

    expect(buildUpstreamForRole("executor", rejectionState, "ignored")).toBe("本轮任务标题: 任务A\n留言: 正常推进\n")
  })

  it("includes executor feedback in evaluator and architect upstream during rejection loop", () => {
    const rejectionState: RejectionState = {
      evaluatorRejections: 2,
      architectRejections: 1,
      executorPractices: 3,
      totalRejectionLoops: 3,
      inRejectionLoop: true,
      rejectionSource: "architect",
      executorFeedback: "已按领域边界拆分模块，测试仍待质保员补充。",
    }

    expect(buildUpstreamForRole("evaluator", rejectionState, "ignored")).toContain("评估者第2次打回")
    expect(buildUpstreamForRole("architect", rejectionState, "ignored")).toContain("架构师第1次打回")
    expect(buildUpstreamForRole("architect", rejectionState, "ignored")).toContain("执行反馈: 已按领域边界拆分模块，测试仍待质保员补充。")
    expect(buildUpstreamForRole("ScissorHands", rejectionState, "ignored")).toContain("执行者第3次实践")
  })

  it("prefers latest rollback/new_message/pause interruption over older events", () => {
    const queue = [
      createInterrupt(INTERRUPTION_REASON.pause, "planner", "旧暂停"),
      createInterrupt(INTERRUPTION_REASON.new_message, "executor", "新的引导"),
      createInterrupt(INTERRUPTION_REASON.rollback, "architect", "恢复后的回滚"),
    ]

    const chosen = takeLatestDispatchableInterruption(queue)
    expect(chosen?.roleName).toBe("architect")
    expect(chosen?.receivedMessage).toBe("恢复后的回滚")
  })

  it("ignores aborted interruption at dispatch stage until rollback is enqueued", () => {
    const queue = [createInterrupt(INTERRUPTION_REASON.aborted, "executor", "ESC")]
    expect(takeLatestDispatchableInterruption(queue)).toBeNull()
    expect(queue).toHaveLength(1)

    enqueueRollbackInterruption(queue, "executor", "上一次回复", "用户新的引导")
    const chosen = takeLatestDispatchableInterruption(queue)
    expect(chosen?.reason).toBe(INTERRUPTION_REASON.rollback)
    expect(chosen?.receivedMessage).toBe("用户新的引导")
  })

  it("preserves resumed user guidance when rollback is synthesized after abort", () => {
    const queue: InterruptedMsgContext[] = []
    const resumedResponse = "请不要继续重构，改为只补测试"
    enqueueRollbackInterruption(queue, "architect", "旧的架构建议", resumedResponse)

    expect(queue[0]?.beforeMessage).toBe("旧的架构建议")
    expect(queue[0]?.receivedMessage).toBe(resumedResponse)
  })

  it("plans resumed interruption by returning to the interrupted role for validation", () => {
    const resumedPlannerResponse = JSON.stringify({ 前情点评: "初始化阶段", 本轮任务标题: "任务A", 留言: "继续推进" })
    const plan = planResumedValidation("planner", resumedPlannerResponse)

    expect(plan).toEqual({
      currentRoleName: "planner",
      resumedResponse: resumedPlannerResponse,
    })
  })

  it("does not decide next role before resumed output validation", () => {
    const plan = planResumedValidation("planner", "恢复后的规划者输出")

    expect(plan.currentRoleName).toBe("planner")
    expect(Object.hasOwn(plan, "selectedNextRoleName")).toBe(false)
  })

  it("documents expected session semantics for abort then user resend", async () => {
    const fakeSession = {
      state: MessageReceiveState.WAITING_PROMPT_RESPONSE,
      lastSent: { msgSource: MSG_SOURCE.system, content: "执行任务A" },
      async sendMsg() {
        throw new AbortError()
      },
      async waitForUserMessage() {
        this.state = MessageReceiveState.EXPECTING_NEXT_MESSAGE
        return "用户改口：先修复测试"
      },
    }

    await expect(fakeSession.sendMsg()).rejects.toBeInstanceOf(AbortError)
    const resumed = await fakeSession.waitForUserMessage()
    expect(fakeSession.state).toBe(MessageReceiveState.EXPECTING_NEXT_MESSAGE)
    expect(resumed).toBe("用户改口：先修复测试")
  })
})
