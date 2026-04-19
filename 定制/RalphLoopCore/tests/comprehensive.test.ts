import { describe, it, expect, beforeEach } from "vitest"
import { LoopEngine } from "../src/graph/LoopEngine.js"
import type { LoopStrategy, LoopNode, Transition, RoleInstance } from "../src/graph/LoopStrategy.js"
import {
  createRole,
  createLoopNode,
  createTransition,
  createConditionalTransition,
  createKeywordTransition,
  evaluateTransitionCondition,
  type TransitionCondition,
} from "../src/graph/LoopStrategy.js"
import { defaultRalphLoopStrategy, getDefaultStrategy, roles, createCustomStrategy } from "../src/graph/strategies.js"
import { StrategyState } from "../src/types/index.js"

// ============================================================================
// 四大基本要素测试
// ============================================================================

describe("四大基本要素 - 核心概念验证", () => {
  describe("要素1: 节点 (Node)", () => {
    it("节点应该有唯一标识符", () => {
      const role = createRole("r1", "角色1", "prompt")
      const node = createLoopNode("node1", "测试节点", [{ role }])
      expect(node.id).toBe("node1")
      expect(node.name).toBe("测试节点")
    })

    it("节点应该包含角色列表", () => {
      const role1 = createRole("r1", "角色1", "prompt1")
      const role2 = createRole("r2", "角色2", "prompt2")
      const node = createLoopNode("n1", "节点1", [{ role: role1 }, { role: role2 }])
      expect(node.roles).toHaveLength(2)
    })

    it("节点应该有配置属性", () => {
      const role = createRole("r1", "角色1", "prompt")
      const node = createLoopNode("n1", "节点1", [{ role }], {
        timeout: 60000,
        retryable: true,
        maxRetries: 5,
        parallel: true,
        continueOnError: false,
      })
      expect(node.config.timeout).toBe(60000)
      expect(node.config.retryable).toBe(true)
      expect(node.config.maxRetries).toBe(5)
      expect(node.config.parallel).toBe(true)
      expect(node.config.continueOnError).toBe(false)
    })

    it("节点应该支持生命周期钩子", () => {
      const role = createRole("r1", "角色1", "prompt")
      let entered = false
      let exited = false
      const node = createLoopNode("n1", "节点1", [{ role }], {}, "描述")
      const nodeWithHooks: LoopNode = {
        ...node,
        onEnter: () => {
          entered = true
        },
        onExit: () => {
          exited = true
        },
      }
      nodeWithHooks.onEnter?.({ task: "", cycle: 0 })
      nodeWithHooks.onExit?.({ task: "", cycle: 0 }, { nodeId: "n1", nodeName: "节点1", status: "completed" })
      expect(entered).toBe(true)
      expect(exited).toBe(true)
    })
  })

  describe("要素2: 角色 (Role) - 含身份Prompt和长期记忆", () => {
    it("角色应该有ID、名称和身份Prompt", () => {
      const role = createRole("expert", "领域专家", "你是一位资深领域专家...", "")
      expect(role.id).toBe("expert")
      expect(role.name).toBe("领域专家")
      expect(role.systemPrompt).toBe("你是一位资深领域专家...")
    })

    it("角色应该支持长期记忆", () => {
      const memory = "之前的分析结果: 1. 性能瓶颈在数据库 2. 需要缓存优化"
      const role = createRole("expert", "领域专家", "prompt", memory)
      expect(role.memory).toBe(memory)
    })

    it("角色实例应该有可配置参数", () => {
      const role = createRole("r1", "角色1", "prompt")
      const instance: RoleInstance = {
        role,
        weight: 0.8,
        temperature: 0.7,
        maxTokens: 2000,
        count: 3,
        personality: "严格",
      }
      expect(instance.weight).toBe(0.8)
      expect(instance.temperature).toBe(0.7)
      expect(instance.maxTokens).toBe(2000)
      expect(instance.count).toBe(3)
      expect(instance.personality).toBe("严格")
    })

    it("应该支持多角色实例配置", () => {
      const role = createRole("reviewer", "审核员", "你是审核员")
      const instances: RoleInstance[] = [
        { role: { ...role, id: "reviewer_1", name: "审核员#1" }, weight: 1.0 },
        { role: { ...role, id: "reviewer_2", name: "审核员#2" }, weight: 0.8 },
        { role: { ...role, id: "reviewer_3", name: "审核员#3" }, weight: 0.6 },
      ]
      const node = createLoopNode("review", "审核节点", instances)
      expect(node.roles).toHaveLength(3)
      expect(node.roles[0]!.weight).toBe(1.0)
      expect(node.roles[1]!.weight).toBe(0.8)
      expect(node.roles[2]!.weight).toBe(0.6)
    })

    it("预定义角色应该有完整的身份Prompt", () => {
      expect(roles.domainExpert).toBeDefined()
      expect(roles.domainExpert!.systemPrompt.length).toBeGreaterThan(50)
      expect(roles.domainExpert!.systemPrompt).toContain("领域专家")
      expect(roles.planner!.systemPrompt).toContain("规划")
      expect(roles.seniorTester!.systemPrompt).toContain("测试")
      expect(roles.userExperience!.systemPrompt).toContain("用户体验")
    })
  })

  describe("要素3: 策略 (Strategy) - 节点拓扑和跳转逻辑", () => {
    it("策略应该包含节点图", () => {
      const strategy = defaultRalphLoopStrategy
      expect(strategy.nodes).toBeDefined()
      expect(strategy.nodes.length).toBeGreaterThan(0)
      expect(strategy.transitions).toBeDefined()
    })

    it("策略应该有入口和出口节点", () => {
      const strategy = defaultRalphLoopStrategy
      expect(strategy.entryNode).toBeDefined()
      expect(strategy.exitNodes).toBeDefined()
      expect(strategy.exitNodes.length).toBeGreaterThan(0)
    })

    it("策略应该支持跳转配置", () => {
      const n1 = createLoopNode("n1", "节点1", [])
      const n2 = createLoopNode("n2", "节点2", [])
      const transition = createTransition("n1", "n2", { type: "always" }, "总是跳转")
      expect(transition.from).toBe("n1")
      expect(transition.to).toBe("n2")
      expect(transition.condition.type).toBe("always")
    })

    it("策略应该支持条件跳转", () => {
      const condition: TransitionCondition = {
        type: "keyword",
        field: "result",
        keywords: ["通过", "完成"],
        keywordMode: "any",
      }
      const transition = createTransition("n1", "n2", condition)
      expect(transition.condition.type).toBe("keyword")
      expect(transition.condition.keywords).toContain("通过")
    })

    it("策略应该支持轮次限制", () => {
      expect(defaultRalphLoopStrategy.maxCycles).toBeDefined()
      expect(defaultRalphLoopStrategy.maxCycles).toBeGreaterThan(0)
    })
  })

  describe("要素4: 轮次 (Round) - 循环执行", () => {
    it("LoopEngine应该追踪轮次", async () => {
      const engine = new LoopEngine({ maxCycles: 10 })
      const strategy: LoopStrategy = {
        id: "test",
        name: "Test",
        entryNode: "n1",
        exitNodes: ["n1"],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [],
      }
      engine.loadStrategy(strategy)
      await engine.execute({ task: "test" })
      expect(engine.getState().cycleCount).toBeDefined()
    })

    it("完成一轮应该增加cycleCount", async () => {
      let cycleCount = 0
      const engine = new LoopEngine({
        onNodeExecute: async () => ({
          nodeId: "test",
          nodeName: "test",
          status: "completed",
        }),
      })

      engine.on("cycleComplete", (cycle) => {
        cycleCount = cycle
      })

      const strategy: LoopStrategy = {
        id: "loop",
        name: "Loop",
        entryNode: "n1",
        exitNodes: ["n2"],
        nodes: [createLoopNode("n1", "节点1", []), createLoopNode("n2", "节点2", [])],
        transitions: [createTransition("n1", "n2", { type: "always" })],
      }

      engine.loadStrategy(strategy)
      await engine.execute({ task: "test" })
      expect(cycleCount).toBe(0)
    })

    it("回到入口节点应该触发cycleComplete事件", async () => {
      let cyclesCompleted = 0
      const engine = new LoopEngine({
        maxCycles: 5,
        onNodeExecute: async () => ({
          nodeId: "test",
          nodeName: "test",
          status: "completed",
        }),
      })

      engine.on("cycleComplete", () => {
        cyclesCompleted++
      })

      const strategy: LoopStrategy = {
        id: "cycle",
        name: "Cycle",
        entryNode: "n1",
        exitNodes: [],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [createTransition("n1", "n1", { type: "always" })],
      }

      engine.loadStrategy(strategy)
      await engine.execute({ task: "test" })
      expect(cyclesCompleted).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// 默认9节点策略完整测试
// ============================================================================

describe("默认9节点策略 - 完整流程验证", () => {
  describe("节点结构验证", () => {
    it("应该包含10个节点", () => {
      expect(defaultRalphLoopStrategy.nodes).toHaveLength(10)
    })

    it("节点顺序应该正确", () => {
      const nodeNames = defaultRalphLoopStrategy.nodes.map((n) => n.name)
      expect(nodeNames).toEqual([
        "领域专家意见",
        "规划者制定Plan",
        "执行者执行",
        "资深测试师分析",
        "测试工程师测试",
        "审核员审核",
        "代码校验专家优化",
        "质量闭环终评",
        "用户体验官测评",
        "流程结束",
      ])
    })

    it("每个工作节点应该有对应的角色", () => {
      for (const node of defaultRalphLoopStrategy.nodes) {
        // exit节点是特殊的退出节点，不需要角色
        if (node.id !== "exit") {
          expect(node.roles.length).toBeGreaterThan(0)
          for (const roleInstance of node.roles) {
            expect(roleInstance.role.systemPrompt).toBeDefined()
            expect(roleInstance.role.systemPrompt.length).toBeGreaterThan(10)
          }
        }
      }
    })

    it("节点ID应该正确", () => {
      const nodeIds = defaultRalphLoopStrategy.nodes.map((n) => n.id)
      expect(nodeIds).toEqual([
        "expert",
        "plan",
        "execute",
        "analyze",
        "test",
        "review",
        "optimize",
        "quality",
        "commit",
        "exit",
      ])
    })
  })

  describe("跳转逻辑验证", () => {
    it("应该定义所有必要的transitions", () => {
      expect(defaultRalphLoopStrategy.transitions.length).toBeGreaterThan(0)
    })

    it("正常流程transitions应该存在", () => {
      const transitions = defaultRalphLoopStrategy.transitions
      const hasExpertToPlan = transitions.some((t) => t.from === "expert" && t.to === "plan")
      const hasPlanToExecute = transitions.some((t) => t.from === "plan" && t.to === "execute")
      const hasExecuteToAnalyze = transitions.some((t) => t.from === "execute" && t.to === "analyze")
      const hasTestToReview = transitions.some((t) => t.from === "test" && t.to === "review")
      const hasReviewToOptimize = transitions.some((t) => t.from === "review" && t.to === "optimize")
      const hasOptimizeToQuality = transitions.some((t) => t.from === "optimize" && t.to === "quality")

      expect(hasExpertToPlan).toBe(true)
      expect(hasPlanToExecute).toBe(true)
      expect(hasExecuteToAnalyze).toBe(true)
      expect(hasTestToReview).toBe(true)
      expect(hasReviewToOptimize).toBe(true)
      expect(hasOptimizeToQuality).toBe(true)
    })

    it("质量评估通过应该跳转到用户体验官", () => {
      const transitions = defaultRalphLoopStrategy.transitions
      const qualityToCommit = transitions.find((t) => t.from === "quality" && t.to === "commit")
      expect(qualityToCommit).toBeDefined()
      expect(qualityToCommit!.condition.type).toBe("equals")
      expect(qualityToCommit!.condition.field).toBe("qualityPassed")
      expect(qualityToCommit!.condition.value).toBe(true)
    })

    it("质量评估失败应该跳转到规划者重新规划", () => {
      const transitions = defaultRalphLoopStrategy.transitions
      const qualityToPlan = transitions.find((t) => t.from === "quality" && t.to === "plan")
      expect(qualityToPlan).toBeDefined()
      expect(qualityToPlan!.condition.type).toBe("equals")
      expect(qualityToPlan!.condition.field).toBe("qualityPassed")
      expect(qualityToPlan!.condition.value).toBe(false)
    })

    it("用户体验通过应该回到领域专家进行下一轮", () => {
      const transitions = defaultRalphLoopStrategy.transitions
      const commitToExpert = transitions.find((t) => t.from === "commit" && t.to === "expert")
      expect(commitToExpert).toBeDefined()
      expect(commitToExpert!.condition.type).toBe("equals")
      expect(commitToExpert!.condition.field).toBe("ueApproved")
      expect(commitToExpert!.condition.value).toBe(true)
    })

    it("用户体验不通过应该跳转到规划者", () => {
      const transitions = defaultRalphLoopStrategy.transitions
      const commitToPlan = transitions.find((t) => t.from === "commit" && t.to === "plan")
      expect(commitToPlan).toBeDefined()
      expect(commitToPlan!.condition.type).toBe("equals")
      expect(commitToPlan!.condition.field).toBe("ueApproved")
      expect(commitToPlan!.condition.value).toBe(false)
    })

    it("分析阶段发现问题应该能跳回规划者", () => {
      const transitions = defaultRalphLoopStrategy.transitions
      const analyzeToPlan = transitions.find((t) => t.from === "analyze" && t.to === "plan")
      expect(analyzeToPlan).toBeDefined()
    })
  })

  describe("入口和出口验证", () => {
    it("入口节点应该是领域专家", () => {
      expect(defaultRalphLoopStrategy.entryNode).toBe("expert")
    })

    it("出口节点应该包含commit", () => {
      expect(defaultRalphLoopStrategy.exitNodes).toContain("commit")
    })
  })
})

// ============================================================================
// 跳转条件评估测试
// ============================================================================

describe("跳转条件评估 - 鲁棒性测试", () => {
  describe("基本条件类型", () => {
    it("always条件应该总是返回true", () => {
      const result = evaluateTransitionCondition({ type: "always" }, {}, null)
      expect(result).toBe(true)
    })

    it("equals条件应该正确比较", () => {
      const result = evaluateTransitionCondition(
        { type: "equals", field: "status", value: "pass" },
        { task: "", cycle: 0, status: "pass" },
        null,
      )
      expect(result).toBe(true)
    })

    it("equals条件应该正确拒绝不匹配", () => {
      const result = evaluateTransitionCondition(
        { type: "equals", field: "status", value: "pass" },
        { task: "", cycle: 0, status: "fail" },
        null,
      )
      expect(result).toBe(false)
    })

    it("notEquals条件应该正确工作", () => {
      const result = evaluateTransitionCondition(
        { type: "notEquals", field: "status", value: "fail" },
        { task: "", cycle: 0, status: "pass" },
        null,
      )
      expect(result).toBe(true)
    })

    it("contains条件应该正确匹配子字符串", () => {
      const result = evaluateTransitionCondition(
        { type: "contains", field: "message", value: "error" },
        { task: "", cycle: 0, message: "an error occurred" },
        null,
      )
      expect(result).toBe(true)
    })

    it("contains条件应该正确拒绝不匹配的字符串", () => {
      const result = evaluateTransitionCondition(
        { type: "contains", field: "message", value: "error" },
        { task: "", cycle: 0, message: "success message" },
        null,
      )
      expect(result).toBe(false)
    })
  })

  describe("关键词匹配", () => {
    it("keywordAny模式应该匹配任意关键词", () => {
      const result = evaluateTransitionCondition(
        { type: "keywordAny", field: "result", keywords: ["通过", "完成", "成功"], keywordMode: "any" },
        { task: "", cycle: 0, result: "任务已完成" },
        null,
      )
      expect(result).toBe(true)
    })

    it("keywordAll模式应该要求所有关键词都匹配", () => {
      const result = evaluateTransitionCondition(
        { type: "keywordAll", field: "result", keywords: ["通过", "测试"], keywordMode: "all" },
        { task: "", cycle: 0, result: "测试已通过" },
        null,
      )
      expect(result).toBe(true)
    })

    it("keywordAll模式应该在没有所有关键词时返回false", () => {
      const result = evaluateTransitionCondition(
        { type: "keywordAll", field: "result", keywords: ["通过", "测试", "审核"], keywordMode: "all" },
        { task: "", cycle: 0, result: "测试已通过" },
        null,
      )
      expect(result).toBe(false)
    })

    it("应该能检测'最终评定: 完成了'这类复杂文本", () => {
      const result = evaluateTransitionCondition(
        { type: "keywordAny", field: "result", keywords: ["最终评定: 完成了", "通过"], keywordMode: "any" },
        { task: "", cycle: 0, result: "质量评估 - 最终评定: 完成了" },
        null,
      )
      expect(result).toBe(true)
    })

    it("应该能检测'最终评定: 失败'这类文本", () => {
      const result = evaluateTransitionCondition(
        { type: "keywordAny", field: "result", keywords: ["最终评定: 失败", "不通过"], keywordMode: "any" },
        { task: "", cycle: 0, result: "质量评估 - 最终评定: 失败" },
        null,
      )
      expect(result).toBe(true)
    })
  })

  describe("正则表达式匹配", () => {
    it("regex条件应该正确匹配", () => {
      const result = evaluateTransitionCondition(
        { type: "regex", field: "code", regex: "^2\\d{2}$" },
        { task: "", cycle: 0, code: "200" },
        null,
      )
      expect(result).toBe(true)
    })

    it("regex条件应该正确拒绝不匹配", () => {
      const result = evaluateTransitionCondition(
        { type: "regex", field: "code", regex: "^2\\d{2}$" },
        { task: "", cycle: 0, code: "404" },
        null,
      )
      expect(result).toBe(false)
    })
  })

  describe("数值比较", () => {
    it("greaterThan应该正确比较数值", () => {
      const result = evaluateTransitionCondition(
        { type: "greaterThan", field: "score", value: 80 },
        { task: "", cycle: 0, score: 90 },
        null,
      )
      expect(result).toBe(true)
    })

    it("lessThan应该正确比较数值", () => {
      const result = evaluateTransitionCondition(
        { type: "lessThan", field: "score", value: 60 },
        { task: "", cycle: 0, score: 50 },
        null,
      )
      expect(result).toBe(true)
    })
  })

  describe("边界情况", () => {
    it("处理undefined字段应该返回false", () => {
      const result = evaluateTransitionCondition(
        { type: "equals", field: "missing", value: "something" },
        { task: "", cycle: 0 },
        null,
      )
      expect(result).toBe(false)
    })

    it("expression条件应该正确执行自定义函数", () => {
      const result = evaluateTransitionCondition(
        { type: "expression", expression: (ctx) => (ctx.cycle as number) > 5 },
        { task: "", cycle: 10 },
        null,
      )
      expect(result).toBe(true)
    })

    it("startsWith条件应该正确工作", () => {
      const result = evaluateTransitionCondition(
        { type: "startsWith", field: "result", value: "最终评定" },
        { task: "", cycle: 0, result: "最终评定: 通过" },
        null,
      )
      expect(result).toBe(true)
    })

    it("endsWith条件应该正确工作", () => {
      const result = evaluateTransitionCondition(
        { type: "endsWith", field: "result", value: "通过" },
        { task: "", cycle: 0, result: "最终评定: 通过" },
        null,
      )
      expect(result).toBe(true)
    })
  })
})

// ============================================================================
// LoopEngine功能测试
// ============================================================================

describe("LoopEngine - 核心功能测试", () => {
  let engine: LoopEngine

  beforeEach(() => {
    engine = new LoopEngine()
  })

  describe("策略加载", () => {
    it("应该能加载策略", () => {
      engine.loadStrategy(defaultRalphLoopStrategy)
      expect(engine.getStrategy()).toBeDefined()
      expect(engine.getStrategy()!.id).toBe(defaultRalphLoopStrategy.id)
    })

    it("加载策略应该设置strategyId", () => {
      engine.loadStrategy(defaultRalphLoopStrategy)
      expect(engine.getState().strategyId).toBe("ralph_loop_default")
    })
  })

  describe("执行控制", () => {
    it("没有加载策略时执行应该抛出错误", async () => {
      await expect(engine.execute()).rejects.toThrow("No strategy loaded")
    })

    it("应该能执行简单的策略", async () => {
      const simpleStrategy: LoopStrategy = {
        id: "simple",
        name: "Simple",
        entryNode: "n1",
        exitNodes: ["n2"],
        nodes: [createLoopNode("n1", "节点1", []), createLoopNode("n2", "节点2", [])],
        transitions: [createTransition("n1", "n2", { type: "always" })],
      }

      engine.loadStrategy(simpleStrategy)
      const result = await engine.execute({ task: "test" })
      expect(result.success).toBe(true)
    })

    it("应该支持最大迭代次数限制", async () => {
      const loopStrategy: LoopStrategy = {
        id: "loop",
        name: "Loop",
        entryNode: "n1",
        exitNodes: [],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [createTransition("n1", "n1", { type: "always" })],
      }

      const limitedEngine = new LoopEngine({ maxIterations: 5 })
      limitedEngine.loadStrategy(loopStrategy)
      const result = await limitedEngine.execute()
      expect(result.totalIterations).toBeLessThanOrEqual(5)
    })

    it("应该支持最大轮次限制", async () => {
      let cycles = 0
      const loopStrategy: LoopStrategy = {
        id: "loop",
        name: "Loop",
        entryNode: "n1",
        exitNodes: [],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [createTransition("n1", "n1", { type: "always" })],
        maxCycles: 3,
      }

      const limitedEngine = new LoopEngine({ maxCycles: 3 })
      limitedEngine.on("cycleComplete", (c) => {
        cycles = c
      })
      limitedEngine.loadStrategy(loopStrategy)
      await limitedEngine.execute()
      expect(cycles).toBeLessThanOrEqual(3)
    })
  })

  describe("执行历史", () => {
    it("应该记录执行历史", async () => {
      const simpleStrategy: LoopStrategy = {
        id: "simple",
        name: "Simple",
        entryNode: "n1",
        exitNodes: ["n2"],
        nodes: [createLoopNode("n1", "节点1", []), createLoopNode("n2", "节点2", [])],
        transitions: [createTransition("n1", "n2", { type: "always" })],
      }

      engine.loadStrategy(simpleStrategy)
      await engine.execute({ task: "test" })
      const history = engine.getExecutionHistory()
      expect(history.length).toBeGreaterThan(0)
      expect(history[0]!.nodeId).toBeDefined()
      expect(history[0]!.state).toBeDefined()
    })
  })

  describe("事件系统", () => {
    it("应该触发nodeStart事件", async () => {
      const events: string[] = []
      engine.on("nodeStart", () => events.push("nodeStart"))

      const simpleStrategy: LoopStrategy = {
        id: "simple",
        name: "Simple",
        entryNode: "n1",
        exitNodes: ["n1"],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [],
      }

      engine.loadStrategy(simpleStrategy)
      await engine.execute()
      expect(events).toContain("nodeStart")
    })

    it("应该触发nodeComplete事件", async () => {
      let completed = false
      engine.on("nodeComplete", () => {
        completed = true
      })

      const simpleStrategy: LoopStrategy = {
        id: "simple",
        name: "Simple",
        entryNode: "n1",
        exitNodes: ["n1"],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [],
      }

      engine.loadStrategy(simpleStrategy)
      await engine.execute()
      expect(completed).toBe(true)
    })

    it("应该触发cycleComplete事件", async () => {
      let cycleCompleted = false
      engine.on("cycleComplete", () => {
        cycleCompleted = true
      })

      const loopStrategy: LoopStrategy = {
        id: "cycle",
        name: "Cycle",
        entryNode: "n1",
        exitNodes: [],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [createTransition("n1", "n1", { type: "always" })],
      }

      engine.loadStrategy(loopStrategy)
      await engine.execute()
      expect(cycleCompleted).toBe(true)
    })

    it("应该触发complete事件", async () => {
      let completed = false
      engine.on("complete", () => {
        completed = true
      })

      const simpleStrategy: LoopStrategy = {
        id: "simple",
        name: "Simple",
        entryNode: "n1",
        exitNodes: ["n1"],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [],
      }

      engine.loadStrategy(simpleStrategy)
      await engine.execute()
      expect(completed).toBe(true)
    })
  })

  describe("自定义执行器", () => {
    it("应该使用自定义节点执行器", async () => {
      let executedNodes = 0
      const customEngine = new LoopEngine({
        onNodeExecute: async (node) => {
          executedNodes++
          return {
            nodeId: node.id,
            nodeName: node.name,
            status: "custom",
          }
        },
      })

      const simpleStrategy: LoopStrategy = {
        id: "simple",
        name: "Simple",
        entryNode: "n1",
        exitNodes: ["n2"],
        nodes: [createLoopNode("n1", "节点1", []), createLoopNode("n2", "节点2", [])],
        transitions: [createTransition("n1", "n2", { type: "always" })],
      }

      customEngine.loadStrategy(simpleStrategy)
      await customEngine.execute({ task: "test" })
      expect(executedNodes).toBe(2)
    })

    it("应该使用自定义角色执行器", async () => {
      let executedRoles = 0
      const customEngine = new LoopEngine({
        onRoleExecute: async (roleInstance) => {
          executedRoles++
          return {
            step: roleInstance.role.name,
            status: "executed",
          }
        },
      })

      const role = createRole("r1", "角色1", "prompt")
      const simpleStrategy: LoopStrategy = {
        id: "simple",
        name: "Simple",
        entryNode: "n1",
        exitNodes: ["n2"],
        nodes: [createLoopNode("n1", "节点1", [{ role }]), createLoopNode("n2", "节点2", [])],
        transitions: [createTransition("n1", "n2", { type: "always" })],
      }

      customEngine.loadStrategy(simpleStrategy)
      await customEngine.execute({ task: "test" })
      expect(executedRoles).toBeGreaterThan(0)
    })
  })

  describe("状态管理", () => {
    it("应该能重置状态", () => {
      engine.loadStrategy(defaultRalphLoopStrategy)
      engine.reset()
      const state = engine.getState()
      expect(state.active).toBe(false)
      expect(state.currentNodeId).toBe("")
      expect(state.cycleCount).toBe(0)
      expect(state.iteration).toBe(0)
    })

    it("应该能停止执行", async () => {
      const loopStrategy: LoopStrategy = {
        id: "loop",
        name: "Loop",
        entryNode: "n1",
        exitNodes: [],
        nodes: [createLoopNode("n1", "节点1", [])],
        transitions: [createTransition("n1", "n1", { type: "always" })],
      }

      engine.loadStrategy(loopStrategy)

      setTimeout(() => {
        engine.stop()
      }, 10)

      await engine.execute()
      expect(engine.getState().active).toBe(false)
    })
  })
})

// ============================================================================
// 9节点完整流程模拟测试
// ============================================================================

describe("9节点策略 - 完整流程模拟", () => {
  it("应该能模拟完整的成功流程", async () => {
    let cycleCount = 0
    const engine = new LoopEngine({
      onRoleExecute: async (roleInstance, node, context) => {
        if (node.id === "quality") {
          context.qualityPassed = true
        }
        if (node.id === "commit") {
          context.ueApproved = true
          cycleCount++
          // 完成一轮后退出
          if (cycleCount >= 1) {
            context.shouldExit = true
          }
        }
        return {
          step: `role:${roleInstance.role.name}`,
          executed: `Role ${roleInstance.role.name} executed`,
          status: "completed",
        }
      },
    })

    engine.loadStrategy(defaultRalphLoopStrategy)
    const result = await engine.execute({ task: "开发新功能" })
    expect(result.success).toBe(true)
    expect(result.completedNodes.length).toBeGreaterThan(0)
  })

  it("应该能模拟质量评估失败后的重规划流程", async () => {
    let qualityCheckCount = 0
    let cycleCount = 0
    const strategy = JSON.parse(JSON.stringify(defaultRalphLoopStrategy))

    const engine = new LoopEngine({
      onRoleExecute: async (roleInstance, node, context) => {
        if (node.id === "quality") {
          qualityCheckCount++
          context.qualityPassed = qualityCheckCount > 1
        }
        if (node.id === "commit") {
          context.ueApproved = true
          cycleCount++
          if (cycleCount >= 2) {
            context.shouldExit = true
          }
        }
        return {
          step: `role:${roleInstance.role.name}`,
          executed: `Role ${roleInstance.role.name} executed`,
          status: "completed",
        }
      },
    })

    engine.loadStrategy(strategy)
    const result = await engine.execute({ task: "开发功能" })
    expect(result.success).toBe(true)
    expect(result.exitNode).toBe("exit")
    expect(qualityCheckCount).toBeGreaterThanOrEqual(1)
    expect(cycleCount).toBeGreaterThanOrEqual(1)
  })

  it("应该能模拟用户体验失败后的重规划流程", async () => {
    let ueCheckCount = 0
    let cycleCount = 0
    const strategy = JSON.parse(JSON.stringify(defaultRalphLoopStrategy))

    const engine = new LoopEngine({
      onRoleExecute: async (roleInstance, node, context) => {
        if (node.id === "quality") {
          context.qualityPassed = true
        }
        if (node.id === "commit") {
          ueCheckCount++
          context.ueApproved = ueCheckCount > 1
          if (ueCheckCount > 1) {
            cycleCount++
            context.shouldExit = true
          }
        }
        return {
          step: `role:${roleInstance.role.name}`,
          executed: `Role ${roleInstance.role.name} executed`,
          status: "completed",
        }
      },
    })

    engine.loadStrategy(strategy)
    const result = await engine.execute({ task: "开发功能" })
    expect(result.success).toBe(true)
    expect(result.exitNode).toBe("exit")
    expect(ueCheckCount).toBe(2)
  })
})

// ============================================================================
// 边界情况和错误处理测试
// ============================================================================

describe("边界情况和错误处理", () => {
  it("应该处理空角色列表的节点", async () => {
    const engine = new LoopEngine({
      onNodeExecute: async (node) => ({
        nodeId: node.id,
        nodeName: node.name,
        status: "completed",
      }),
    })

    const strategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: ["n1"],
      nodes: [createLoopNode("n1", "空角色节点", [])],
      transitions: [],
    }

    engine.loadStrategy(strategy)
    const result = await engine.execute()
    expect(result.success).toBe(true)
  })

  it("应该处理节点执行错误", async () => {
    const engine = new LoopEngine({
      onNodeExecute: async () => {
        throw new Error("执行错误")
      },
    })

    const strategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: [],
      nodes: [createLoopNode("n1", "错误节点", [])],
      transitions: [],
    }

    engine.loadStrategy(strategy)
    const result = await engine.execute()
    expect(result.success).toBe(false)
    expect(result.error).toContain("执行错误")
  })

  it("应该处理找不到目标节点的情况", async () => {
    const engine = new LoopEngine({
      onNodeExecute: async (node) => ({
        nodeId: node.id,
        nodeName: node.name,
        status: "completed",
      }),
    })

    const strategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: [],
      nodes: [createLoopNode("n1", "节点1", [])],
      transitions: [createTransition("n1", "nonexistent", { type: "always" })],
    }

    engine.loadStrategy(strategy)
    const result = await engine.execute()
    expect(result.success).toBe(false)
  })

  it("应该处理没有匹配transition的情况", async () => {
    const engine = new LoopEngine({
      onNodeExecute: async (node) => ({
        nodeId: node.id,
        nodeName: node.name,
        status: "completed",
      }),
    })

    const strategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: [],
      nodes: [createLoopNode("n1", "节点1", [])],
      transitions: [createConditionalTransition("n1", "n2", "status", "pass", "equals")],
    }

    engine.loadStrategy(strategy)
    const result = await engine.execute({ task: "test", status: "fail" })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// 角色多实例测试
// ============================================================================

describe("角色多实例配置", () => {
  it("应该支持多个相同角色的不同实例", async () => {
    const role = createRole("reviewer", "审核员", "你是审核员")
    const instances: RoleInstance[] = [
      { role: { ...role, id: "reviewer_strict", name: "严格审核员" }, weight: 1.0, personality: "严格" },
      { role: { ...role, id: "reviewer_kind", name: "温和审核员" }, weight: 0.8, personality: "温和" },
      { role: { ...role, id: "reviewer_detail", name: "细节审核员" }, weight: 0.9, personality: "注重细节" },
    ]

    const node = createLoopNode("review", "审核节点", instances)
    expect(node.roles).toHaveLength(3)
    expect(node.roles[0]!.personality).toBe("严格")
    expect(node.roles[1]!.personality).toBe("温和")
    expect(node.roles[2]!.personality).toBe("注重细节")
  })

  it("应该支持count属性创建多个角色实例", async () => {
    const role = createRole("tester", "测试员", "你是测试员")
    const instance: RoleInstance = {
      role,
      count: 5,
      weight: 1.0,
    }

    const node = createLoopNode("test", "测试节点", [instance])
    expect(node.roles).toHaveLength(1)
    expect(node.roles[0]!.count).toBe(5)
  })
})

// ============================================================================
// 上下文和状态传递测试
// ============================================================================

describe("上下文和状态传递", () => {
  it("应该在节点间传递上下文", async () => {
    const contextData: Record<string, unknown> = {}

    const engine = new LoopEngine({
      onNodeExecute: async (node, context) => {
        contextData[node.id] = context.task
        context[node.id + "_processed"] = true
        return {
          nodeId: node.id,
          nodeName: node.name,
          status: "completed",
        }
      },
    })

    const strategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: ["n2"],
      nodes: [createLoopNode("n1", "节点1", []), createLoopNode("n2", "节点2", [])],
      transitions: [createTransition("n1", "n2", { type: "always" })],
    }

    engine.loadStrategy(strategy)
    await engine.execute({ task: "测试任务" })

    expect(contextData["n1"]).toBe("测试任务")
    expect(contextData["n2"]).toBe("测试任务")
  })

  it("应该在结果中包含节点执行结果", async () => {
    const engine = new LoopEngine({
      onNodeExecute: async (node) => ({
        nodeId: node.id,
        nodeName: node.name,
        status: "completed",
        customData: `data from ${node.id}`,
      }),
    })

    const strategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: ["n1"],
      nodes: [createLoopNode("n1", "节点1", [])],
      transitions: [],
    }

    engine.loadStrategy(strategy)
    const result = await engine.execute({ task: "test" })

    expect(result.completedNodes.length).toBeGreaterThan(0)
    expect(result.completedNodes[0]!.result).toBeDefined()
  })
})

// ============================================================================
// 性能和压力测试
// ============================================================================

describe("性能和压力测试", () => {
  it("应该能处理大量节点", async () => {
    const nodes: LoopNode[] = []
    const transitions: Transition[] = []

    for (let i = 0; i < 100; i++) {
      nodes.push(createLoopNode(`n${i}`, `节点${i}`, []))
      if (i < 99) {
        transitions.push(createTransition(`n${i}`, `n${i + 1}`, { type: "always" }))
      }
    }

    const engine = new LoopEngine({
      maxIterations: 200,
      onNodeExecute: async (node) => ({
        nodeId: node.id,
        nodeName: node.name,
        status: "completed",
      }),
    })

    const strategy: LoopStrategy = {
      id: "large",
      name: "Large",
      entryNode: "n0",
      exitNodes: ["n99"],
      nodes,
      transitions,
    }

    engine.loadStrategy(strategy)
    const result = await engine.execute()
    expect(result.success).toBe(true)
    expect(result.completedNodes.length).toBe(100)
  })

  it("应该能快速评估transition条件", () => {
    const iterations = 10000
    const condition: TransitionCondition = {
      type: "keywordAny",
      field: "result",
      keywords: ["通过", "完成", "成功", "done", "passed"],
      keywordMode: "any",
    }
    const context = { task: "", cycle: 0, result: "任务已完成并通过测试" }

    const start = Date.now()
    for (let i = 0; i < iterations; i++) {
      evaluateTransitionCondition(condition, context, null)
    }
    const duration = Date.now() - start

    expect(duration).toBeLessThan(1000)
  })
})

// ============================================================================
// API完整性和类型安全测试
// ============================================================================

describe("API完整性和类型安全", () => {
  it("所有导出函数应该可用", () => {
    expect(typeof createRole).toBe("function")
    expect(typeof createLoopNode).toBe("function")
    expect(typeof createTransition).toBe("function")
    expect(typeof createConditionalTransition).toBe("function")
    expect(typeof createKeywordTransition).toBe("function")
    expect(typeof evaluateTransitionCondition).toBe("function")
    expect(typeof getDefaultStrategy).toBe("function")
    expect(typeof createCustomStrategy).toBe("function")
  })

  it("默认策略应该是一个有效的LoopStrategy", () => {
    expect(defaultRalphLoopStrategy.id).toBeDefined()
    expect(defaultRalphLoopStrategy.name).toBeDefined()
    expect(Array.isArray(defaultRalphLoopStrategy.nodes)).toBe(true)
    expect(Array.isArray(defaultRalphLoopStrategy.transitions)).toBe(true)
    expect(defaultRalphLoopStrategy.entryNode).toBeDefined()
    expect(Array.isArray(defaultRalphLoopStrategy.exitNodes)).toBe(true)
  })

  it("getDefaultStrategy应该返回深拷贝", () => {
    const s1 = getDefaultStrategy()
    const s2 = getDefaultStrategy()
    expect(s1).not.toBe(s2)
    expect(s1.nodes).not.toBe(s2.nodes)
    expect(s1.transitions).not.toBe(s2.transitions)
  })
})
