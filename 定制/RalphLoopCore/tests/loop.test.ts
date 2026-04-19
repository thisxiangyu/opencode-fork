import { describe, it, expect, beforeEach } from "vitest"
import { LoopEngine } from "../src/graph/LoopEngine.js"
import type { LoopStrategy, LoopNode, Transition } from "../src/graph/strategies.js"
import {
  createRole,
  createLoopNode,
  createTransition,
  createConditionalTransition,
  defaultRalphLoopStrategy,
  getDefaultStrategy,
  roles,
  evaluateTransitionCondition,
} from "../src/graph/strategies.js"
import type { StrategyState } from "../src/types/index.js"

describe("LoopStrategy Types", () => {
  describe("createRole", () => {
    it("should create a role with basic properties", () => {
      const role = createRole("test_role", "测试角色", "You are a test role", "memory content")
      expect(role.id).toBe("test_role")
      expect(role.name).toBe("测试角色")
      expect(role.systemPrompt).toBe("You are a test role")
      expect(role.memory).toBe("memory content")
    })
  })

  describe("createLoopNode", () => {
    it("should create a node with default config", () => {
      const role = createRole("r1", "角色1", "prompt")
      const node = createLoopNode("n1", "节点1", [{ role }])
      expect(node.id).toBe("n1")
      expect(node.name).toBe("节点1")
      expect(node.roles).toHaveLength(1)
      expect(node.config.timeout).toBe(30000)
      expect(node.config.retryable).toBe(true)
    })

    it("should create a node with custom config", () => {
      const role = createRole("r1", "角色1", "prompt")
      const node = createLoopNode("n1", "节点1", [{ role }], {
        timeout: 60000,
        retryable: false,
        maxRetries: 5,
      })
      expect(node.config.timeout).toBe(60000)
      expect(node.config.retryable).toBe(false)
      expect(node.config.maxRetries).toBe(5)
    })
  })

  describe("createTransition", () => {
    it("should create an always transition", () => {
      const t = createTransition("n1", "n2", { type: "always" }, "always description")
      expect(t.from).toBe("n1")
      expect(t.to).toBe("n2")
      expect(t.condition.type).toBe("always")
      expect(t.description).toBe("always description")
    })

    it("should create a conditional transition", () => {
      const t = createConditionalTransition("n1", "n2", "status", "pass", "equals")
      expect(t.from).toBe("n1")
      expect(t.to).toBe("n2")
      expect(t.condition.type).toBe("equals")
      expect(t.condition.field).toBe("status")
      expect(t.condition.value).toBe("pass")
    })
  })
})

describe("defaultRalphLoopStrategy", () => {
  it("should have 10 nodes", () => {
    expect(defaultRalphLoopStrategy.nodes).toHaveLength(10)
  })

  it("should have correct node order", () => {
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

  it("should have entry node as expert", () => {
    expect(defaultRalphLoopStrategy.entryNode).toBe("expert")
  })

  it("should have exit nodes including commit and exit", () => {
    expect(defaultRalphLoopStrategy.exitNodes).toContain("commit")
    expect(defaultRalphLoopStrategy.exitNodes).toContain("exit")
  })

  it("should have roles defined for each work node", () => {
    for (const node of defaultRalphLoopStrategy.nodes) {
      // exit node is a special exit node without roles
      if (node.id !== "exit") {
        expect(node.roles.length).toBeGreaterThan(0)
      }
    }
  })
})

describe("getDefaultStrategy", () => {
  it("should return a deep copy", () => {
    const strategy1 = getDefaultStrategy()
    const strategy2 = getDefaultStrategy()
    expect(strategy1).not.toBe(strategy2)
    expect(strategy1.nodes).not.toBe(strategy2.nodes)
  })

  it("should have correct structure", () => {
    const strategy = getDefaultStrategy()
    expect(strategy.id).toBe("ralph_loop_default")
    expect(strategy.name).toBe("RalphLoop默认九节点策略")
    expect(strategy.version).toBe("1.0.0")
    expect(strategy.maxCycles).toBe(100)
  })
})

describe("roles", () => {
  it("should have all required roles defined", () => {
    const requiredRoleIds = [
      "domainExpert",
      "planner",
      "executor",
      "seniorTester",
      "testEngineer",
      "reviewer",
      "codeReviewer",
      "qualityCloser",
      "userExperience",
    ]
    for (const id of requiredRoleIds) {
      expect(roles[id]).toBeDefined()
      expect(roles[id]!.id).toBeDefined()
      expect(roles[id]!.name).toBeDefined()
      expect(roles[id]!.systemPrompt).toBeDefined()
    }
  })

  it("should have non-empty system prompts", () => {
    for (const role of Object.values(roles)) {
      expect(role.systemPrompt.length).toBeGreaterThan(10)
    }
  })
})

describe("LoopEngine", () => {
  let engine: LoopEngine

  beforeEach(() => {
    engine = new LoopEngine()
  })

  it("should load strategy", () => {
    engine.loadStrategy(defaultRalphLoopStrategy)
    const loaded = engine.getStrategy()
    expect(loaded).toBeDefined()
    expect(loaded!.id).toBe(defaultRalphLoopStrategy.id)
  })

  it("should have initial state", () => {
    const state = engine.getState()
    expect(state.active).toBe(false)
    expect(state.currentNodeId).toBe("")
    expect(state.cycleCount).toBe(0)
    expect(state.iteration).toBe(0)
  })

  it("should throw error when executing without strategy", async () => {
    await expect(engine.execute()).rejects.toThrow("No strategy loaded")
  })

  it("should execute with custom node executor", async () => {
    let callCount = 0
    const simpleStrategy: LoopStrategy = {
      id: "simple",
      name: "Simple Strategy",
      entryNode: "n1",
      exitNodes: ["n2"],
      nodes: [createLoopNode("n1", "Node 1", []), createLoopNode("n2", "Node 2", [])],
      transitions: [createTransition("n1", "n2", { type: "always" })],
    }

    const customEngine = new LoopEngine({
      onNodeExecute: async (node) => {
        callCount++
        return {
          nodeId: node.id,
          nodeName: node.name,
          status: "completed",
        }
      },
    })

    customEngine.loadStrategy(simpleStrategy)
    const result = await customEngine.execute({ task: "test task" })

    expect(result.success).toBe(true)
    expect(callCount).toBe(2)
  })

  it("should stop execution", async () => {
    let iterationCount = 0
    const customEngine = new LoopEngine({
      maxIterations: 1000,
      onNodeExecute: async () => {
        iterationCount++
        if (iterationCount >= 5) {
          customEngine.stop()
        }
        return { nodeId: "test", nodeName: "test", status: "completed" }
      },
    })

    const strategy: LoopStrategy = {
      id: "loop",
      name: "Loop Strategy",
      entryNode: "n1",
      exitNodes: [],
      nodes: [createLoopNode("n1", "Node 1", [])],
      transitions: [createTransition("n1", "n1", { type: "always" })],
    }

    customEngine.loadStrategy(strategy)

    const result = await customEngine.execute()
    expect(result.totalIterations).toBeLessThan(20)
  })

  it("should track execution history", async () => {
    const callCount = 0
    const customEngine = new LoopEngine({
      maxIterations: 5,
      onNodeExecute: async (node) => {
        return {
          nodeId: node.id,
          nodeName: node.name,
          status: "completed",
        }
      },
    })

    const simpleStrategy: LoopStrategy = {
      id: "simple",
      name: "Simple Strategy",
      entryNode: "n1",
      exitNodes: ["n2"],
      nodes: [
        createLoopNode("n1", "Node 1", [], { timeout: 5000 }),
        createLoopNode("n2", "Node 2", [], { timeout: 5000 }),
      ],
      transitions: [createTransition("n1", "n2", { type: "always" })],
    }

    customEngine.loadStrategy(simpleStrategy)
    const result = await customEngine.execute()

    const history = customEngine.getExecutionHistory()
    expect(history.length).toBe(result.totalIterations)
  })
})

describe("Transition Condition Evaluation", () => {
  it("should evaluate always condition as true", () => {
    const result = evaluateTransitionCondition({ type: "always" }, { task: "", cycle: 0 }, null)
    expect(result).toBe(true)
  })

  it("should evaluate equals condition", () => {
    const result = evaluateTransitionCondition(
      { type: "equals", field: "status", value: "pass" },
      { task: "", cycle: 0, status: "pass" },
      null,
    )
    expect(result).toBe(true)
  })

  it("should evaluate notEquals condition", () => {
    const result = evaluateTransitionCondition(
      { type: "notEquals", field: "status", value: "fail" },
      { task: "", cycle: 0, status: "pass" },
      null,
    )
    expect(result).toBe(true)
  })

  it("should evaluate contains condition", () => {
    const result = evaluateTransitionCondition(
      { type: "contains", field: "message", value: "error" },
      { task: "", cycle: 0, message: "an error occurred" },
      null,
    )
    expect(result).toBe(true)
  })

  it("should evaluate regex condition", () => {
    const result = evaluateTransitionCondition(
      { type: "regex", field: "code", regex: "^2\\d{2}$" },
      { task: "", cycle: 0, code: "200" },
      null,
    )
    expect(result).toBe(true)
  })
})

describe("Event Emission", () => {
  it("should emit nodeStart event", async () => {
    const engine = new LoopEngine({
      onNodeExecute: async () => ({ nodeId: "test", nodeName: "test", status: "ok" }),
    })

    const events: string[] = []
    engine.on("nodeStart", () => events.push("nodeStart"))

    const simpleStrategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: ["n1"],
      nodes: [createLoopNode("n1", "Node 1", [])],
      transitions: [],
    }

    engine.loadStrategy(simpleStrategy)
    await engine.execute()

    expect(events).toContain("nodeStart")
  })

  it("should emit complete event", async () => {
    const engine = new LoopEngine({
      onNodeExecute: async () => ({ nodeId: "test", nodeName: "test", status: "ok" }),
    })

    let completed = false
    engine.on("complete", () => {
      completed = true
    })

    const simpleStrategy: LoopStrategy = {
      id: "test",
      name: "Test",
      entryNode: "n1",
      exitNodes: ["n1"],
      nodes: [createLoopNode("n1", "Node 1", [])],
      transitions: [],
    }

    engine.loadStrategy(simpleStrategy)
    await engine.execute()

    expect(completed).toBe(true)
  })
})
