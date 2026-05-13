import { describe, expect, it } from "vitest"
import { INTERRUPTION_REASON, type InterruptedMsgContext } from "../../../common/types"
import {
  buildCommonUpstreamFromTaskQuery,
  buildCommitmanUpstream,
  buildCompactorUpstream,
  buildMsgToBeSent,
  buildRejectionUpstream,
  buildRoundInfo,
  buildRoundInfoWithSparseScope,
  buildUpstreamForRole,
  createRejectionState,
  enqueueRollbackInterruption,
  extractFirstJSON,
  extractJSON,
  extractRejectionUpstream,
  getRejectionActivityToRecord,
  getDependencyDisplayName,
  isDispatchableInterruption,
  normalizeRoleName,
  planResumedValidation,
  resetRejectionState,
  shouldRoleInterveneThisRound,
  takeLatestDispatchableInterruption,
  validateDependencies,
  type RejectionState,
} from "../PEE.utils"
import {
  规划者,
  压缩决策员,
  注释与文档对齐员,
  执行者,
  评估者,
  冗余枝剪者,
  局部整体性架构师,
  框架性架构师,
  质保员,
  边缘质保员,
  提交员,
} from "../规划图驱动的PEE"

describe("PEE utils", () => {
  describe("extractJSON", () => {
    it("parses plain JSON", () => {
      expect(extractJSON('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" })
    })

    it("parses markdown wrapped JSON", () => {
      expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    })

    it("parses first balanced JSON from noisy text", () => {
      expect(extractJSON('好的，结果是{"检查结果":"打回","问题列表":["请修复"]}，请确认')).toEqual({ 检查结果: "打回", 问题列表: ["请修复"] })
    })

    it("returns null for non JSON text", () => {
      expect(extractJSON("plain text")).toBeNull()
      expect(extractFirstJSON("plain text")).toBeNull()
    })
  })

  describe("upstream builders", () => {
    it("creates and resets rejection state consistently", () => {
      const state = createRejectionState()
      expect(state).toEqual({
        evaluatorRejections: 0,
        localArchitectRejections: 0,
        frameworkArchitectRejections: 0,
        executorPractices: 0,
        totalRejectionLoops: 0,
        inRejectionLoop: false,
      })

      state.evaluatorRejections = 2
      state.localArchitectRejections = 1
      state.frameworkArchitectRejections = 1
      state.executorPractices = 4
      state.totalRejectionLoops = 3
      state.inRejectionLoop = true
      state.rejectionSource = "框架性架构师"
      state.frozenPlannerInfo = "frozen"
      state.compactorUpstream = "compact"
      state.executorFeedback = "已修复命名问题"
      state.previousPlannerInfo = "本轮任务标题: 旧任务\nTag: ARCH\n描述: 旧任务描述\n"

      resetRejectionState(state)
      expect(state).toEqual({
        evaluatorRejections: 0,
        localArchitectRejections: 0,
        frameworkArchitectRejections: 0,
        executorPractices: 0,
        totalRejectionLoops: 0,
        inRejectionLoop: false,
        rejectionSource: undefined,
        executorFeedback: undefined,
        frozenPlannerInfo: undefined,
        compactorUpstream: undefined,
        previousPlannerInfo: undefined,
      })
    })

    it("builds rejection upstream with per-role counters", () => {
      const state: RejectionState = {
        evaluatorRejections: 2,
        localArchitectRejections: 1,
        frameworkArchitectRejections: 1,
        executorPractices: 5,
        totalRejectionLoops: 3,
        inRejectionLoop: true,
        executorFeedback: "已补齐边缘测试，暂无已知遗留风险。",
      }
      expect(buildRejectionUpstream(state)).toBe("正在协作优化中  执行反馈: 已补齐边缘测试，暂无已知遗留风险。  评估者第2次打回  局部整体性架构师第1次打回  框架性架构师第1次打回  执行者第5次实践")
    })

    it("builds compactor upstream with previous and current task snapshots", () => {
      const upstream = buildCompactorUpstream(
        [
          "本轮任务标题: 实现登录功能",
          "描述: 登录描述，补充更多上下文以验证长度截断逻辑不会影响短描述",
          "Tag: FEAT, AUTH",
        ].join("\n"),
        [
          "本轮任务标题: 数据库设计",
          "描述: 设计用户表和会话表，保证登录链路可落地",
          "Tag: ARCH, DB",
        ].join("\n"),
      )

      expect(upstream).toContain("上轮任务标题: 数据库设计")
      expect(upstream).toContain("上轮任务Tag: ARCH, DB")
      expect(upstream).not.toContain("上轮任务描述")
      expect(upstream).toContain("本轮任务标题: 实现登录功能")
      expect(upstream).toContain("本轮任务Tag: FEAT, AUTH")
      expect(upstream).toContain("本轮任务描述: 登录描述，补充更多上下文以验证长度截断逻辑不会影响短描述")
    })

    it("truncates long descriptions at 80 chars with fold suffix", () => {
      const longDesc = "a".repeat(100)
      const upstream = buildCompactorUpstream(
        [
          "本轮任务标题: 长任务",
          `描述: ${longDesc}`,
          "Tag: FEAT",
        ].join("\n"),
        [
          "本轮任务标题: 上一任务",
          `描述: ${longDesc}`,
          "Tag: ARCH",
        ].join("\n"),
      )

      // 本轮任务：80 chars + fold suffix
      expect(upstream).toContain(`本轮任务描述: ${"a".repeat(80)}....（折叠20字）`)
      // 上轮任务：无描述
      expect(upstream).not.toContain("上轮任务描述")
    })

    it("builds common upstream from real task query shape with all first-layer dependencies only", () => {
      const upstream = buildCommonUpstreamFromTaskQuery(
        {
          本轮任务标题: "实现登录功能",
          留言: "请注意测试覆盖",
        },
        {
          任务描述: "实现用户名密码登录",
          Tag: ["FEAT", "核心功能"],
          动态: [
            { 角色: "执行者", 消息: "已实现登录" },
            { 角色: "评估者", 消息: "发现边界问题" },
          ],
        },
        [
          {
            层: 1,
            依赖: [
              {
                标题: "数据库设计",
                Tag: ["ARCH"],
                动态: [{ 角色: "局部整体性架构师", 消息: "表结构已完成" }],
              },
              {
                标题: "鉴权约定",
                Tag: ["API"],
                动态: [{ 角色: "规划者", 消息: "接口约定已确认" }],
              },
            ],
          },
          {
            层: 2,
            依赖: [
              {
                标题: "不应出现的二层依赖",
                Tag: ["OLD"],
                动态: [{ 角色: "规划者", 消息: "旧动态" }],
              },
            ],
          },
        ],
      )

      expect(upstream).toContain("本轮任务标题: 实现登录功能")
      expect(upstream).toContain("描述: 实现用户名密码登录")
      expect(upstream).toContain("Tag: FEAT, 核心功能")
      expect(upstream).toContain("上层依赖任务：")
        expect(upstream).toContain("数据库设计")
        expect(upstream).toContain("  Tag: ARCH")
        expect(upstream).toContain("[局部整体性架构师: 表结构已完成]")
        expect(upstream).toContain("鉴权约定")
        expect(upstream).toContain("  Tag: API")
        expect(upstream).toContain("[规划者: 接口约定已确认]")
        expect(upstream).toContain("当前任务动态：")
        expect(upstream).toContain("[执行者: 已实现登录]")
        expect(upstream).toContain("留言: 请注意测试覆盖")
        expect(upstream.match(/留言: 请注意测试覆盖/g)?.length).toBe(1)
        expect(upstream).not.toContain("不应出现的二层依赖")
    })

    it("falls back to no dependency section when first layer is missing", () => {
      const upstream = buildCommonUpstreamFromTaskQuery(
        { 本轮任务标题: "任务A", 留言: "保留留言" },
        { 任务描述: "描述" },
        [],
      )

      expect(upstream).toContain("上层依赖任务: 无")
      expect(upstream).toContain("留言: 保留留言")
    })

    it("builds commitman upstream from current task section only", () => {
      const upstream = buildCommitmanUpstream(
        [
          "本轮任务标题: 实现登录功能",
          "描述: 实现用户名密码登录",
          "Tag: FEAT, 核心功能",
          "",
          "上层依赖任务：",
          "数据库设计",
          "  Tag: ARCH",
        ].join("\n"),
      )

      expect(upstream).toBe("标题: 实现登录功能\nTag: FEAT, 核心功能\n")
      expect(upstream).not.toContain("ARCH")
    })

    it("extracts full rejection json for executor upstream", () => {
      expect(
        extractRejectionUpstream(
          JSON.stringify({ 检查结果: "打回", 问题列表: ["问题"] }),
        ),
      ).toBe(JSON.stringify({ 检查结果: "打回", 问题列表: ["问题"] }))

      expect(extractRejectionUpstream("纯文本留言")).toBe("纯文本留言")
    })

    it("routes upstream by role using real helper semantics", () => {
      const state: RejectionState = {
        evaluatorRejections: 1,
        localArchitectRejections: 0,
        frameworkArchitectRejections: 0,
        executorPractices: 1,
        totalRejectionLoops: 1,
        inRejectionLoop: true,
        rejectionSource: "评估者",
        executorFeedback: "已按评估者意见修复变量命名",
        frozenPlannerInfo: "本轮任务标题: 任务A\nTag: FEAT\n",
        compactorUpstream: "上轮任务标题: 任务Z\n上轮任务Tag: OLD\n本轮任务标题: 任务A\n本轮任务Tag: FEAT\n",
      }

      expect(buildUpstreamForRole("执行者", state, '{"检查结果":"打回","问题列表":["请修复变量命名"]}')).toBe('{"检查结果":"打回","问题列表":["请修复变量命名"]}')
      expect(buildUpstreamForRole("评估者", state, "ignored")).toContain("评估者第1次打回")
      expect(buildUpstreamForRole("评估者", state, "ignored")).toContain("执行反馈: 已按评估者意见修复变量命名")

      state.inRejectionLoop = false
      expect(buildUpstreamForRole("规划者", state, "ignored")).toBe("")
      expect(buildUpstreamForRole("压缩决策员", state, "ignored")).toBe(state.compactorUpstream)
      expect(buildUpstreamForRole("提交员", state, "ignored")).toContain("标题: 任务A")
      expect(buildUpstreamForRole("质保员", state, "ignored")).toBe(state.frozenPlannerInfo)
    })

    it("derives rejection activity after counters have been updated", () => {
      const state: RejectionState = {
        evaluatorRejections: 1,
        localArchitectRejections: 0,
        frameworkArchitectRejections: 0,
        executorPractices: 1,
        totalRejectionLoops: 1,
        inRejectionLoop: true,
        rejectionSource: "评估者",
      }

      expect(
        getRejectionActivityToRecord(
          "评估者",
          JSON.stringify({ 检查结果: "打回", 问题列表: ["问题"] }),
          state,
        ),
      ).toEqual({ roleName: "评估者", rejectionCount: 1 })

      expect(
        getRejectionActivityToRecord(
          "局部整体性架构师",
          JSON.stringify({ 检查结果: "打回", 架构问题: ["问题"], 重构建议: "建议" }),
          { ...state, localArchitectRejections: 2, rejectionSource: "局部整体性架构师" },
        ),
        ).toEqual({ roleName: "局部整体性架构师", rejectionCount: 2 })

      expect(
        getRejectionActivityToRecord(
          "框架性架构师",
          JSON.stringify({ 检查结果: "打回", 框架问题: ["问题"], 重构建议: "建议" }),
          { ...state, frameworkArchitectRejections: 3, rejectionSource: "框架性架构师" },
        ),
      ).toEqual({ roleName: "框架性架构师", rejectionCount: 3 })

      expect(getRejectionActivityToRecord("执行者", "plain text", state)).toBeNull()
      expect(
        getRejectionActivityToRecord(
          "评估者",
          JSON.stringify({ 检查结果: "通过", 问题列表: [] }),
          state,
        ),
      ).toBeNull()
    })

    it("falls back to last response when no frozen upstream is available", () => {
      const state = createRejectionState()
      expect(buildUpstreamForRole("执行者", state, "上一个角色输出")).toBe("上一个角色输出")
    })
  })

  describe("role schemas", () => {
    it("validates planner schema", () => {
      const role = new 规划者()
      expect(role.validateOutput(JSON.stringify({ 本轮任务标题: "b", 留言: "c" }))).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 留言: "c" })).valid).toBe(false)
    })

    it("validates executor as non-empty text", () => {
      const role = new 执行者()
      expect(role.validateOutput("done")).toEqual({ valid: true })
      expect(role.validateOutput("   ").valid).toBe(false)
    })

    it("validates evaluator schema", () => {
      const role = new 评估者()
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 问题列表: [] }))).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 检查结果: "未知", 问题列表: [] })).valid).toBe(false)
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 问题列表: ["仍有问题"] }))).toEqual({
        valid: false,
        error: "问题列表不为空，检查结果却为通过，这是矛盾的，请重试",
      })
    })

    it("validates 局部整体性架构师 schema", () => {
      const role = new 局部整体性架构师()
      expect(
        role.validateOutput(JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "" })),
      ).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 架构问题: "bad", 重构建议: "x" })).valid).toBe(false)
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 架构问题: ["分层不清"], 重构建议: "" }))).toEqual({
        valid: false,
        error: "架构问题不为空，或存在重构建议，检查结果却为通过，这是矛盾的，请重试",
      })
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 架构问题: [], 重构建议: "建议分层" })).valid).toBe(false)
    })

    it("validates 框架性架构师 schema", () => {
      const role = new 框架性架构师()
      expect(
        role.validateOutput(JSON.stringify({ 检查结果: "通过", 框架问题: [], 重构建议: "" })),
      ).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 框架问题: "bad", 重构建议: "x" })).valid).toBe(false)
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 框架问题: ["模块边界不清"], 重构建议: "" }))).toEqual({
        valid: false,
        error: "框架问题不为空，或存在重构建议，检查结果却为通过，这是矛盾的，请重试",
      })
      expect(role.validateOutput(JSON.stringify({ 检查结果: "通过", 框架问题: [], 重构建议: "建议重新分层" })).valid).toBe(false)
    })

    it("validates compactor schema", () => {
      const role = new 压缩决策员()
      expect(role.validateOutput(JSON.stringify({ 是否压缩: false }))).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 是否压缩: true }))).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 是否压缩: "false" })).valid).toBe(false)
    })

    it("validates fixer-style activity schema across 注释与文档对齐员 冗余枝剪者 质保员 and 边缘质保员", () => {
      const valid = JSON.stringify({ 一句话动态: "检查无问题" })
      const invalid = JSON.stringify({ 一句话动态: "   " })

      for (const role of [new 注释与文档对齐员(), new 冗余枝剪者(), new 质保员(), new 边缘质保员()]) {
        expect(role.validateOutput(valid)).toEqual({ valid: true })
        expect(role.validateOutput(invalid).valid).toBe(false)
      }
    })

    it("validates commitman schema", () => {
      const role = new 提交员()
      expect(role.validateOutput(JSON.stringify({ 一句话动态: "已提交，git哈希: abc123" }))).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 一句话动态: "无提交，原因: 工作区无变化" }))).toEqual({ valid: true })
      expect(role.validateOutput(JSON.stringify({ 一句话动态: "提交完成" })).valid).toBe(false)
    })
  })

  describe("dependency validation", () => {
    it("passes when all direct dependencies are completed", () => {
      const result = validateDependencies(
        "当前任务",
        [{ 依赖任务ID: 3, 原因: "依赖" }],
        (key) => (key === "id:3" ? { 是否完成: true } : undefined),
      )
      expect(result.valid).toBe(true)
    })

    it("fails on malformed, missing, deleted and incomplete dependencies", () => {
      expect(validateDependencies("当前任务", [{ 原因: "坏数据" }], () => undefined).valid).toBe(false)
      expect(validateDependencies("当前任务", [{ 原因: "缺失ID" }], () => undefined).error).toContain("缺少\"依赖任务ID\"")
      expect(validateDependencies("当前任务", [{ 依赖任务ID: 1 }], () => undefined).error).toContain("不存在")
      expect(
        validateDependencies("当前任务", [{ 依赖任务ID: 2 }], () => ({ 已删除: true, 是否完成: true })).error,
      ).toContain("已被删除")
      expect(
        validateDependencies("当前任务", [{ 依赖任务ID: 3 }], () => ({ 是否完成: false })).error,
        ).toContain("未完成")
    })

    it("builds dependency display name from resolved title and id", () => {
      expect(getDependencyDisplayName({ 依赖任务ID: 3 }, "回查标题")).toBe("回查标题")
      expect(getDependencyDisplayName({ 依赖任务ID: 7 })).toBe("ID:7")
    })
  })

  describe("message envelope", () => {
    it("always prefixes roundInfo", () => {
      const roundInfo = buildRoundInfo(1, 3)
      const withKnowledge = buildMsgToBeSent(roundInfo, "你是执行者", (upstream) => `执行: ${upstream}`, "任务A", true)
      const withoutKnowledge = buildMsgToBeSent(roundInfo, "ignored", (upstream) => `执行: ${upstream}`, "任务A", false)

      expect(withKnowledge.startsWith(roundInfo)).toBe(true)
      expect(withKnowledge).toContain("你是执行者")
      expect(withoutKnowledge.startsWith(roundInfo)).toBe(true)
      expect(withoutKnowledge).not.toContain("ignored")
    })

    it("can inject executor rejection hint right after roundInfo", () => {
      const roundInfo = buildRoundInfo(1, 3)
      const hint = "检查是的确存在的问题还是瞎说。\n\n"
      const message = buildMsgToBeSent(
        roundInfo,
        "你是执行者",
        (upstream) => `执行: ${upstream}`,
        "请修复变量命名问题",
        false,
        hint,
      )

      expect(message.startsWith(roundInfo + hint)).toBe(true)
      expect(message).toContain("执行: 请修复变量命名问题")
    })

    it("adds sparse task scope into roundInfo for non-core roles", () => {
      const roundInfo = buildRoundInfoWithSparseScope(1, 4, "局部整体性架构师", 2, [
        { 任务标题: "任务A", 一句话动态: "已提交，git哈希: abc123" },
        { 任务标题: "任务B", 一句话动态: "无提交，原因: 测试" },
      ])

      expect(roundInfo).toContain("第2轮/共4轮")
      expect(roundInfo).toContain("下面这些任务是自你上次介入以来新增的，请重点检查它们")
      expect(roundInfo).toContain("任务A: 已提交，git哈希: abc123")
      expect(roundInfo).toContain("任务B: 无提交，原因: 测试")
    })

    it("keeps duplicate task titles in sparse scope", () => {
      const roundInfo = buildRoundInfoWithSparseScope(2, 4, "局部整体性架构师", 3, [
        { 任务标题: "同名任务", 一句话动态: "无提交，原因: 第1轮" },
        { 任务标题: "同名任务", 一句话动态: "无提交，原因: 第2轮" },
      ])

      expect(roundInfo).toContain("同名任务: 无提交，原因: 第1轮")
      expect(roundInfo).toContain("同名任务: 无提交，原因: 第2轮")
    })

    it("keeps core roles dense without sparse scope", () => {
      expect(buildRoundInfoWithSparseScope(0, 4, "规划者", 0, [])).toContain("第1轮/共4轮")
      expect(buildRoundInfoWithSparseScope(0, 4, "规划者", 0, [])).not.toContain("稀疏介入角色")
    })

    it("uses prompt-like wording when sparse scope is empty", () => {
      const roundInfo = buildRoundInfoWithSparseScope(0, 4, "局部整体性架构师", 2, [])

      expect(roundInfo).toContain("自你上次介入以来，暂无新增任务")
      expect(roundInfo).not.toContain("本角色为稀疏介入角色")
    })
  })

  describe("sparse role scheduling", () => {
    it("keeps core dense, supports first-intervention offsets, and waits full gaps", () => {
      expect(shouldRoleInterveneThisRound(0, 0)).toBe(true)
      expect(shouldRoleInterveneThisRound(2, 0)).toBe(true)
      expect(shouldRoleInterveneThisRound(2, 1)).toBe(false)
      expect(shouldRoleInterveneThisRound(2, 2)).toBe(false)
      expect(shouldRoleInterveneThisRound(2, 3)).toBe(true)
      expect(shouldRoleInterveneThisRound(3, 0, 2)).toBe(false)
      expect(shouldRoleInterveneThisRound(3, 1, 2)).toBe(false)
      expect(shouldRoleInterveneThisRound(3, 2, 2)).toBe(true)
      expect(shouldRoleInterveneThisRound(3, 5, 2)).toBe(false)
      expect(shouldRoleInterveneThisRound(3, 6, 2)).toBe(true)
      // 【设计阐述】介入偏移为3时，前三轮跳过，第四轮首次介入
      expect(shouldRoleInterveneThisRound(2, 0, 3)).toBe(false)
      expect(shouldRoleInterveneThisRound(2, 1, 3)).toBe(false)
      expect(shouldRoleInterveneThisRound(2, 2, 3)).toBe(false)
      expect(shouldRoleInterveneThisRound(2, 3, 3)).toBe(true)
      expect(shouldRoleInterveneThisRound(2, 4, 3)).toBe(false)
      expect(shouldRoleInterveneThisRound(2, 5, 3)).toBe(false)
      expect(shouldRoleInterveneThisRound(2, 6, 3)).toBe(true)
      expect(() => shouldRoleInterveneThisRound(2, 0, -1)).toThrow("介入偏移必须是非负整数")
    })

    it("configures role intervention offsets explicitly", () => {
      expect(new 注释与文档对齐员().介入偏移).toBe(2)
      expect(new 局部整体性架构师().介入偏移).toBe(2)
      expect(new 冗余枝剪者().介入偏移).toBe(2)
      expect(new 边缘质保员().介入偏移).toBe(1)
      expect(new 规划者().介入偏移).toBe(0)
      expect(new 压缩决策员().介入偏移).toBe(0)
      expect(new 执行者().介入偏移).toBe(0)
      expect(new 评估者().介入偏移).toBe(0)
      expect(new 质保员().介入偏移).toBe(0)
      expect(new 提交员().介入偏移).toBe(0)
    })
  })

  describe("interruption queue", () => {
    const makeInterrupt = (reason: InterruptedMsgContext["reason"], roleName: string): InterruptedMsgContext => ({
      roleName,
      beforeMessage: "before",
      receivedMessage: `${roleName}-${reason}`,
      timestamp: new Date(),
      reason,
    })

    it("recognizes dispatchable interruption reasons", () => {
      expect(isDispatchableInterruption(INTERRUPTION_REASON.pause)).toBe(true)
      expect(isDispatchableInterruption(INTERRUPTION_REASON.new_message)).toBe(true)
      expect(isDispatchableInterruption(INTERRUPTION_REASON.rollback)).toBe(true)
      expect(isDispatchableInterruption(INTERRUPTION_REASON.aborted)).toBe(false)
    })

    it("takes latest dispatchable interruption and clears queue", () => {
      const queue = [
        makeInterrupt(INTERRUPTION_REASON.aborted, "规划者"),
        makeInterrupt(INTERRUPTION_REASON.pause, "执行者"),
        makeInterrupt(INTERRUPTION_REASON.rollback, "评估者"),
      ]

      const latest = takeLatestDispatchableInterruption(queue)
      expect(latest?.roleName).toBe("评估者")
      expect(latest?.reason).toBe(INTERRUPTION_REASON.rollback)
      expect(queue).toHaveLength(0)
    })

    it("enqueues rollback only once after resumed user message", () => {
      const queue: InterruptedMsgContext[] = []
      enqueueRollbackInterruption(queue, "执行者", "旧回复", "新的用户引导", new Date("2026-05-08T10:00:00.000Z"))
      enqueueRollbackInterruption(queue, "执行者", "旧回复", "另一条引导", new Date("2026-05-08T10:01:00.000Z"))

      expect(queue).toHaveLength(1)
      expect(queue[0]).toMatchObject({
        roleName: "执行者",
        beforeMessage: "旧回复",
        receivedMessage: "新的用户引导",
        reason: INTERRUPTION_REASON.rollback,
      })
    })

    it("keeps resumed interruption scoped to validation before dispatch selection", () => {
      const plan = planResumedValidation("规划者", "恢复后的规划者输出")

      expect(plan).toEqual({
        currentRoleName: "规划者",
        resumedResponse: "恢复后的规划者输出",
      })
      expect(Object.hasOwn(plan, "selectedNextRoleName")).toBe(false)
    })
  })

  describe("misc", () => {
    it("normalizes activity role names", () => {
      expect(normalizeRoleName("冗余枝剪者")).toBe("冗余枝剪者")
      expect(normalizeRoleName("质保员")).toBe("质保员")
      expect(normalizeRoleName("边缘质保员")).toBe("边缘质保员")
      expect(normalizeRoleName("执行者")).toBe("执行者")
    })
  })
})
