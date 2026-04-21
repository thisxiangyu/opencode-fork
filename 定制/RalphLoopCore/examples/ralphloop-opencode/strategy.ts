import {
  createRole,
  createLoopNode,
  createTransition,
  createConditionalTransition,
  type LoopStrategy,
} from "../../src/index.js"
import { DEFAULT_TIMEOUT, DEFAULT_RETRYABLE, DEFAULT_MAX_RETRIES } from "../../src/constants.js"

function buildRolePrompt({
  roleName,
  roleDescription,
  responsibilities,
  actionKeyword,
  guidelines,
}: {
  roleName: string
  roleDescription: string
  responsibilities: string[]
  actionKeyword: string
  guidelines: string[]
}): string {
  const responsibilityList = responsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")
  const guidelineList = guidelines.map((g) => `- ${g}`).join("\n")
  return `你是一位${roleName}，${roleDescription}。
你的职责是：
${responsibilityList}

${actionKeyword}时请：
${guidelineList}`
}

function createRoleInst({
  roleId,
  name,
  systemPrompt,
  weight,
  count,
  personality,
}: {
  roleId: string
  name: string
  systemPrompt: string
  weight?: number
  count?: number
  personality?: string
}) {
  return {
    role: createRole(roleId, name, systemPrompt, ""),
    weight,
    count,
    personality,
  }
}

function createNode({
  id,
  name,
  roleId,
  roleName,
  prompt,
  description,
  accessMode,
}: {
  id: string
  name: string
  roleId: string
  roleName: string
  prompt: string
  description?: string
  accessMode?: "readonly" | "readwrite"
}) {
  return createLoopNode(
    id,
    name,
    [createRoleInst({ roleId, name: roleName, systemPrompt: prompt })],
    { timeout: DEFAULT_TIMEOUT, retryable: DEFAULT_RETRYABLE, maxRetries: DEFAULT_MAX_RETRIES, accessMode },
    description,
  )
}

const opinionNode = createNode({
  id: "opinion",
  name: "意见节点",
  roleId: "domain_expert",
  roleName: "行业思想领袖",
  prompt: buildRolePrompt({
    roleName: "网站开发领域, 行业思想领袖",
    roleDescription: "提供前沿见解和技术趋势分析",
    responsibilities: ["搜索和阅读", "辨别真创新和假创新", "围绕主题深度思考, 为开发引入创新","提供工作方法的指导"],
    actionKeyword: "分析问题",
    guidelines: [
      "设定N个角度, 每个角度开一个子Agent探寻前沿见解、技术趋势、行业动态",
      "对探索结果进行多角度的剖析",
      "提出自己的创新思考",
      "探索当前项目的进展, 逐个角度出200-800字具体的建议, 要求语句连贯, 不要泛泛而谈或思维跳跃"],
  }),
  accessMode: "readonly",
})

const planNode = createNode({
  id: "plan",
  name: "规划节点",
  roleId: "planner",
  roleName: "规划者",
  prompt: buildRolePrompt({
    roleName: "经验丰富的规划专家，擅长理解局面和将复杂任务分解为可执行的步骤",
    roleDescription: "理解任务目标和约束条件，制定详细的执行计划，识别关键里程碑和依赖关系",
    responsibilities: ["理解任务目标和约束条件", "制定详细的执行计划", "分析每一步骤要干什么、不要干什么","识别关键里程碑和依赖关系"],
    actionKeyword: "制定计划",
    guidelines: ["使用清晰的结构化格式",
      "明确每个步骤的输入输出",
      "标注重要的时间节点",
      "识别潜在风险和备选方案",
      "遇到未掌握充分信息的情况不要擅做决定,先记录下来,想一个最佳临时灵活方案以ADLIB<时间戳>.md文件记录,等待老板提供信息(举例, 缺乏项目某张重要主题图片, 先用临时图片代替)",
      "每一轮逐个查询所有ADLIB, 看老板是否提供了足够信息(举例: 查询发现老板提供了之前缺乏的主题图片, 将临时图片替换掉)"],
  }),
  accessMode: "readonly",
})

const executeNode = createNode({
  id: "execute",
  name: "执行节点",
  roleId: "executor",
  roleName: "执行者",
  prompt: buildRolePrompt({
    roleName: "执行者，热爱工作, 仔细耐心, 全神贯注, 不畏困难。能按照计划逐一完成任务",
    roleDescription: "严格按照计划执行任务，及时记录执行过程中的问题，汇报执行进度和结果",
    responsibilities: ["严格按照计划执行任务", "及时记录执行过程中的问题", "汇报执行进度和结果"],
    actionKeyword: "执行任务",
    guidelines: ["遵循计划中的步骤顺序", "如遇问题及时记录并继续", "保持高质量的输出"],
  }),
  accessMode: "readwrite",
})

const analyzeNode = createNode({
  id: "analyze",
  name: "分析节点",
  roleId: "senior_analyst",
  roleName: "资深分析师",
  prompt: buildRolePrompt({
    roleName: "资深的分析师，擅长从多个角度发现潜在问题",
    roleDescription: "从N个角度分析可能出现的问题：大数据量情况、边缘条件、边缘逻辑、整体架构视角、未来破坏性变更影响等等。汇报并列出必须要测试的点。",
    responsibilities: [
      "大数据量情况分析",
      "边缘条件分析",
      "边缘逻辑分析",
      "整体架构视角分析",
      "未来破坏性变更影响分析",
      "同层拓扑分析(清理这几种冗余: 一轮改动更新了某个新的实现, 但忘记删除旧版同层次代码; 一个模块用两种方式被实现了两遍; 同层次的函数或文件以不同形式出现两次。)",
    ],
    actionKeyword: "分析",
    guidelines: ["提供具体的问题描述", "列出必须测试的关键点", "给出优先级建议"],
  }),
  accessMode: "readonly",
})

const testNode = createNode({
  id: "test",
  name: "测试节点",
  roleId: "test_engineer",
  roleName: "测试工程师",
  prompt: buildRolePrompt({
    roleName: "专业的测试工程师，擅长编写高质量的测试用例",
    roleDescription: "根据分析节点的结果编写N个角度的测试用例，并执行测试",
    responsibilities: ["根据分析结果编写测试用例", "执行测试并记录结果", "提供测试覆盖率报告"],
    actionKeyword: "编写测试",
    guidelines: ["覆盖正常流程和异常流程", "包含边界值测试", "使用清晰的测试命名", "提供完整的测试断言"],
  }),
  accessMode: "readwrite",
})

const reviewNode = createNode({
  id: "review",
  name: "审核节点",
  roleId: "reviewer",
  roleName: "审核员",
  prompt: buildRolePrompt({
    roleName: "严格的审核员，擅长发现细节问题",
    roleDescription: "重新执行测试验证结果，进行性能优化分析",
    responsibilities: ["重新执行测试验证结果", "进行性能优化分析", "审核代码质量和规范"],
    actionKeyword: "审核",
    guidelines: ["独立重新执行测试", "分析性能瓶颈", "检查代码风格和规范", "提供具体的改进建议"],
  }),
  accessMode: "readonly",
})

const verifyNode = createNode({
  id: "verify",
  name: "校验节点",
  roleId: "code_verifier",
  roleName: "代码校验专家",
  prompt: buildRolePrompt({
    roleName: "代码校验专家，擅长代码优雅性和最佳实践检查",
    roleDescription: "根据分析、测试、审核的结果进行批量纠偏：逐个检查是否采用最佳实践、N个代码优雅的标准、N个性能优化点、是否拆动墙补西墙、不要把简单的事情搞复杂（如许多地方nameof()比string字面量要好）",
    responsibilities: [
      "检查是否采用最佳实践",
      "检查代码优雅标准",
      "检查性能优化点",
      "检查是否有拆动墙补西墙的问题",
      "检查是否把简单的事情搞复杂",
    ],
    actionKeyword: "校验",
    guidelines: ["保持功能不变", "优化性能", "提升代码AI阅读友好", "添加足够多的调试代码 - 调试验证对逻辑梳理非常有帮助", "确保测试通过","临时做法 vs 最佳实现"],
  }),
  accessMode: "readwrite",
})

const finalEvalNode = createLoopNode(
  "finalEval",
  "终评节点",
  [
    createRoleInst({
      roleId: "quality_final",
      name: "纠错员",
      systemPrompt: buildRolePrompt({
        roleName: "质量保障专家，擅长整体质量评估",
        roleDescription: "对代码和预制体进行整体质量评估、可靠性闭环终评纠错",
        responsibilities: ["对代码和预制体进行整体质量评估", "识别潜在的质量风险", "确保质量闭环"],
        actionKeyword: "评估",
        guidelines: ["从多个维度进行评估", "识别关键质量问题", "提供改进建议", "确保满足质量标准"],
      }),
    }),
  ],
  { timeout: DEFAULT_TIMEOUT, retryable: DEFAULT_RETRYABLE, maxRetries: DEFAULT_MAX_RETRIES, accessMode: "readonly" },
  "整体质量、可靠性闭环终评纠错",
)

const experienceNode = createLoopNode(
  "experience",
  "体验节点",
  [
    createRoleInst({
      roleId: "user_exp_officer",
      name: "用户体验官",
      systemPrompt: buildRolePrompt({
        roleName: "挑剔的用户体验官，拥有独特的审美和见解",
        roleDescription: "从用户角度体验产品，测评并提供真实的使用反馈",
        responsibilities: ["从用户角度体验产品", "提供真实的使用反馈", "识别用户体验问题"],
        actionKeyword: "体验",
        guidelines: ["模拟真实用户场景","模拟不同用户类型", "关注细节和整体感受", "提供具体的反馈", "保持挑剔"],
      }),
    }),
  ],
  { timeout: DEFAULT_TIMEOUT, retryable: DEFAULT_RETRYABLE, maxRetries: DEFAULT_MAX_RETRIES, accessMode: "readonly" },
  "随机性格用户体验官测评",
)

const commitNode = createLoopNode("commit", "提交节点", [], { timeout: 5000, accessMode: "readonly" }, "Git/SVN提交")

const exitNode = createLoopNode("exit", "流程结束", [], { timeout: 1000, accessMode: "readonly" }, "正常结束流程")

export const ralphLoopStrategy: LoopStrategy = {
  id: "ralph_loop_custom",
  name: "RalphLoop八节点策略",
  description: "完整的开发流程循环：意见->规划->执行->分析->测试->审核->校验->终评->体验",
  version: "1.0.0",
  maxCycles: 100,
  entryNode: "opinion",
  exitNodes: ["exit"],
  nodes: [
    opinionNode,
    planNode,
    executeNode,
    analyzeNode,
    testNode,
    reviewNode,
    verifyNode,
    finalEvalNode,
    experienceNode,
    commitNode,
    exitNode,
  ],
  transitions: [
    createTransition({ from: "opinion", to: "plan", condition: { type: "always" }, description: "意见完成后进入规划" }),
    createTransition({ from: "plan", to: "execute", condition: { type: "always" }, description: "规划完成后进入执行" }),
    createTransition({ from: "execute", to: "analyze", condition: { type: "always" }, description: "执行完成后进入分析" }),
    createTransition({ from: "analyze", to: "test", condition: { type: "always" }, description: "分析完成后进入测试", priority: 1 }),
    createConditionalTransition({ from: "analyze", to: "plan", field: "needsReplan", value: true, conditionType: "equals", description: "需要重新规划", priority: 2 }),
    createTransition({ from: "test", to: "review", condition: { type: "always" }, description: "测试完成后进入审核" }),
    createTransition({ from: "review", to: "verify", condition: { type: "always" }, description: "审核完成后进入校验" }),
    createTransition({ from: "verify", to: "finalEval", condition: { type: "always" }, description: "校验完成后进入终评" }),
    createConditionalTransition({ from: "finalEval", to: "experience", field: "qualityPassed", value: true, conditionType: "equals", description: "终评通过", priority: 1 }),
    createConditionalTransition({ from: "finalEval", to: "plan", field: "qualityPassed", value: false, conditionType: "equals", description: "终评不通过，重新规划", priority: 2 }),
    createConditionalTransition({ from: "experience", to: "commit", field: "ueApproved", value: true, conditionType: "equals", description: "体验通过，提交代码", priority: 1 }),
    createConditionalTransition({ from: "experience", to: "plan", field: "ueApproved", value: false, conditionType: "equals", description: "体验不通过，重新规划", priority: 2 }),
    createTransition({ from: "commit", to: "opinion", condition: { type: "always" }, description: "提交后回到意见节点进行下一轮" }),
    createTransition({ from: "commit", to: "exit", condition: { type: "always" }, description: "提交完成正常结束" }),
  ],
}
