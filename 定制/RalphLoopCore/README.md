# LoopEngine 使用教程

## 概述

LoopEngine 是一个基于节点图的智能会话循环执行引擎，支持：

- **条件跳转**：16 种条件类型（equals, regex, keyword, expression 等）
- **多角色协作**：单节点可包含多个角色实例
- **生命周期钩子**：节点 enter/exit 钩子
- **重试机制**：节点级别 timeout/retry 配置
- **OpenCode 集成**：开箱即用的适配器

## 核心概念

### Role（角色）

角色定义一个身份，包含 systemPrompt：

```typescript
interface Role {
  id: string
  name: string
  systemPrompt: string
  memory?: string
}
```

### RoleInstance（角色实例）

角色的实例化，可配置权重、温度等参数：

```typescript
interface RoleInstance {
  role: Role
  weight?: number
  temperature?: number
  maxTokens?: number
  count?: number // 实例数量
  personality?: string
}
```

### LoopNode（节点）

执行单元，包含多个角色实例：

```typescript
interface LoopNode {
  id: string
  name: string
  description?: string
  roles: RoleInstance[]
  config: {
    timeout?: number
    retryable?: boolean
    maxRetries?: number
    parallel?: boolean // 多角色并行
    continueOnError?: boolean
  }
  onEnter?: (context) => void
  onExit?: (context, result) => void
}
```

### TransitionCondition（跳转条件）

| 类型                                    | 说明            |
| --------------------------------------- | --------------- |
| `always`                                | 无条件跳转      |
| `equals` / `notEquals`                  | 相等/不等比较   |
| `contains` / `notContains`              | 字符串包含      |
| `startsWith` / `endsWith`               | 字符串开头/结尾 |
| `regex`                                 | 正则表达式      |
| `greaterThan` / `lessThan`              | 数值比较        |
| `keyword` / `keywordAny` / `keywordAll` | 关键词检测      |
| `expression`                            | 自定义函数      |

## 快速开始

```typescript
import { LoopEngine, getDefaultStrategy } from "./index.js"

async function main() {
  const engine = new LoopEngine({
    maxCycles: 100,
    onRoleExecute: async (roleInstance, node, context) => {
      console.log(`[节点] ${node.name}`)
      console.log(`[角色] ${roleInstance.role.name}`)

      // 这里实现 AI 调用
      const response = await callAI(roleInstance.role.systemPrompt, context.task)

      return {
        step: `role:${roleInstance.role.name}`,
        status: "completed",
        session_output: response,
      }
    },
  })

  engine.loadStrategy(getDefaultStrategy())

  engine.on("nodeStart", (node) => console.log(`>>> ${node.name}`))
  engine.on("nodeComplete", (node) => console.log(`<<< ${node.name}`))
  engine.on("transition", (from, to) => console.log(`⇢ ${from} → ${to}`))
  engine.on("cycleComplete", (cycle) => console.log(`\n=== 第 ${cycle} 轮 ===\n`))
  engine.on("complete", (result) => {
    console.log(`\n完成: ${result.success}`)
    console.log(`轮次: ${result.totalCycles}`)
    console.log(`迭代: ${result.totalIterations}`)
  })

  const result = await engine.execute({ task: "实现一个计算器" })
}

main()
```

## 默认九节点策略

```
expert(领域专家) → plan(规划者) → execute(执行者) → analyze(资深测试师)
                                                              │
                                          ┌───────────────────┘
                                          ↓
                        test(测试工程师) → review(审核员) → optimize(代码优化)
                                                                        │
                                          ┌───────────────────────────┘
                                          ↓
                        quality(质量闭环) → commit(用户体验官)
                                                    │
                              ┌─────────────────────┴─────────────────────┐
                              ↓                                               ↓
                        exit(结束) ← shouldExit=true              expert(循环) ← ueApproved=true
                                                                        │
                                                                        ↓
                                                                plan(重规划) ← ueApproved=false
```

### 节点说明

| 节点ID   | 名称             | 角色           | 职责                       |
| -------- | ---------------- | -------------- | -------------------------- |
| expert   | 领域专家意见     | domainExpert   | 提供领域见解和技术趋势分析 |
| plan     | 规划者制定Plan   | planner        | 制定详细的执行计划         |
| execute  | 执行者执行       | executor       | 按照计划执行任务           |
| analyze  | 资深测试师分析   | seniorTester   | 从多角度分析潜在问题       |
| test     | 测试工程师测试   | testEngineer   | 编写并执行测试用例         |
| review   | 审核员审核       | reviewer       | 重跑测试、进行性能优化分析 |
| optimize | 代码校验专家优化 | codeReviewer   | 基于分析结果进行代码优化   |
| quality  | 质量闭环终评     | qualityCloser  | 整体质量和可靠性闭环评估   |
| commit   | 用户体验官测评   | userExperience | 随机性格用户体验官测评     |

### 跳转条件

| 源节点   | 目标节点 | 条件字段      | 值    | 类型   |
| -------- | -------- | ------------- | ----- | ------ |
| expert   | plan     | -             | -     | always |
| plan     | execute  | -             | -     | always |
| execute  | analyze  | -             | -     | always |
| analyze  | test     | -             | -     | always |
| analyze  | plan     | needsReplan   | true  | equals |
| test     | review   | -             | -     | always |
| review   | optimize | -             | -     | always |
| optimize | quality  | -             | -     | always |
| quality  | commit   | qualityPassed | true  | equals |
| quality  | plan     | qualityPassed | false | equals |
| commit   | exit     | shouldExit    | true  | equals |
| commit   | expert   | ueApproved    | true  | equals |
| commit   | plan     | ueApproved    | false | equals |

## 自定义策略

### 创建角色

```typescript
import { createRole } from "./index.js"

const coder = createRole("coder", "代码编写者", "你是一位专业的代码编写者...")
```

### 创建节点

```typescript
import { createLoopNode } from "./index.js"

const node = createLoopNode("develop", "开发节点", [{ role: coder, weight: 1.0 }], { timeout: 60000, retryable: true })
```

### 创建跳转

```typescript
import { createTransition, createConditionalTransition } from "./index.js"

// 无条件跳转
createTransition("start", "process", { type: "always" })

// 条件跳转
createConditionalTransition("quality", "commit", "qualityPassed", true, "equals")
```

### 组合完整策略

```typescript
import { createCustomStrategy, type LoopStrategy } from "./index.js"

const strategy: LoopStrategy = {
  id: "my_strategy",
  name: "我的策略",
  entryNode: "start",
  exitNodes: ["end"],
  nodes: [
    createLoopNode("start", "开始", []),
    createLoopNode("process", "处理", [{ role: coder }]),
    createLoopNode("end", "结束", []),
  ],
  transitions: [
    createTransition("start", "process", { type: "always" }),
    createConditionalTransition("process", "end", "status", "done", "equals"),
    createConditionalTransition("process", "start", "status", "retry", "equals"),
  ],
}
```

## 监听事件

```typescript
const engine = new LoopEngine({ ... })

engine.on("nodeStart", (node, state) => {
  console.log(`>>> ${node.name}`)
})

engine.on("nodeComplete", (node, result, state) => {
  console.log(`<<< ${node.name} [${result.status}]`)
})

engine.on("nodeError", (node, error, state) => {
  console.error(`!!! ${node.name} 错误: ${error.message}`)
})

engine.on("transition", (from, to, result, state) => {
  console.log(`⇢ ${from} → ${to}`)
})

engine.on("cycleComplete", (cycle, context) => {
  console.log(`\n=== 第 ${cycle} 轮完成 ===\n`)
})

engine.on("complete", (result, state) => {
  console.log(`\n执行完成: ${result.success}`)
  console.log(`总轮次: ${result.totalCycles}`)
  console.log(`总迭代: ${result.totalIterations}`)
})

engine.on("error", (error, state) => {
  console.error(`执行错误: ${error.message}`)
})
```

## OpenCode 集成

### 连接 OpenCode 服务器

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"
import { LoopEngine } from "./index.js"

async function main() {
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" })

  // 创建会话
  const session = await client.session.create({
    query: { directory: process.cwd() },
    body: { title: "LoopEngine 任务" },
  })

  if (!session.data) throw new Error("创建会话失败")
  const sessionId = session.data.id

  // 使用会话 ID 构建适配器
  const adapter = new OpenCodeSessionAdapter(client, sessionId, process.cwd())

  // 创建引擎
  const engine = new LoopEngine({
    maxCycles: 10,
    onRoleExecute: async (roleInstance, node, context) => {
      const response = await adapter.sendAndReceive(roleInstance.role.systemPrompt, context.task)
      return {
        step: `role:${roleInstance.role.name}`,
        status: "completed",
        session_output: response,
      }
    },
  })

  engine.loadStrategy(getDefaultStrategy())
  const result = await engine.execute({ task: "实现一个待办事项应用" })
}
```

### 会话选择

运行时会列出最近会话，支持：

- `0` - 创建新会话
- `1-6` - 选择最近会话
- 输入名称搜索

详见 `examples/opencode-integration.ts`

### 上下文压缩

```typescript
// 主动触发上下文压缩
await client.session.summarize({
  path: { id: sessionId },
  body: {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-20250514",
    auto: false,
  },
})
```

详见 `examples/compact.ts`

## API 参考

### LoopEngine

| 方法                      | 说明             |
| ------------------------- | ---------------- |
| `loadStrategy(strategy)`  | 加载节点图策略   |
| `execute(initialContext)` | 执行策略         |
| `stop()`                  | 停止执行         |
| `reset()`                 | 重置状态         |
| `getState()`              | 获取执行状态     |
| `getContext()`            | 获取执行上下文   |
| `getExecutionHistory()`   | 获取节点执行历史 |
| `getStrategy()`           | 获取当前策略     |

### 创建函数

| 函数                                                                                          | 说明               |
| --------------------------------------------------------------------------------------------- | ------------------ |
| `createRole(id, name, systemPrompt, memory?)`                                                 | 创建角色           |
| `createLoopNode(id, name, roles, config?, description?)`                                      | 创建节点           |
| `createTransition(from, to, condition, description?, priority?)`                              | 创建跳转           |
| `createConditionalTransition(from, to, field, value, conditionType, description?, priority?)` | 创建条件跳转       |
| `getDefaultStrategy()`                                                                        | 获取默认九节点策略 |
| `createCustomStrategy(id, name, nodes, transitions, entryNode, exitNodes)`                    | 创建自定义策略     |

## 最佳实践

### 1. 节点返回值控制跳转

```typescript
// 质量评估节点
if (node.name === "质量闭环终评") {
  result.qualityPassed = response.includes("通过")
}

// 用户体验节点
if (node.name === "用户体验官测评") {
  result.ueApproved = response.includes("完成")
  result.shouldExit = result.ueApproved === true
}
```

### 2. 设置合理的限制

```typescript
const engine = new LoopEngine({
  maxCycles: 100, // 最多100轮
  maxIterations: 500, // 最多500次迭代
  cycleDelay: 500, // 轮次间延迟
})
```

### 3. 使用并行角色

```typescript
const parallelNode = createLoopNode(
  "review",
  "代码审查",
  [
    { role: reviewer1, weight: 1.0 },
    { role: reviewer2, weight: 1.0 },
  ],
  { parallel: true }, // 两角色并行执行
)
```

### 4. 错误处理

```typescript
const engine = new LoopEngine({
  onRoleExecute: async (role, node, context) => {
    try {
      return await doExecute(role, node, context)
    } catch (error) {
      return {
        step: `role:${role.role.name}`,
        status: "error",
        error: String(error),
      }
    }
  },
})
```
