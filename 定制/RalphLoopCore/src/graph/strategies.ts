export type { Role, RoleInstance, LoopNode, LoopStrategy, Transition, TransitionCondition } from "./LoopStrategy.js"

export {
  createRole,
  createLoopNode,
  createTransition,
  createConditionalTransition,
  evaluateTransitionCondition,
} from "./LoopStrategy.js"

export { createMultiRoleInstance, createNodeWithPrompts }

import type { LoopStrategy, LoopNode, Role, RoleInstance, Transition } from "./LoopStrategy.js"

import { createRole, createLoopNode, createTransition, createConditionalTransition } from "./LoopStrategy.js"
import { DEFAULT_TIMEOUT, DEFAULT_MAX_RETRIES, DEFAULT_RETRYABLE } from "../constants.js"

export interface RoleDefinition {
  id: string
  name: string
  systemPrompt: string
  memory?: string
}

function buildRolePrompt(
  roleName: string,
  roleDescription: string,
  responsibilities: string[],
  actionKeyword: string,
  guidelines: string[],
): string {
  const responsibilityList = responsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")
  const guidelineList = guidelines.map((g) => `- ${g}`).join("\n")
  return `你是一位${roleName}，${roleDescription}。
你的职责是：
${responsibilityList}

${actionKeyword}时请：
${guidelineList}`
}

const roles: Record<string, RoleDefinition> = {
  domainExpert: {
    id: "domain_expert",
    name: "领域专家",
    systemPrompt: buildRolePrompt(
      "资深的领域专家，拥有10年以上的行业经验",
      "提供深度的领域见解和技术趋势分析，识别潜在的风险和机会，提供专业的建议和指导",
      ["提供深度的领域见解和技术趋势分析", "识别潜在的风险和机会", "提供专业的建议和指导"],
      "分析问题",
      ["结合最新的行业动态", "提供多角度的思考", "给出具体的建议而非泛泛而谈"],
    ),
    memory: "",
  },
  planner: {
    id: "planner",
    name: "规划者",
    systemPrompt: buildRolePrompt(
      "经验丰富的规划专家，擅长将复杂任务分解为可执行的步骤",
      "理解任务目标和约束条件，制定详细的执行计划，识别关键里程碑和依赖关系",
      ["理解任务目标和约束条件", "制定详细的执行计划", "识别关键里程碑和依赖关系"],
      "制定计划",
      ["使用清晰的结构化格式", "明确每个步骤的输入输出", "标注重要的时间节点", "识别潜在风险和备选方案"],
    ),
    memory: "",
  },
  executor: {
    id: "executor",
    name: "执行者",
    systemPrompt: buildRolePrompt(
      "高效的执行者，擅长按照计划快速完成任务",
      "严格按照计划执行任务，及时记录执行过程中的问题，汇报执行进度和结果",
      ["严格按照计划执行任务", "及时记录执行过程中的问题", "汇报执行进度和结果"],
      "执行任务",
      ["遵循计划中的步骤顺序", "如遇问题及时记录并继续", "保持高质量的输出"],
    ),
    memory: "",
  },
  seniorTester: {
    id: "senior_tester",
    name: "资深测试师",
    systemPrompt: buildRolePrompt(
      "资深的测试专家，擅长从多个角度发现潜在问题",
      "从多个角度分析可能出现的问题：大数据量测试、边缘条件测试、边缘逻辑测试、整体架构视角、被依赖文件分析、未来破坏性变更影响",
      ["大数据量测试", "边缘条件测试", "边缘逻辑测试", "整体架构视角", "被依赖文件分析", "未来破坏性变更影响"],
      "分析",
      ["提供具体的问题描述", "列出必须测试的关键点", "给出优先级建议"],
    ),
    memory: "",
  },
  testEngineer: {
    id: "test_engineer",
    name: "测试工程师",
    systemPrompt: buildRolePrompt(
      "专业的测试工程师，擅长编写高质量的测试用例",
      "根据问题列表编写测试用例，执行测试并记录结果，提供测试覆盖率报告",
      ["根据问题列表编写测试用例", "执行测试并记录结果", "提供测试覆盖率报告"],
      "编写测试",
      ["覆盖正常流程和异常流程", "包含边界值测试", "使用清晰的测试命名", "提供完整的测试断言"],
    ),
    memory: "",
  },
  reviewer: {
    id: "reviewer",
    name: "审核员",
    systemPrompt: buildRolePrompt(
      "严格的代码审核员，擅长发现细节问题",
      "重新执行测试验证结果，进行性能优化分析，审核代码质量和规范",
      ["重新执行测试验证结果", "进行性能优化分析", "审核代码质量和规范"],
      "审核",
      ["独立重新执行测试", "分析性能瓶颈", "检查代码风格和规范", "提供具体的改进建议"],
    ),
    memory: "",
  },
  codeReviewer: {
    id: "code_reviewer",
    name: "代码校验专家",
    systemPrompt: buildRolePrompt(
      "代码优化专家，擅长代码重构和优化",
      "基于测试和审核结果进行代码优化，重构低质量代码，优化性能和可维护性",
      ["基于测试和审核结果进行代码优化", "重构低质量代码", "优化性能和可维护性"],
      "优化",
      ["保持功能不变", "优先优化性能瓶颈", "提升代码可读性", "确保测试通过"],
    ),
    memory: "",
  },
  qualityCloser: {
    id: "quality_closer",
    name: "质量闭环终评",
    systemPrompt: buildRolePrompt(
      "质量保障专家，擅长整体质量评估",
      "对代码和预制体进行整体质量评估，识别潜在的质量风险，确保质量闭环",
      ["对代码和预制体进行整体质量评估", "识别潜在的质量风险", "确保质量闭环"],
      "评估",
      ["从多个维度进行评估", "识别关键质量问题", "提供改进建议", "确保满足质量标准"],
    ),
    memory: "",
  },
  userExperience: {
    id: "user_experience",
    name: "用户体验官",
    systemPrompt: buildRolePrompt(
      "挑剔的用户体验官，拥有独特的审美和见解",
      "从用户角度体验产品，提供真实的使用反馈，识别用户体验问题",
      ["从用户角度体验产品", "提供真实的使用反馈", "识别用户体验问题"],
      "体验",
      ["模拟真实用户场景", "关注细节和整体感受", "提供具体的反馈", "保持客观公正"],
    ),
    memory: "",
  },
}

function createRoleInstance(
  roleId: string,
  weight?: number,
  count?: number,
  personality?: string,
  customSystemPrompt?: string,
): RoleInstance {
  const role = roles[roleId]
  if (!role) {
    throw new Error(`Role ${roleId} not found`)
  }
  const systemPrompt = customSystemPrompt ?? role.systemPrompt
  return {
    role: createRole(role.id, role.name, systemPrompt, role.memory),
    weight,
    count,
    personality,
  }
}

function createNode(id: string, name: string, roleIds: string[], description?: string): LoopNode {
  return createLoopNode(
    id,
    name,
    roleIds.map((rid) => createRoleInstance(rid)),
    { timeout: DEFAULT_TIMEOUT, retryable: DEFAULT_RETRYABLE, maxRetries: DEFAULT_MAX_RETRIES },
    description,
  )
}

export interface RolePromptOverride {
  roleId: string
  systemPrompt?: string
  weight?: number
  count?: number
  personality?: string
}

function createNodeWithPrompts(
  id: string,
  name: string,
  roleOverrides: RolePromptOverride[],
  description?: string,
): LoopNode {
  return createLoopNode(
    id,
    name,
    roleOverrides.map((override) =>
      createRoleInstance(override.roleId, override.weight, override.count, override.personality, override.systemPrompt),
    ),
    { timeout: DEFAULT_TIMEOUT, retryable: DEFAULT_RETRYABLE, maxRetries: DEFAULT_MAX_RETRIES },
    description,
  )
}

function createMultiRoleInstance(
  roleId: string,
  count: number,
  weight?: number,
  personality?: string,
  customSystemPrompt?: string,
): RoleInstance[] {
  return Array.from({ length: count }, (_, i) => {
    const role = roles[roleId]
    if (!role) {
      throw new Error(`Role ${roleId} not found`)
    }
    const basePrompt = customSystemPrompt ?? role.systemPrompt
    return {
      role: createRole(
        `${role.id}_${i}`,
        `${role.name}#${i + 1}`,
        personality ? `${basePrompt}\n\n[个性特征: ${personality}]` : basePrompt,
        role.memory,
      ),
      weight,
      count: 1,
      personality,
    }
  })
}

export const defaultRalphLoopStrategy: LoopStrategy = {
  id: "ralph_loop_default",
  name: "RalphLoop默认九节点策略",
  description: "完整的开发流程循环，包含领域专家、规划、执行、测试、审核、优化和用户体验评估",
  version: "1.0.0",
  maxCycles: 100,
  entryNode: "expert",
  exitNodes: ["commit", "exit"],
  nodes: [
    createNode("expert", "领域专家意见", ["domainExpert"], "收集领域专家的深度见解和技术趋势分析"),
    createNode("plan", "规划者制定Plan", ["planner"], "制定详细的执行计划"),
    createNode("execute", "执行者执行", ["executor"], "按照计划执行任务"),
    createNode("analyze", "资深测试师分析", ["seniorTester"], "从多角度分析潜在问题"),
    createNode("test", "测试工程师测试", ["testEngineer"], "编写并执行测试用例"),
    createNode("review", "审核员审核", ["reviewer"], "重跑测试、进行性能优化"),
    createNode("optimize", "代码校验专家优化", ["codeReviewer"], "基于分析结果进行代码优化"),
    createNode("quality", "质量闭环终评", ["qualityCloser"], "整体质量和可靠性闭环评估"),
    createNode("commit", "用户体验官测评", ["userExperience"], "随机性格用户体验官测评，通过则Commit"),
    createLoopNode("exit", "流程结束", [], { timeout: 1000 }, "正常结束流程"),
  ],
  transitions: [
    createTransition("expert", "plan", { type: "always" }, "专家意见完成后进入规划"),
    createTransition("plan", "execute", { type: "always" }, "规划完成后进入执行"),
    createTransition("execute", "analyze", { type: "always" }, "执行完成后进入测试分析"),
    createTransition("analyze", "test", { type: "always" }, "分析完成后进入测试", 1),
    createConditionalTransition("analyze", "plan", "needsReplan", true, "equals", "需要重新规划", 2),
    createTransition("test", "review", { type: "always" }, "测试完成后进入审核"),
    createTransition("review", "optimize", { type: "always" }, "审核完成后进入优化"),
    createTransition("optimize", "quality", { type: "always" }, "优化完成后进入质量评估"),
    createConditionalTransition("quality", "commit", "qualityPassed", true, "equals", "质量评估通过", 1),
    createConditionalTransition("quality", "plan", "qualityPassed", false, "equals", "质量评估失败，重新规划", 2),
    createConditionalTransition("commit", "exit", "shouldExit", true, "equals", "满足退出条件", 3),
    createConditionalTransition(
      "commit",
      "expert",
      "ueApproved",
      true,
      "equals",
      "用户体验通过，回到专家意见(进行下一轮)",
      2,
    ),
    createConditionalTransition("commit", "plan", "ueApproved", false, "equals", "用户体验不通过，重新规划", 1),
  ],
}

export function getDefaultStrategy(): LoopStrategy {
  return JSON.parse(JSON.stringify(defaultRalphLoopStrategy))
}

export function createCustomStrategy(
  id: string,
  name: string,
  nodes: LoopNode[],
  transitions: Transition[],
  entryNode: string,
  exitNodes: string[],
): LoopStrategy {
  return {
    id,
    name,
    nodes,
    transitions,
    entryNode,
    exitNodes,
    maxCycles: 100,
  }
}

export { roles }
