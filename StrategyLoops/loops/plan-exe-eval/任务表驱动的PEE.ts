/**
 * PEE是隐式地将【决策】包含在"规划"当中的，即规划者同时承担决策职责（coo和ceo同体，类似于早期创业公司的组织形态，缺点是，对于开放式决策缺乏慢思考），
 * 适合不需要开放式决策、以封闭式决策为主的项目。
 */
import { consoleAndLogFile, LOG_DIR, logFile, LOG_COLOR, RESET } from "../../common/logger"
import { AskTo重新定位角色, 检查names重复, type IRole } from "../../common/role"
import { LoopConfig } from "../../common/loopConfig"
import { AbortError, INTERRUPTION_REASON, type InterruptedMsgContext, MSG_SOURCE } from "../../common/types"
import type { ISession } from "../../common/session"
import { linkBackend,createSession, selectOrCreateSession } from "../../common/adapters/opencodeAdapter"
import { formatDateTime, askUser } from "../../common/system"
import { initDb } from "../../common/tools/任务表/任务表CLI"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"
import { copyFile, writeFile, readFile } from "fs/promises"
import { existsSync, mkdirSync } from "fs"
import { 代码评审, 架构评审, Commit } from "./metaPrompts/评审相关"
import { 基于ReactNative和Electron技术栈, 强引用的基于TS代码的文档和注释原则} from "./metaPrompts/立项相关"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const makeAI网站开发Start_REPO_WIKI =   `
  ${强引用的基于TS代码的文档和注释原则()}

  // 完成后删除
  const 起步引导 = \`
  注意，本段是起步引导，较为口语，完成后请删除起步引导。
    makeAI是我想要的一个只属于个人的学习AI的私教网站/App。技术栈:
    ${基于ReactNative和Electron技术栈.基于ReactNative和Electron的全平台WebApp立项技术选型(true)}

    网站样式设计暂时还不太确定，试试搜索 https://github.com/thisxiangyu/awesome-design-md-fork.git 从中选最合适的md文档。
    
    makeAI 会有很多子学习模块:
    一、课程模块（按照交互式课程方式设计的私课模块，
          第一课 ReLU型一元分段函数复合的几何意义；
          第二课 ReLU型一元分段函数加权相加的几何意义；
          第三课 神经网络的基本连接形式：神经元的并联和串联；
          第四课 从最简单的几种前馈网络感受神经网络的深度和宽度带来的价值；
          第五课 多层感知机；
          第六课 反向传播、梯度下降与损失函数；
          第七...后面的还没想好，可以先搭框架，完成前几课，留拓展性口子）
    二、数学函数交互式可视化模块（类Desmos）
    三、my-benchmarks（个人项目过程中遇到的真实问题的基准测试）
    四、... 其它模块暂时没有想好，可能跟预训练、后训练有关吧，maybe
    重点: 模块之间可能会有要复用的组件（比如课程模块为了体现线性函数复合和加权求和的图像，需要复用数学函数可视化模块的窗口）

    以下是建议先执行的任务，请规划者优先考虑：
    一、${基于ReactNative和Electron技术栈.初始化开发目录结构_Git和SVN仓库创建("项目根")}
    二、${基于ReactNative和Electron技术栈.HelloWorld测试()}
    三、完成上述任务后，在本WIKI中删除上述起步引导，把REPO_WIKI.ts正式化、正规化。
  \`
  `

const config = new LoopConfig({ maxCycles: 3 , startPrompt: makeAI网站开发Start_REPO_WIKI })

/** 输出格式校验最大重试次数 */
const OUTPUT_MAX_FORMAT_RETRIES = 3

/** 单个角色打回上限（第5次打回会触发） */
const MAX_REJECTIONS_PER_ROLE = 4

/** 总打回循环上限 */
const MAX_TOTAL_REJECTION_LOOPS = 15

/**
 * 从原始文本中提取第一个平衡的 `{...}` JSON 字符串。
 * 处理字符串内的转义引号、括号，以及 JSON 前后的琐碎上下文。
 *
 * - "好的，结果是{"前情点评":"..."}，请您过目" → {"前情点评":"..."}
 * - 引号内含有 `{` 或 `}` 不会干扰深度计数
 */
function extractFirstJSON(raw: string): string | null {
  const start = raw.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === "\\") {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === "{") depth++
    if (ch === "}") {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

/**
 * 从模型原始输出中提取 JSON 对象。
 * 模型常在 JSON 前后包裹 markdown 代码块或额外说明文字。
 */
function extractJSON(raw: string): Record<string, any> | null {
  // 尝试直接解析
  try { const v = JSON.parse(raw.trim()); if (typeof v === "object" && v !== null) return v } catch {}
  // 尝试匹配 ```json ... ``` 或 ``` ... ``` 代码块
  const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlock && codeBlock[1]) {
    try { const v = JSON.parse(codeBlock[1].trim()); if (typeof v === "object" && v !== null) return v } catch {}
  }
  // 尝试匹配第一个平衡的 { ... } 对象（支持 JSON 前后有琐碎上下文）
  const candidate = extractFirstJSON(raw)
  if (candidate) {
    try { const v = JSON.parse(candidate); if (typeof v === "object" && v !== null) return v } catch {}
  }
  return null
}

// Note：角色的systemPrompt 是每轮都发的，但是其实理论上只要发一次就够了，因为“重要的事情说三遍”在大部分llm架构都未必成立。
// 后续可以试一下将systemPrompt接入一个本地模型，这样可以动态生成systemPrompt，看看效果怎么样。
// ⭐️ 某种意义上来说，远程大模型相当于一支“雇佣军”，而本地大模型负责的是“秘书/管家”这样的端侧亲密的角色，
//    届时，本地 systemPrompt 的生成应当遵循两个原则：了解模型（通过benchmark）、了解用户（通过用户数据）、了解项目（通过项目数据）。

/**
 * 【修复性动态】输出 schema。
 * 供冗余枝剪者、质保员、边缘质保员三个"检查-修复-汇报"型角色复用。
 * 主循环会据此自动注入格式要求，无需再在 knowledgeDomainPrompt 中硬编码。
 */
const 修复性动态Schema = {
  type: "object",
  required: ["一句话动态"],
  properties: {
    一句话动态: {
      type: "string",
      description: '必须严格为以下两种格式之一：\n1. 有问题且已修复："检测到问题: <问题的抽象阐述>，我已修复，以后请提起重视。"\n2. 无问题："检查无问题"',
    },
  },
}

/**
 * 【提交员动态】输出 schema。
 * 要求包含本次提交的哈希信息。
 */
const 提交员动态Schema = {
  type: "object",
  required: ["一句话动态"],
  properties: {
    一句话动态: {
      type: "string",
      description: '必须严格为以下格式之一：\n1. 有提交时："已提交，git哈希: <哈希>，svn哈希: <哈希>"（没有某类仓库则省略对应行）\n2. 无提交时："无提交，原因: <原因>"',
    },
  },
}

function validate修复性动态(raw: string): { valid: boolean; error?: string } {
  const json = extractJSON(raw)
  if (!json) return { valid: false, error: "输出中未找到有效的 JSON 对象" }
  if (typeof json.一句话动态 !== "string") return { valid: false, error: "一句话动态必须是字符串" }
  if (!json.一句话动态.trim()) return { valid: false, error: "一句话动态不能为空" }
  return { valid: true }
}

function validate提交员动态(raw: string): { valid: boolean; error?: string } {
  const json = extractJSON(raw)
  if (!json) return { valid: false, error: "输出中未找到有效的 JSON 对象" }
  if (typeof json.一句话动态 !== "string") return { valid: false, error: "一句话动态必须是字符串" }
  if (!json.一句话动态.trim()) return { valid: false, error: "一句话动态不能为空" }
  // 校验格式：必须是"已提交，git哈希: xxx"或"无提交，原因: xxx"
  const content = json.一句话动态
  const isCommit = content.startsWith("已提交，")
  const isNoCommit = content.startsWith("无提交，原因:")
  if (!isCommit && !isNoCommit) {
    return { valid: false, error: '一句话动态必须以"已提交，git哈希: xxx"或"无提交，原因: xxx"开头' }
  }
  return { valid: true }
}

export class 规划者 implements IRole {
  memory?: string | undefined
  name = "planner"
  disabledTools = ["question", "todowrite"]

  项目已提前完成sign = "<整个项目已全部提前完成>"
  确认sign = "是的"
  项目提前完成确认prompt = `检测到提前完成信号，请确认一切无误，且已符合完美主义。
          简单回复“${this.确认sign}”，将会结束。回复其它可继续。`
  确认提前完成(output: string) {
    if (output.trim() === this.确认sign) {
      return true
    }
    return false
  }
  压缩阈值 = 1000 * 330

  knowledgeDomainPrompt() { return `你是一个规划者，负责理解目标、分析当前局面、制定任务。
    你不要亲自去执行，而是派发任务，以指挥驱动。
    具体来说，每一轮都要做的事：
    1.阅读一些信息；
    2.理解当前任务表完成度；(这是统领全局的首要工具。通常而言，任务表的层次越厚实，末端任务越具体，证明对项目的理解越深入，规划质量越高。)
    3.分析上一轮执行的情况和进度，深度思考，不妥的任务需要重新规划，合格的任务要标记为完成;
    4.判断执行者是否正确理解了上一轮规划，如果偏离，需要多花一轮沟通/澄清；
    5.检查项目状态一致性，什么意思？文档或注释旧了；文件或模块隐性冗余；测试用例没同步...都要让人去fix。

    可能还有别的事，发挥想象力去做一些有助于项目推进的事，干活慢慢思考着来，多头脑风暴。
    别对自己太自信，没有把握的业务多上网查资料，汲取一手经验。但网络信息良莠不齐，也不要被ai泔水浪费时间，结合项目实际情况判断。

    任务表工具已就绪：
    - ./任务表CLI.js
    - ./任务表CLI使用说明书.md
    - 项目名即根目录名。

    熟练使用任务表，它体现了产品路线图。从全局把控项目进度、节奏、质量、深度、创新、产品体验。
    对于高层次任务，你像一个CEO，理清依赖关系、不断问自己“先做这个、后做那个是否最优？能不能拆得更细？”、把控创新探索和实际落地的比例（探索可能失败，但也有可能带来巨大收益；循规蹈矩虽然稳妥，但可能错失创新机会）、决策创新探索的结果（可用、暂时不用、弃用）；
    根据项目执行情况，动态调整任务表。
    末端是高层次任务的自然分解，对于这类任务，你像一个小队长，描述要具体、清晰、原子级、手把手、步骤化。

    末端任务应正好适合1次提交。

    【项目交付】轮次有上限。超过上限未完成有一次延期机会。如果延期: 先汇报进度，接着分析还要几轮才能全部做完、有哪些会简化或绝对不可能完成、哪些建议只先完成demo，往后迭代新版本再做完整版不迟。
    【完美主义】如果达到上限前完成（即，还有富余的轮次），继续探索创新或者优化已有实现。直到实在没有任何更优的做法了，允许通过发送${this.项目已提前完成sign}宣告提前完成。
  ` }
  systemPrompt(upstreamMsg: string) { return `一些信息：
---
${upstreamMsg}
---
【一步步来，慢思考】先尽到你本轮的职责，再【任务派发】。
-仅派发末端任务，不派发高层次任务。
-给团队成员的留言，可以是对本轮任务的补充说明，或者对目标的期望，切勿跟任务表中任务的描述重复，你应当始终以任务表传达信息优先。
` }
  accessMode: "readonly" | "writable" = "writable"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = {
    type: "object",
    required: ["前情点评", "本轮任务标题", "留言"],
    properties: {
      前情点评: { type: "string" },
      本轮任务标题: { type: "string" },
      留言: { type: "string" },
    },
  }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    const json = extractJSON(raw)
    if (!json) return { valid: false, error: `输出中未找到有效的 JSON 对象（请使用 {${this.outputSchema.required.join(", ")} } 格式）` }
    for (const field of this.outputSchema.required as string[]) {
      if (!(field in json)) return { valid: false, error: `JSON 缺少必填字段: ${field}` }
    }
    if (typeof json.前情点评 !== "string") return { valid: false, error: "前情点评 必须为字符串" }
    if (typeof json.本轮任务标题 !== "string") return { valid: false, error: "本轮任务标题 必须为字符串" }
    if (typeof json.留言 !== "string") return { valid: false, error: "留言 必须为字符串" }
    return { valid: true }
  }
}

export class 执行者 implements IRole {
  name = "executor"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return "你是一个执行者，负责执行任务。" }
  systemPrompt(upstreamMsg: string) { return `下面是一些信息：
---
${upstreamMsg}
---

请执行本轮。` }

  // Note：这些只是放在这里，但是暂时用不上，后续等有需求了再接入这些prompt，看看效果怎么样。
  fix任务反驳():string{
    return `如果你认为规划者的任务分配不合理，你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  add任务反驳():string{
    return `检查规划者的add任务是否合理（1.检查是否和已有功能冲突；2.检查是否并不优雅实现；3.其它各方面检查），你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  accessMode: "readonly" | "writable" = "writable"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}

export class 评估者 implements IRole {
  name = "evaluator"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { 
    return `你是一个评估者，负责代码Review、内容审查、指导优化。你专业而挑剔，常常能深度思考，洞察细微差错。

${代码评审()}` 
  }
  systemPrompt(upstreamMsg: string) { return `一些信息：
---
${upstreamMsg}
---
请查阅本轮的仓库变更，进行检查和评估。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = {
    type: "object",
    required: ["检查结果", "问题列表", "打回留言"],
    properties: {
      检查结果: { type: "string", enum: ["通过", "打回"] },
      问题列表: { type: "array", items: { type: "string" } },
      打回留言: { type: "string" },
    },
  }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    const json = extractJSON(raw)
    if (!json) return { valid: false, error: "输出中未找到有效的 JSON 对象" }
    if (!["通过", "打回"].includes(json.检查结果)) return { valid: false, error: "检查结果必须是'通过'或'打回'" }
    if (!Array.isArray(json.问题列表)) return { valid: false, error: "问题列表必须是数组" }
    if (typeof json.打回留言 !== "string") return { valid: false, error: "打回留言必须是字符串" }
    return { valid: true }
  }
}

export class 冗余枝剪者 implements IRole {
  name = "ScissorHands"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return `你是一个冗余枝剪者，负责寻找当前这次未提交的变更中：
    因前后逻辑覆盖、项目推进太快造成的不必要的冗余/误导性路径（代码、逻辑、文件、文件夹、资产等）

    工作流程：
    1. 先检查问题：查阅仓库变更，识别冗余代码、无用文件、误导性路径
    2. 解决问题：删除或重构冗余部分
    3. 输出动态：用一句话总结本次检测和修复情况（格式见下方输出要求）` }
  systemPrompt(upstreamMsg: string) { return `一些信息：
---
${upstreamMsg}
---

请查阅本轮的仓库变更，进行冗余枝剪。` }
  accessMode: "readonly" | "writable" = "writable"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = 修复性动态Schema
  validateOutput(raw: string): { valid: boolean; error?: string } {
    return validate修复性动态(raw)
  }
}

export class 架构师 implements IRole {
  name = "architect"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { 
    return `你是一个架构师，负责从更高明的角度审视项目。你只做重构评估，不新增功能。

${架构评审()}

【全局视角】任务表工具请查看说明书。你只允许查询，不允许增删改动。

【局部整体性视角】多查看diff（关注暂存区、工作区以及整体变动），跳出来看跨文件关系，多问自己：
  这次变动是否引入了冗余？
  是否有更优雅的实现？
  是否有更合理的分层？
  是否有更清晰的模块划分？
  有哪些未来可拓展的产品点（当前实现是否满足该点的拓展要求）？
  是否有更高明的设计？

  逐行查找：过度设计（过度设计是原罪，简单清晰是最好的）
  原则：任务表权威，你的重构不应该违背任务表的规划意图。这要求你必须小心谨慎，真实理解了任务表的路线图意图。` 
  }
  systemPrompt(upstreamMsg: string) { return `一些信息：
---
${upstreamMsg}
---

请查阅本轮的仓库变更，执行架构评估。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = {
    type: "object",
    required: ["检查结果", "架构问题", "重构建议", "打回留言"],
    properties: {
      检查结果: { type: "string", enum: ["通过", "打回"] },
      架构问题: { type: "array", items: { type: "string" } },
      重构建议: { type: "string" },
      打回留言: { type: "string" },
    },
  }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    const json = extractJSON(raw)
    if (!json) return { valid: false, error: "输出中未找到有效的 JSON 对象" }
    if (!["通过", "打回"].includes(json.检查结果)) return { valid: false, error: "检查结果必须是'通过'或'打回'" }
    if (!Array.isArray(json.架构问题)) return { valid: false, error: "架构问题必须是数组" }
    if (typeof json.重构建议 !== "string") return { valid: false, error: "重构建议必须是字符串" }
    if (typeof json.打回留言 !== "string") return { valid: false, error: "打回留言必须是字符串" }
    return { valid: true }
  }
}

export class 质保员 implements IRole {
  name = "QA"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return `你是一个质保员，负责写测试、找bug/复现bug/记录bug。

    确保覆盖率足够高。

    工作流程：
    1. 先检查问题：查阅仓库变更，检查测试覆盖率，排查bug，识别缺失的测试用例
    2. 解决问题：编写缺失的测试，修复发现的bug
    3. 输出动态：用一句话总结本次检测和修复情况（格式见下方输出要求）` }
  systemPrompt(upstreamMsg: string) { return `一些信息：
---
${upstreamMsg}
---

请查阅本轮仓库变更，检查测试覆盖率，排查bug。` }
  accessMode: "readonly" | "writable" = "writable"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = 修复性动态Schema
  validateOutput(raw: string): { valid: boolean; error?: string } {
    return validate修复性动态(raw)
  }
}

export class 边缘质保员 implements IRole {
  name = "EdgeQA"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return `你是一个边缘质保员，负责写测试、寻找质保员测试时未覆盖到的边缘情况。

    关注的边缘情况包括7类：大数据量、大参数量、多次重复操作、交叠式重复操作、覆盖式操作、特殊情况中断、长时间运行。

    不要死脑筋，有一些逻辑面对以上情况肯定不会有事。但有一些逻辑面对以上情况是高危的。针对后者设计充分必要的测试。

    确保覆盖率足够高。

    工作流程：
    1. 先检查问题：查阅仓库变更和测试文件，识别未覆盖的边缘情况
    2. 解决问题：编写边缘情况的测试用例
    3. 输出动态：用一句话总结本次检测和修复情况（格式见下方输出要求）` }
  systemPrompt(upstreamMsg: string) { return `一些信息：
---
${upstreamMsg}
---

请查阅仓库变更和测试文件，找出未覆盖的边缘情况。` }
  accessMode: "readonly" | "writable" = "writable"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = 修复性动态Schema
  validateOutput(raw: string): { valid: boolean; error?: string } {
    return validate修复性动态(raw)
  }
}

export class 压缩决策员 implements IRole {
  name = "compactor"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return `你是一个压缩决策员，负责在每轮执行前判断是否需要对执行者的会话进行压缩（compact）。
压缩的含义：将旧的对话历史总结为摘要，仅保留最近的关键上下文。好的压缩让执行者更聪明（释放无关历史，聚焦当前任务），坏的压缩因思维链断裂导致状态不一致。

你的判断依据：
1. 任务翻新度：如果本轮任务跟上一轮比是"高翻新"（7-10分：切换功能模块、不同文件、同文件中度或大型重构、思维链不需延续）→ 建议压缩
             如果本轮任务跟上一轮比是"低翻新"（1-6分：必须复用上一个任务思维链）→ 不压缩
2. Context Rot 迹象：如果会话过长或模型频繁"忘记"前文 → 建议压缩
3. 关键记忆点：如果有必须跨轮保留的关键信息（设计决策、重要思维链、未闭合的bug），请注明。只在需要压缩时注明，如果不需要压缩，则关键记忆点也应同样视作不需要。` }
  systemPrompt(upstreamMsg: string) { return `本轮的任务：
---
${upstreamMsg}
---
请判断本轮是否需要压缩执行者的会话。` } 
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = {
    type: "object",
    required: ["是否压缩", "关键记忆点"],
    properties: {
      是否压缩: { type: "boolean" },
      关键记忆点: { type: "string" },
    },
  }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    const json = extractJSON(raw)
    if (!json) return { valid: false, error: "输出中未找到有效的 JSON 对象" }
    if (typeof json.是否压缩 !== "boolean") return { valid: false, error: "是否压缩 应为 boolean" }
    if (typeof json.关键记忆点 !== "string") return { valid: false, error: "关键记忆点 应为 string" }
    return { valid: true }
  }
}

export class 提交员 implements IRole {
  name = "Commitman"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() {
    return `你是一个提交员，负责提交仓库。包括git仓库（如有）、svn仓库（如有）等等。

${Commit()}

【一句话动态要求】
提交完成后，必须输出一句话动态，格式如下（JSON对象）：
- 有提交时：{"一句话动态": "已提交，git哈希: <哈希>，svn哈希: <哈希>"}（没有某类仓库则省略对应行）
- 无提交时：{"一句话动态": "无提交，原因: <原因>"}

【重要】哈希必须从实际提交后的输出中获取，只提交了一个仓库就只写一个哈希，多个仓库都提交了必须分别写。` }
  systemPrompt(upstreamMsg: string) { return `根据现在仓库的情况决定是否提交、如何提交。\n\n输出要求：按【一句话动态要求】输出JSON对象。` }
  accessMode: "readonly" | "writable" = "writable"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = 提交员动态Schema
  validateOutput(raw: string): { valid: boolean; error?: string } {
    return validate提交员动态(raw)
  }
}

export const 策略描述 = "任务表驱动的PEE（plan-execute-eval）策略"
export const backendURL = "http://127.0.0.1:4096"

/**
 * 从中断队列中取出最新一条可派发的中断，并清空整条队列。
 *
 * ## 扫描方向：从尾到头
 * 队列可能在异步操作期间堆积多条中断事件。从尾部（最新）开始扫描，
 * 确保优先处理最近一次用户操作，而非早期已过时的中断。
 *
 * ## 可派发判定
 * 只有 pause / new_message / rollback 视为"可派发"——这三种中断
 * 需要重新定位角色并派发消息。而 aborted 类中断不在此处理：
 * aborted 在 catch (AbortError) 路径中单独处理，随后通过手工补充的
 * rollback 事件重新进入本函数进行派发。
 *
 * ## 清空队列的语义
 * 一旦找到一条有效的中断，立即清空整条队列。设计假设是：最新的
 * 可派发中断代表用户的最新意图，此前的旧中断事件已无意义。
 * 不留残余也避免了下一轮循环重复处理过时事件。
 *
 * @returns 最新可派发的中断事件，队列为空或无匹配时返回 null
 */
function takeLatestDispatchableInterruption(queue: InterruptedMsgContext[]): InterruptedMsgContext | null {
  for (let index = queue.length - 1; index >= 0; index--) {
    const item = queue[index]
    if (!item) continue
    if (!isDispatchableInterruption(item.reason)) continue
    queue.length = 0
    return item
  }
  return null
}

function isDispatchableInterruption(reason: InterruptedMsgContext["reason"]): boolean {
  return (
    reason === INTERRUPTION_REASON.pause ||
    reason === INTERRUPTION_REASON.new_message ||
    reason === INTERRUPTION_REASON.rollback
  )
}

function isCycleCompleted(nextRole: IRole, theFirstRole: IRole): boolean {
  return nextRole.name === theFirstRole.name
}

/**
 * 打回状态管理
 */
interface RejectionState {
  /** 评估者打回次数 */
  evaluatorRejections: number
  /** 架构师打回次数 */
  architectRejections: number
  /** 执行者实践次数 */
  executorPractices: number
  /** 总打回循环次数 */
  totalRejectionLoops: number
  /** 是否处于打回循环中 */
  inRejectionLoop: boolean
  /** 打回循环的起点角色（evaluator 或 architect） */
  rejectionSource?: "evaluator" | "architect"
  /** 规划者的原始信息（打回循环期间保持不变） */
  frozenPlannerInfo?: string
}

function resetRejectionState(rejectionState: RejectionState ){
    rejectionState.evaluatorRejections = 0
    rejectionState.architectRejections = 0
    rejectionState.executorPractices = 0
    rejectionState.inRejectionLoop = false
    rejectionState.rejectionSource = undefined
    rejectionState.frozenPlannerInfo = undefined
}

function createRejectionState(): RejectionState {
  return {
    evaluatorRejections: 0,
    architectRejections: 0,
    executorPractices: 0,
    totalRejectionLoops: 0,
    inRejectionLoop: false,
  }
}

/**
 * 生成打回循环的 upstream 信息
 */
function buildRejectionUpstream(state: RejectionState): string {
  const parts: string[] = ["正在协作优化中"]
  if (state.evaluatorRejections > 0) {
    parts.push(`评估者第${state.evaluatorRejections}次打回`)
  }
  if (state.architectRejections > 0) {
    parts.push(`架构师第${state.architectRejections}次打回`)
  }
  if (state.executorPractices > 0) {
    parts.push(`执行者第${state.executorPractices}次实践`)
  }
  return parts.join("  ")
}

/**
 * 将评估者/架构师的打回事件合成为一条动态写入任务表。
 *
 * 由主循环在 Role跳转策略 判定"打回"分支时自动调用，消息内容为系统生成的
 * `${roleName}打回${rejectionCount}次`，让规划者下轮能从任务表感知任务难度。
 *
 * 与 recordRoleActivity 的区别：此处的 activity message 由系统合成，角色自身
 * 的输出内容（问题列表、打回留言）不入库，仅通过 upstream 传给执行者。
 *
 * CLI 失败只写日志不抛错——动态记录属于辅助信息，不应阻断主循环。
 */
async function recordRejectionActivity(
  projectDir: string,
  taskTitle: string,
  roleName: string,
  rejectionCount: number
): Promise<void> {
  const cliPath = join(projectDir, "任务表CLI.js")
  const projectName = projectDir.split("/").pop() || "project"
  const message = `${roleName}打回${rejectionCount}次`

  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, "add-activity", "--标题", taskTitle, "--角色", roleName, "--消息", message], {
      cwd: projectDir,
      env: { ...process.env, TASKTABLE_PROJECT_NAME: projectName },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    let stderr = ''
    child.stderr?.on('data', (data) => { stderr += data.toString() })
    
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        logFile.warn(`[任务表] 记录打回动态失败: ${stderr.trim()}`)
      } else {
        logFile.info(`[任务表] 已记录打回动态: ${taskTitle} - ${message}`)
      }
      resolve()
    })
    
    child.on('error', (err) => {
      logFile.warn(`[任务表] 记录打回动态失败: ${err.message}`)
      resolve()
    })
  })
}

/**
 * 获取"检查-修复-汇报"型角色在任务表中的标准名称。
 * 
 * 三个角色的 name 属性与任务表约定的 roleName 不一致，需要映射：
 * - 冗余枝剪者.name = "ScissorHands" → 任务表 roleName = "ScissorHands"
 * - 质保员.name = "QA" → 任务表 roleName = "QA"
 * - 边缘质保员.name = "EdgeQA" → 任务表 roleName = "EdgeQA"
 */
function getActivityRoleName(currentRole: IRole): string {
  if (currentRole instanceof 冗余枝剪者) return "ScissorHands"
  if (currentRole instanceof 质保员) return "QA"
  if (currentRole instanceof 边缘质保员) return "EdgeQA"
  return currentRole.name
}

/**
 * 将角色自述的"修复性动态"写入任务表。
 *
 * 适用于冗余枝剪者 / 质保员 / 边缘质保员 / 提交员——这四个"检查-修复-汇报"型角色的 outputSchema
 * 统一约束为 `修复性动态Schema`，主循环解析出 `一句话动态` 字段后调用此函数搬运入库。
 *
 * 与 recordRejectionActivity 的区别：打回动态由系统根据评估者/架构师的判决自动合成；
 * 此处的动态由角色自己生成，系统只负责透传。
 *
 * CLI 失败只写日志不抛错——动态记录属于辅助信息，不应阻断主循环。
 */
async function recordRoleActivity(
  projectDir: string,
  taskTitle: string,
  roleName: string,
  activityMessage: string
): Promise<void> {
  const cliPath = join(projectDir, "任务表CLI.js")
  const projectName = projectDir.split("/").pop() || "project"

  return new Promise((resolve, reject) => {
    const child = spawn("node", [cliPath, "add-activity", "--标题", taskTitle, "--角色", roleName, "--消息", activityMessage], {
      cwd: projectDir,
      env: { ...process.env, TASKTABLE_PROJECT_NAME: projectName },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    let stderr = ''
    child.stderr?.on('data', (data) => { stderr += data.toString() })
    
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        logFile.warn(`[任务表] 记录角色动态失败: ${stderr.trim()}`)
      } else {
        logFile.info(`[任务表] 已记录角色动态: ${taskTitle} - ${roleName} - ${activityMessage}`)
      }
      resolve()
    })
    
    child.on('error', (err) => {
      logFile.warn(`[任务表] 记录角色动态失败: ${err.message}`)
      resolve()
    })
  })
}

/**
 * 查询任务完整信息（含所有字段），返回解析后的任务对象。
 *
 * CLI query-by-title 返回格式: { 成功: true, 数量: n, 任务: [...] }
 */
async function queryTaskByTitleFull(projectDir: string, taskTitle: string): Promise<Record<string, any> | null> {
  const cliPath = join(projectDir, "任务表CLI.js")
  const projectName = projectDir.split("/").pop() || "project"

  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, "query-by-title", "--标题", taskTitle], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TASKTABLE_PROJECT_NAME: projectName },
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (data) => { stdout += data.toString() })
    child.stderr?.on('data', (data) => { stderr += data.toString() })

    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        logFile.warn(`[任务表] 按标题查询任务失败: ${stderr.trim()}`)
        resolve(null)
        return
      }
      try {
        const result = JSON.parse(stdout)
        const tasks = result.成功 && Array.isArray(result.任务) ? result.任务 : []
        resolve(tasks.length > 0 ? tasks[0] : null)
      } catch (e) {
        logFile.warn(`[任务表] 解析任务结果失败: ${e instanceof Error ? e.message : String(e)}`)
        resolve(null)
      }
    })

    child.on('error', (err) => {
      logFile.warn(`[任务表] 按标题查询任务失败: ${err.message}`)
      resolve(null)
    })
  })
}

/**
 * 按ID查询任务完整信息（含所有字段），返回解析后的任务对象。
 * ID是稳定索引，任务改名后仍能正确查询。
 *
 * CLI query-by-id 返回格式: { 成功: true, 任务: {...} }
 */
async function queryTaskByIdFull(projectDir: string, taskId: number): Promise<Record<string, any> | null> {
  const cliPath = join(projectDir, "任务表CLI.js")
  const projectName = projectDir.split("/").pop() || "project"

  return new Promise((resolve) => {
    const child = spawn("node", [cliPath, "query-by-id", "--id", String(taskId)], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TASKTABLE_PROJECT_NAME: projectName },
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (data) => { stdout += data.toString() })
    child.stderr?.on('data', (data) => { stderr += data.toString() })

    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        logFile.warn(`[任务表] 按ID查询任务失败: ${stderr.trim()}`)
        resolve(null)
        return
      }
      try {
        const result = JSON.parse(stdout)
        resolve(result.成功 && result.任务 ? result.任务 : null)
      } catch (e) {
        logFile.warn(`[任务表] 解析任务结果失败: ${e instanceof Error ? e.message : String(e)}`)
        resolve(null)
      }
    })

    child.on('error', (err) => {
      logFile.warn(`[任务表] 按ID查询任务失败: ${err.message}`)
      resolve(null)
    })
  })
}

/**
 * 验证规划者派发的任务是否可执行。
 * 
 * 在 while 循环中反复要求规划者重新输出，直到同时满足：
 * 1. 输出通过规划者的完整 outputSchema 校验（前情点评、本轮任务标题、留言）
 * 2. 该任务存在于任务表中且未被删除
 * 3. 该任务的所有直接依赖均已完成且未被删除（依赖 JSON 损坏或非数组结构视为不通过）
 * 
 * 重试上限：最多验证 10 次响应，超限时记录严重错误并抛出异常终止，
 * 防止模型持续不合规导致无限阻塞。这不会错误放行——要么通过，要么终止。
 */
const MAX_DISPATCH_RETRIES = 10

async function validatePlannerDispatch(
  projectDir: string,
  session: ISession,
  validateOutput: (raw: string) => { valid: boolean; error?: string },
  initialResponse: string,
): Promise<{ title: string; response: string }> {
  let response = initialResponse
  let retries = 0

  while (true) {
    retries++
    if (retries > MAX_DISPATCH_RETRIES) {
      consoleAndLogFile.error(`[派发验证] 已达验证尝试上限${MAX_DISPATCH_RETRIES}次（含初响应），强制终止以避免无限阻塞`)
      throw new Error(`派发验证尝试超过${MAX_DISPATCH_RETRIES}次，规划者持续输出不合规，请人工介入检查任务表数据完整性。`)
    }

    // 先校验完整 schema，不通过直接要求重输
    const schemaCheck = validateOutput(response)
    if (!schemaCheck.valid) {
      consoleAndLogFile.warn(`[派发验证] 输出格式不符: ${schemaCheck.error}`)
      response = await session.sendMsg({
        msgSource: MSG_SOURCE.system,
        content: `你的输出格式不符合要求：${schemaCheck.error}\n\n请严格按照 JSON Schema 输出完整的 {前情点评, 本轮任务标题, 留言} 对象。`,
      }, false)
      continue
    }

    const output = extractJSON(response)
    const titleRaw = output?.本轮任务标题
    const title = typeof titleRaw === "string" ? titleRaw.trim() : ""

    if (!title) {
      consoleAndLogFile.warn(`[派发验证] 未解析到有效的本轮任务标题（${typeof titleRaw === "undefined" ? "缺失" : `类型为${typeof titleRaw}`}），要求重新输出`)
      response = await session.sendMsg({
        msgSource: MSG_SOURCE.system,
        content: `你的输出中未包含有效的"本轮任务标题"字段。请严格按照 JSON Schema 输出。`,
      }, false)
      continue
    }

    // 1. 检查任务是否存在且未被删除
    const task = await queryTaskByTitleFull(projectDir, title)
    if (!task) {
      consoleAndLogFile.warn(`[派发验证] 任务"${title}"不存在于任务表中`)
      response = await session.sendMsg({
        msgSource: MSG_SOURCE.system,
        content: `你派发的任务标题"${title}"在任务表中不存在。请检查任务表，重新输出完整的派发 JSON。`,
      }, false)
      continue
    }
    if (task.已删除) {
      consoleAndLogFile.warn(`[派发验证] 任务"${title}"已被删除，阻止派发`)
      response = await session.sendMsg({
        msgSource: MSG_SOURCE.system,
        content: `任务"${title}"已被删除，无法派发。请检查任务表，重新输出完整的派发 JSON，选择一个未被删除的任务。`,
      }, false)
      continue
    }

    // 2. 解析依赖（损坏或非数组结构均视为不通过）
    let dependencies: { 依赖任务ID?: number; 依赖任务: string; 原因: string }[] = []
    if (task.依赖) {
      let parsed: unknown
      try {
        parsed = typeof task.依赖 === 'string' ? JSON.parse(task.依赖) : task.依赖
      } catch {
        consoleAndLogFile.warn(`[派发验证] 任务"${title}"的依赖JSON解析失败，阻止派发`)
        response = await session.sendMsg({
          msgSource: MSG_SOURCE.system,
          content: `任务"${title}"的依赖数据格式异常（JSON 解析失败），可能是任务表数据损坏。请检查并修复该任务的依赖关系，或重新派发。`,
        }, false)
        continue
      }
      if (!Array.isArray(parsed)) {
        consoleAndLogFile.warn(`[派发验证] 任务"${title}"的依赖数据非数组结构，阻止派发`)
        response = await session.sendMsg({
          msgSource: MSG_SOURCE.system,
          content: `任务"${title}"的依赖数据格式异常（非数组结构），可能是任务表数据损坏。请检查并修复该任务的依赖关系，或重新派发。`,
        }, false)
        continue
      }
      dependencies = parsed as { 依赖任务ID?: number; 依赖任务: string; 原因: string }[]
    }

    // 3. 校验每个依赖项结构，必须有 依赖任务 或 依赖任务ID
    if (dependencies.length > 0) {
      const malformed = dependencies.findIndex(dep => !dep || (!dep.依赖任务?.trim() && !dep.依赖任务ID))
      if (malformed !== -1) {
        consoleAndLogFile.warn(`[派发验证] 任务"${title}"的第${malformed + 1}条依赖缺少"依赖任务"或"依赖任务ID"，阻止派发`)
        response = await session.sendMsg({
          msgSource: MSG_SOURCE.system,
          content: `任务"${title}"的第${malformed + 1}条依赖数据不完整（缺少"依赖任务"或"依赖任务ID"字段），可能是任务表数据损坏。请检查并修复，或重新派发。`,
        }, false)
        continue
      }
    }

    // 4. 检查依赖是否全部完成且未被删除（优先用ID查询，ID更稳定；无ID则用标题）
    if (dependencies.length > 0) {
      const checks = dependencies.map(dep => {
        if (dep.依赖任务ID) {
          return queryTaskByIdFull(projectDir, dep.依赖任务ID)
        }
        return queryTaskByTitleFull(projectDir, dep.依赖任务)
      })
      const results = await Promise.all(checks)

      const incompleteDeps: string[] = []
      for (let i = 0; i < dependencies.length; i++) {
        const depTask = results[i]
        const dep = dependencies[i]
        if (!dep) continue
        if (!depTask || depTask.已删除 || !depTask.是否完成) {
          incompleteDeps.push(dep.依赖任务)
        }
      }

      if (incompleteDeps.length > 0) {
        const depList = incompleteDeps.map((d: string) => `《${d}》`).join("、")
        consoleAndLogFile.warn(`[派发验证] 任务"${title}"存在${incompleteDeps.length}条未完成的依赖`)
        response = await session.sendMsg({
          msgSource: MSG_SOURCE.system,
          content: `任务"${title}"存在${incompleteDeps.length}条未完成的依赖任务：${depList}。请先完成所有依赖任务，如果依赖任务过大可考虑将依赖分解。请重新派发。`,
        }, false)
        continue
      }
    }

    consoleAndLogFile.info(`[派发验证] 任务"${title}"验证通过`)
    return { title, response }
  }
}

/**
 * 为下游角色构建完整的 upstream 信息。
 *
 * 规划者的 JSON 输出只含 {前情点评, 本轮任务标题, 留言}，
 * 但下游角色执行时还需要知道任务的描述、Tag 以及该任务依赖的前置任务链
 * （已完成了哪些前置工作、它们的动态是什么），才能充分理解上下文。
 *
 * 此函数：
 * 1. 调用任务表 CLI 的 query-dependency-chain 命令获取任务详情 + 依赖链
 * 2. 将规划者的输出与任务表信息合并为一条完整的 upstream 文本
 * 3. 依赖链默认查询 3 层，避免信息过载
 *
 * @returns 格式化后的 upstream 文本，查询失败则回退到规划者原始输出
 */
async function buildTaskUpstream(
  projectDir: string,
  plannerOutput: Record<string, any>,
): Promise<string> {
  const cliPath = join(projectDir, "任务表CLI.js")
  const projectName = projectDir.split("/").pop() || "project"
  const taskTitleRaw = plannerOutput.本轮任务标题
  const taskTitle = typeof taskTitleRaw === "string" ? taskTitleRaw.trim() : ""
  const 前情点评 = typeof plannerOutput.前情点评 === "string" ? plannerOutput.前情点评 : ""
  const 留言 = typeof plannerOutput.留言 === "string" ? plannerOutput.留言 : ""
  const maxDepth = 3

  // 基础信息（规划者输出）
  let upstream = ""
  if (前情点评) upstream += `前情点评: ${前情点评}\n\n`
  upstream += `本轮任务标题: ${taskTitle}\n`

  // 从任务表查询任务描述、Tag、依赖链
  if (!taskTitle) {
    if (留言) upstream += `留言: ${留言}\n`
    return upstream
  }

  try {
    const result = await new Promise<{ 成功: boolean; 任务?: any; 依赖链?: any[]; 消息?: string }>((resolve) => {
      const child = spawn("node", [cliPath, "query-dependency-chain", "--标题", taskTitle, "--最大层数", String(maxDepth)], {
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TASKTABLE_PROJECT_NAME: projectName },
      })

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (data) => { stdout += data.toString() })
      child.stderr?.on('data', (data) => { stderr += data.toString() })

      child.on('close', (exitCode) => {
        if (exitCode !== 0) {
          logFile.warn(`[任务表] 查询依赖链失败: ${stderr.trim()}`)
          resolve({ 成功: false, 消息: stderr.trim() })
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch (e) {
          logFile.warn(`[任务表] 解析依赖链结果失败: ${e instanceof Error ? e.message : String(e)}`)
          resolve({ 成功: false, 消息: `解析失败: ${stdout.substring(0, 200)}` })
        }
      })

      child.on('error', (err) => {
        logFile.warn(`[任务表] 查询依赖链失败: ${err.message}`)
        resolve({ 成功: false, 消息: err.message })
      })
    })

    if (result.成功 && result.任务) {
      const task = result.任务
      if (task.任务描述) upstream += `描述: ${task.任务描述}\n`
      if (task.Tag && task.Tag.length > 0) upstream += `Tag: ${task.Tag.join(", ")}\n`

      // 格式化依赖链
      if (result.依赖链 && result.依赖链.length > 0) {
        upstream += `\n依赖链（共${result.依赖链.length}层）：\n`
        for (const layer of result.依赖链) {
          upstream += `--- 第${layer.层}层 ---\n`
          for (const dep of layer.依赖) {
            upstream += `${dep.标题} | 依赖原因: ${dep.原因}\n`
            if (dep.动态 && dep.动态.length > 0) {
              // 每条动态格式化为 "角色:消息" 的紧凑形式
              const 动态摘要 = dep.动态
                .slice(-5) // 只展示最近5条动态，避免上下文过长
                .map((d: { 角色: string; 消息: string }) => `[${d.角色}: ${d.消息}]`)
                .join(" | ")
              upstream += `  动态: ${动态摘要}\n`
              if (dep.动态.length > 5) {
                upstream += `  (..还有${dep.动态.length - 5}条更早的动态)\n`
              }
            } else {
              upstream += `  动态: 暂无\n`
            }
          }
        }
      } else {
        upstream += `\n依赖链: 无（无前置依赖任务）\n`
      }
    } else {
      // 查询失败（非致命），但仍然附上基础信息
      upstream += `\n(依赖链查询失败: ${result.消息 || "未知错误"}，已回退到基础信息)\n`
    }
  } catch (e) {
    upstream += `\n(依赖链查询异常: ${e instanceof Error ? e.message : String(e)}，已回退到基础信息)\n`
  }

  if (留言) upstream += `\n留言: ${留言}\n`

  logFile.info(`[buildTaskUpstream] 已构建 upstream (${upstream.length} 字符)`)
  return upstream
}



export async function main(): Promise<void> {

  let 规划者instance = new 规划者() as IRole
  let 执行者instance = new 执行者() as IRole
  let 评估者instance = new 评估者() as IRole
  let 压缩决策员instance = new 压缩决策员() as IRole
  let 冗余枝剪者instance = new 冗余枝剪者() as IRole
  let 架构师instance = new 架构师() as IRole
  let 质保员instance = new 质保员() as IRole
  let 边缘质保员instance = new 边缘质保员() as IRole
  let 提交员instance = new 提交员() as IRole

  const allRoles = 检查names重复([
    规划者instance, 
    压缩决策员instance, 
    执行者instance, 
    评估者instance,
    冗余枝剪者instance,
    架构师instance,
    质保员instance,
    边缘质保员instance,
    提交员instance
  ]) as IRole[]
  let currentRole = 规划者instance

  // 打回状态管理
  const rejectionState = createRejectionState()
  let currentTaskTitle = "" // 当前任务标题

    /**
   * 完整大循环的跳转策略：
   * 规划者 → 压缩决策员 → 执行者 → 评估者 → (打回执行者 OR 冗余枝剪者)
   * → 冗余枝剪者 → 架构师 → (打回执行者 OR 质保员)
   * → 质保员 → 边缘质保员 → 提交员 → 规划者
   * 
   * 打回逻辑：
   * - 评估者打回：执行者 → 评估者 → (继续打回 OR 通过到冗余枝剪者)
   * - 架构师打回：执行者 → 评估者 → 冗余枝剪者 → 架构师 → (继续打回 OR 通过到质保员)
   */
  const Role跳转策略: (current: IRole, lastResponse: string) => IRole = (r, response) => {
    // 评估者的分支判断
    if(r instanceof 评估者) {
      const evalOutput = extractJSON(response)
      if (evalOutput?.检查结果 === "打回") {
        // 评估者打回
        rejectionState.evaluatorRejections++
        rejectionState.executorPractices++
        rejectionState.totalRejectionLoops++
        rejectionState.inRejectionLoop = true
        rejectionState.rejectionSource = "evaluator"
        
        logFile.info(`[评估者打回] 第${rejectionState.evaluatorRejections}次，总循环${rejectionState.totalRejectionLoops}次`)
        
        // 检查打回上限
        if (rejectionState.evaluatorRejections > MAX_REJECTIONS_PER_ROLE) {
          consoleAndLogFile.error(`[打回上限] 评估者打回超过${MAX_REJECTIONS_PER_ROLE}次，强制通过`)
          rejectionState.inRejectionLoop = false
          return 冗余枝剪者instance
        }
        if (rejectionState.totalRejectionLoops > MAX_TOTAL_REJECTION_LOOPS) {
          consoleAndLogFile.error(`[打回上限] 总打回循环超过${MAX_TOTAL_REJECTION_LOOPS}次，程序退出`)
          throw new Error("打回循环超过上限，程序终止")
        }
        
        return 执行者instance
      } else {
        // 评估者通过
        if (rejectionState.rejectionSource === "evaluator") {
          // 结束评估者打回循环
          rejectionState.inRejectionLoop = false
          rejectionState.rejectionSource = undefined
          logFile.info(`[评估者通过] 结束打回循环`)
        }
        return 冗余枝剪者instance
      }
    }
    
    // 架构师的分支判断
    if(r instanceof 架构师) {
      const archOutput = extractJSON(response)
      if (archOutput?.检查结果 === "打回") {
        // 架构师打回
        rejectionState.architectRejections++
        rejectionState.executorPractices++
        rejectionState.totalRejectionLoops++
        rejectionState.inRejectionLoop = true
        rejectionState.rejectionSource = "architect"
        
        logFile.info(`[架构师打回] 第${rejectionState.architectRejections}次，总循环${rejectionState.totalRejectionLoops}次`)
        
        // 检查打回上限
        if (rejectionState.architectRejections > MAX_REJECTIONS_PER_ROLE) {
          consoleAndLogFile.error(`[打回上限] 架构师打回超过${MAX_REJECTIONS_PER_ROLE}次，强制通过`)
          rejectionState.inRejectionLoop = false
          return 质保员instance
        }
        if (rejectionState.totalRejectionLoops > MAX_TOTAL_REJECTION_LOOPS) {
          consoleAndLogFile.error(`[打回上限] 总打回循环超过${MAX_TOTAL_REJECTION_LOOPS}次，程序退出`)
          throw new Error("打回循环超过上限，程序终止")
        }
        
        return 执行者instance
      } else {
        // 架构师通过
        if (rejectionState.rejectionSource === "architect") {
          // 结束架构师打回循环
          rejectionState.inRejectionLoop = false
          rejectionState.rejectionSource = undefined
          logFile.info(`[架构师通过] 结束打回循环`)
        }
        return 质保员instance
      }
    }
    
    // 正常流程跳转
    if(r instanceof 规划者) {
      return 压缩决策员instance
    }
    if(r instanceof 压缩决策员) {
      return 执行者instance
    }
    if(r instanceof 执行者) {
      // 执行者完成后，根据打回状态决定下一步
      if (rejectionState.rejectionSource === "architect") {
        // 架构师打回循环：执行者 → 评估者 → 冗余枝剪者 → 架构师
        return 评估者instance
      } else {
        // 正常流程或评估者打回循环：执行者 → 评估者
        return 评估者instance
      }
    }
    if(r instanceof 冗余枝剪者) {
      return 架构师instance
    }
    if(r instanceof 质保员) {
      return 边缘质保员instance
    }
    if(r instanceof 边缘质保员) {
      return 提交员instance
    }
    if(r instanceof 提交员) {
      // 提交员完成，重置打回状态，回到规划者
      resetRejectionState(rejectionState)
      return 规划者instance
    }
    
    throw new Error(`未知角色类型: name="${r.name}", 无法跳转。constructor=${r.constructor?.name ?? "unknown"}`)
  }

  const interruptionQueue: InterruptedMsgContext[] = []

  consoleAndLogFile.infoC(LOG_COLOR.GREEN, `[${策略描述}][预备] 总圈数=${config.maxCycles}`)
  consoleAndLogFile.info(`服务器URL: ${backendURL}`)
  consoleAndLogFile.info(`日志目录: ${LOG_DIR}`)
  consoleAndLogFile.info(`后端: ${linkBackend(backendURL)}`)

  const entrySession: ISession = await selectOrCreateSession(规划者instance)
  const projectDir = entrySession.directory

  // 【任务表部署】将任务表CLI工具和说明书拷贝到项目目录，并在项目目录下初始化任务表数据库
  const projectName = projectDir.split("/").pop() || "project"
  const toolsDir = join(__dirname, "../../common/tools/任务表")
  const cliDestJs = join(projectDir, "任务表CLI.js")
  const readmeSource = join(toolsDir, "README.md")
  const readmeDest = join(projectDir, "任务表CLI使用说明书.md")
  const repoWikiPath = join(projectDir, "REPO_WIKI.ts")
  const strategyNodeModules = join(__dirname, "../../node_modules")
  const betterSqliteSrc = join(strategyNodeModules, "better-sqlite3")
  const betterSqliteDest = join(projectDir, "node_modules", "better-sqlite3")

  // REPO_WIKI.ts：已存在则跳过
  if (existsSync(repoWikiPath)) {
    consoleAndLogFile.info(`[初始环境] REPO_WIKI.ts 已存在，跳过`)
  } else {
    await writeFile(repoWikiPath, "/// 请全文阅读本WIKI\n" + config.startPrompt, 'utf-8')
    logFile.info(`[项目] 起始文档已创建 -> ${repoWikiPath}`)
  }

  // 任务表CLI.js：已存在则询问用户
  if (existsSync(cliDestJs)) {
    const answer = await askUser(`[初始环境] 任务表CLI.js 已存在，是否覆盖？(y/n): `)
    if (answer.toLowerCase() !== 'n') {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("npx", ["tsx", join(toolsDir, "任务表Build.ts"), cliDestJs], {
          cwd: toolsDir,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let stderr = ''
        child.stderr?.on('data', (data) => { stderr += data.toString() })
        child.on('close', (code) => {
          if (code === 0) {
            logFile.info(`[初始环境] CLI已覆盖 -> ${cliDestJs}`)
            resolve()
          } else {
            const msg = `[初始环境] CLI编译失败 (exit=${code}): ${stderr.trim()}`
            consoleAndLogFile.error(msg)
            reject(new Error(msg))
          }
        })
        child.on('error', (err) => {
          const msg = `[初始环境] CLI编译失败: ${err.message}`
          consoleAndLogFile.error(msg)
          reject(new Error(msg))
        })
      })
    } else {
      consoleAndLogFile.info(`[初始环境] 跳过任务表CLI.js`)
    }
  } else {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npx", ["tsx", join(toolsDir, "任务表Build.ts"), cliDestJs], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stderr = ''
      child.stderr?.on('data', (data) => { stderr += data.toString() })
      child.on('close', (code) => {
        if (code === 0) {
          logFile.info(`[初始环境] CLI已编译 -> ${cliDestJs}`)
          resolve()
        } else {
          const msg = `[初始环境] CLI编译失败 (exit=${code}): ${stderr.trim()}`
          consoleAndLogFile.error(msg)
          reject(new Error(msg))
        }
      })
      child.on('error', (err) => {
        const msg = `[初始环境] CLI编译失败: ${err.message}`
        consoleAndLogFile.error(msg)
        reject(new Error(msg))
      })
    })
  }

  // 任务表CLI使用说明书.md：已存在则询问用户
  if (existsSync(readmeDest)) {
    const answer = await askUser(`[初始环境] 任务表CLI使用说明书.md 已存在，是否覆盖？(y/n): `)
    if (answer.toLowerCase() !== 'n') {
      await copyFile(readmeSource, readmeDest)
      logFile.info(`[初始环境] 说明书已覆盖 -> ${readmeDest}`)
    } else {
      consoleAndLogFile.info(`[初始环境] 跳过任务表CLI使用说明书.md`)
    }
  } else {
    await copyFile(readmeSource, readmeDest)
    logFile.info(`[初始环境] 说明书已拷贝 -> ${readmeDest}`)
  }

  // node_modules/better-sqlite3：已存在则询问用户
  if (existsSync(betterSqliteDest)) {
    const answer = await askUser(`[初始环境] node_modules/better-sqlite3 已存在，是否覆盖？(y/n): `)
    if (answer.toLowerCase() !== 'n') {
      mkdirSync(join(betterSqliteDest, "lib"), { recursive: true })
      mkdirSync(join(betterSqliteDest, "build", "Release"), { recursive: true })
      await copyFile(join(betterSqliteSrc, "package.json"), join(betterSqliteDest, "package.json"))
      await copyFile(join(betterSqliteSrc, "lib", "index.js"), join(betterSqliteDest, "lib", "index.js"))
      await copyFile(join(betterSqliteSrc, "lib", "database.js"), join(betterSqliteDest, "lib", "database.js"))
      await copyFile(join(betterSqliteSrc, "lib", "sqlite-error.js"), join(betterSqliteDest, "lib", "sqlite-error.js"))
      await copyFile(join(betterSqliteSrc, "lib", "util.js"), join(betterSqliteDest, "lib", "util.js"))
      await copyFile(join(betterSqliteSrc, "build", "Release", "better_sqlite3.node"), join(betterSqliteDest, "build", "Release", "better_sqlite3.node"))
      logFile.info(`[初始环境] better-sqlite3 已覆盖 -> ${betterSqliteDest}`)
    } else {
      consoleAndLogFile.info(`[初始环境] 跳过 node_modules/better-sqlite3`)
    }
  } else {
    mkdirSync(join(betterSqliteDest, "lib"), { recursive: true })
    mkdirSync(join(betterSqliteDest, "build", "Release"), { recursive: true })
    await copyFile(join(betterSqliteSrc, "package.json"), join(betterSqliteDest, "package.json"))
    await copyFile(join(betterSqliteSrc, "lib", "index.js"), join(betterSqliteDest, "lib", "index.js"))
    await copyFile(join(betterSqliteSrc, "lib", "database.js"), join(betterSqliteDest, "lib", "database.js"))
    await copyFile(join(betterSqliteSrc, "lib", "sqlite-error.js"), join(betterSqliteDest, "lib", "sqlite-error.js"))
    await copyFile(join(betterSqliteSrc, "lib", "util.js"), join(betterSqliteDest, "lib", "util.js"))
    await copyFile(join(betterSqliteSrc, "build", "Release", "better_sqlite3.node"), join(betterSqliteDest, "build", "Release", "better_sqlite3.node"))
    logFile.info(`[初始环境] better-sqlite3 已拷贝 -> ${betterSqliteDest}`)
  }

  try {
    initDb(projectName, projectDir)
    logFile.info(`[初始环境] 数据库初始化成功`)
    consoleAndLogFile.info(`[初始环境] 数据库初始化成功`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    consoleAndLogFile.error(`[初始环境] 数据库初始化失败: ${message}，可能已存在同名项目数据库`)
  }

  entrySession.onInterruption((msg) => {
    interruptionQueue.push(msg)
    logFile.info(`[检测到中断] reason=${msg.reason}`)
  })

  /**
   * 按需获取角色专属 session（懒加载）
   * 每个 role 维护自己的 session 实例，实现状态隔离
   * 新创建的 session 会注册中断监听，事件统一推送到全局队列
   */
  const getOrCreateSession = async (role: IRole): Promise<ISession> => {
    if (role.currentSessionInstance) {
      return role.currentSessionInstance
    }
    const session = await createSession(role, `[${role.name}] 会话开始于${formatDateTime({ isoString: new Date().toISOString(), showYear: false, showPeriod: true, showTime: true ,showSeconds: false})}`, projectDir)
    role.currentSessionInstance = session
    session.onInterruption((msg) => {
      interruptionQueue.push(msg)
      logFile.info(`[检测到中断] reason=${msg.reason}`)
    })
    return session
  }

  规划者instance.currentSessionInstance = entrySession

  try {
    let cycle = 0
    let lastResponse = ""
    let lastResponseEmptyCount = 0 // 连续收到空响应的次数
    const knowledgeSent = new Set<string>()

    /**
     * 是否在发送消息前压缩会话历史。
     *
     * 决策来源：
     * - 规划者：根据 session token 用量与压缩阈值的比较自动触发
     * - 执行者：由压缩决策员（LLM）在每轮中动态决定
     * - 其它角色（评估者等）：跟随执行者的压缩决策
     */
    let compactBeforeSend = false
    /** 记录执行节点本轮是否压缩，供跟随角色同步决策 */
    let executorDidCompact = false

    while (cycle < config.maxCycles) {
      // 【中断消费语义】
      // 这里统一消费四种中断语义：
      // - pause / new_message / rollback：允许用户决定消息应该派发给哪个角色
      // - aborted：说明当前生成已被终止，不在循环顶部处理，而是在 catch AbortError 后进入等待恢复路径
      //
      // 【中断来源角色确定】
      // 使用 interrupt.roleName（而非循环变量 currentRole）来锚定触发中断的 session，
      // 这样确保每个 role 的 session 状态独立管理，不会因角色切换而混乱
      const interrupt = takeLatestDispatchableInterruption(interruptionQueue)
      if (interrupt) {
        // interrupt.roleName 表示产生中断的 session 所属 role，
        // 只用于定位和清理中断来源；默认派发目标仍由角色跳转策略决定。
        const interruptedRole = allRoles.find((r) => r.name === interrupt.roleName)
        if (!interruptedRole) {
          logFile.error(`[中断处理] 未知roleName="${interrupt.roleName}"，所有角色名=${allRoles.map(r => r.name).join(", ")}，receivedMessage="${interrupt.receivedMessage.substring(0, 50)}"`)
          throw new Error(`中断来源角色不存在: ${interrupt.roleName}`)
        }

        logFile.info(`[中断处理] reason=${interrupt.reason}, 来源角色=${interruptedRole.name}`)
        const fallbackRole = Role跳转策略(interruptedRole, lastResponse)
        logFile.info(`[派发决策] interruptRole=${interrupt.roleName}, fallbackRole=${fallbackRole.name}`)
        currentRole = await AskTo重新定位角色(allRoles, fallbackRole, interrupt)

        // 要清理的是触发中断的那个 role 的 session，不是 currentRole 的
        if (interruptedRole.currentSessionInstance) {
          interruptedRole.currentSessionInstance.clearInterruption()
        }

        // 直到处理完中断，才进入下一步，否则返回去继续消费中断事件
        continue
      }

      // 没有待处理的中断，可以获取当前 role 的 session 并执行任务了
      const session = await getOrCreateSession(currentRole)
      logFile.info(`[第${cycle + 1}圈] 当前角色=${currentRole.name}, 会话状态=${session.getReceiveState()}`)

      consoleAndLogFile.infoC(LOG_COLOR.GREEN, `>>> ${currentRole.name}`)
      session.setCurrentContext(currentRole.name)

      // 【规划者压缩】基于 session token 用量与阈值比较，自动触发
      if (currentRole instanceof 规划者) {
        const usage = session.getTokenUsage()
        const threshold = (currentRole as 规划者).压缩阈值
        if (usage?.input !== undefined && usage.input >= threshold) {
          compactBeforeSend = true
          logFile.info(`[规划者] token用量=${usage.input} >= 阈值=${threshold}，触发压缩`)
        }
      }

      // 【跟随压缩】非核心决策角色，跟随执行节点的压缩决策
      if (
        executorDidCompact &&
        currentRole !== 规划者instance &&
        currentRole !== 压缩决策员instance &&
        currentRole !== 执行者instance
      ) {
        compactBeforeSend = true
        logFile.info(`[${currentRole.name}] 跟随执行节点压缩`)
      }

      try {
        // 【消息内容策略】
        // - 首次激活领域知识（knowledgeSent 未命中）：发送 knowledgeDomainPrompt 和 systemPrompt
        // - compactHistory 时：压缩掉了历史，需要重新激活领域知识，发送 knowledgeDomainPrompt
        // - 策略首个角色首次开始，发送启动提示词
        // - 其他情况：用上一个角色的 response 作为 upstreamMsg，发送 systemPrompt(upstreamMsg)
        const shouldActivateKnowledge = !knowledgeSent.has(currentRole.name) || compactBeforeSend

        let msgToBeSent: string

        const now = new Date()
        const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
        const roundInfo = `当前时间：${timeStr}，第${cycle + 1}轮/共${config.maxCycles}轮\n\n`

        // 【构建 upstream 消息】根据打回状态和角色类型
        let upstreamMsg = lastResponse
        
        if (rejectionState.inRejectionLoop) {
          // 打回循环中
          if (currentRole instanceof 执行者) {
            // 执行者：使用打回留言
            upstreamMsg = lastResponse
          } else if (
            currentRole instanceof 评估者 || 
            currentRole instanceof 架构师
          ) {
            // 评估者/架构师：使用打回循环信息
            upstreamMsg = buildRejectionUpstream(rejectionState)
          } else {
            // 其他角色（冗余枝剪者等）：使用打回循环信息
            upstreamMsg = buildRejectionUpstream(rejectionState)
          }
        } else {
          // 正常流程：使用规划者的原始信息或上一个角色的输出
          if (rejectionState.frozenPlannerInfo && currentRole !== 规划者instance) {
            upstreamMsg = rejectionState.frozenPlannerInfo
          } else {
            upstreamMsg = lastResponse
          }
        }

        if (shouldActivateKnowledge) {
          if (!upstreamMsg?.trim()) // 空、null、undefined、纯空格
          {
            lastResponseEmptyCount++
            upstreamMsg = `暂无(第${lastResponseEmptyCount}次空缺上游消息)，请你自行决断本轮行为。`;            
          }else{
            lastResponseEmptyCount = 0 // 重置计数
          }
          msgToBeSent = currentRole.knowledgeDomainPrompt()+`\n${currentRole.systemPrompt(upstreamMsg)}`
          knowledgeSent.add(currentRole.name)
        } else {
          msgToBeSent = roundInfo + currentRole.systemPrompt(upstreamMsg)
        }

        // 对结构化输出角色，注入格式要求
        if (currentRole.outputSchema.type !== "text") {
          msgToBeSent += `\n\n【输出格式】请严格按照 JSON Schema 输出：\n\`\`\`json\n${JSON.stringify(currentRole.outputSchema, null, 2)}\n\`\`\`\n`
        }

        // 【输出校验】发送后校验输出格式，不通过则同 session 内重试（最多 MAX_FORMAT_RETRIES 次）。
        // 重试和首次发送在同一个 try 块中——任何一次 sendMsg 抛出 AbortError 都会进入中断恢复路径。
        let response = ""
        let validation: { valid: boolean; error?: string } = { valid: false, error: "未发送" }
        let 提前完成确认中 = false // 防止重复确认
        let 提前完成已确认 = false // 确认后跳过派发验证

        for (let retry = 0; retry <= OUTPUT_MAX_FORMAT_RETRIES; retry++) {
          if (retry > 0) {
            msgToBeSent = `上一次输出格式不符合要求：${validation.error}\n\n请严格按照格式要求，重新组织输出。`
          }

          consoleAndLogFile.info(`\x1b[32m[发送>>]\x1b[0m "${msgToBeSent.substring(0, 60)}..."`)
          response = await session.sendMsg({
            msgSource: MSG_SOURCE.system,
            content: msgToBeSent,
          }, retry === 0 ? compactBeforeSend : false) // 仅首次压缩，重试不重复压缩

          consoleAndLogFile.info(`\x1b[32m[<<收到]\x1b[0m "${response.substring(0, 80)}..."`)

          // 【项目提前完成检测】仅对规划者角色，首次输出即检测是否含提前完成sign
          if (!提前完成确认中 && currentRole instanceof 规划者) {
            const 规划者角色 = currentRole as 规划者
            if (response.includes(规划者角色.项目已提前完成sign)) {
              consoleAndLogFile.info(`[提前完成检测] 规划者输出含完成信号`)
              const confirm = await session.sendMsg({
                msgSource: MSG_SOURCE.system,
                content: 规划者角色.项目提前完成确认prompt,
              }, false)
              if (规划者角色.确认提前完成(confirm)) {
                consoleAndLogFile.info(`[提前完成] 确认项目已全部完成，跳出循环`)
                validation.valid = true
                提前完成已确认 = true
                cycle = config.maxCycles // 触发外层while循环结束
                break // 跳出验证重试循环
              }
              consoleAndLogFile.info(`[提前完成] 模型未肯定回应，继续往下跑`)
              提前完成确认中 = true
            }
          }

          validation = currentRole.validateOutput(response)
          if (validation.valid) break

          if (retry < OUTPUT_MAX_FORMAT_RETRIES) {
            logFile.info(`[校验] 格式不符，${retry + 1}/${OUTPUT_MAX_FORMAT_RETRIES}次重试: ${validation.error}`)
            consoleAndLogFile.warn(`[${currentRole.name}] 格式不符: ${validation.error}`)
          }
        }

        if (!validation.valid) {
          consoleAndLogFile.warn(`[${currentRole.name}] 重试${OUTPUT_MAX_FORMAT_RETRIES}次后仍未通过格式校验，系统接受原始输出。误差: ${validation.error}`)
        }

        logFile.info(`<<< ${currentRole.name} 完成`)
        
        // 【规划者派发验证 + 构建完整 upstream】（提前完成已确认则跳过）
        if (currentRole instanceof 规划者 && !提前完成已确认) {
          const dispatch = await validatePlannerDispatch(projectDir, session, 规划者instance.validateOutput.bind(规划者instance), response)
          currentTaskTitle = dispatch.title
          response = dispatch.response
          
          // 构建完整 upstream（含任务描述、Tag、依赖链），保存用于下游角色和打回循环
          // 只在非打回循环时更新——打回期间 upstream 冻结，避免重复查询污染上下文
          if (!rejectionState.inRejectionLoop && currentTaskTitle) {
            const latestOutput = extractJSON(response)
            const fullUpstream = await buildTaskUpstream(projectDir, latestOutput || { 本轮任务标题: currentTaskTitle })
            rejectionState.frozenPlannerInfo = fullUpstream
            consoleAndLogFile.info(`[upstream] 已构建完整上游信息（含依赖链），${fullUpstream.length} 字符`)
          }
        }
        
        // 【评估者/架构师打回后记录动态】
        if (currentRole instanceof 评估者) {
          const evalOutput = extractJSON(response)
          if (evalOutput?.检查结果 === "打回" && currentTaskTitle) {
            await recordRejectionActivity(projectDir, currentTaskTitle, "evaluator", rejectionState.evaluatorRejections)
          }
        }
        if (currentRole instanceof 架构师) {
          const archOutput = extractJSON(response)
          if (archOutput?.检查结果 === "打回" && currentTaskTitle) {
            await recordRejectionActivity(projectDir, currentTaskTitle, "architect", rejectionState.architectRejections)
          }
        }
        
        // 【冗余枝剪者/质保员/边缘质保员/提交员动态记录】
        //
        // 设计思路：
        // 1. 这四个角色的 outputSchema 统一为 `修复性动态Schema`，要求输出 {"一句话动态": "..."}
        // 2. 主循环的通用校验机制（L1200-L1230）已经对所有结构化输出角色进行了最多 3 次重试
        // 3. 能走到这里的 response，要么已通过 validate 校验，要么是 3 次重试后系统"接受原始输出"放行
        // 4. 因此这里只需简单判断：解析成功就记录，解析失败就跳过（不再额外重试）
        // 5. 动态记录属于辅助信息，不应为此再消耗 1 轮 tokens——信任通用机制已经尽力
        //
        // 与评估者/架构师打回动态的区别：
        // - 打回动态：由系统根据分支路由自动合成消息（"evaluator打回N次"）
        // - 此处动态：由角色自己生成内容，系统只负责解析和搬运
        if (
          currentRole instanceof 冗余枝剪者 ||
          currentRole instanceof 质保员 ||
          currentRole instanceof 边缘质保员 ||
          currentRole instanceof 提交员
        ) {
          const roleOutput = extractJSON(response)
          if (roleOutput?.一句话动态 && currentTaskTitle) {
            // 解析成功，记录动态
            const activityMessage = roleOutput.一句话动态
            const roleName = getActivityRoleName(currentRole)

            await recordRoleActivity(projectDir, currentTaskTitle, roleName, activityMessage)
            consoleAndLogFile.info(`[${roleName}] 动态已记录: ${activityMessage}`)
          } else {
            // 解析失败（通用机制已重试 3 次），跳过记录
            // 可能原因：模型持续输出错误格式，或 currentTaskTitle 为空（规划者未派发任务）
            logFile.warn(`[${currentRole.name}] 输出未包含有效的"一句话动态"字段，跳过动态记录`)
          }
        }

        // 【提交员完成后提取提交信息】
        if (currentRole instanceof 提交员) {
          // 提取提交信息，作为下一轮规划者的 upstream
          // 简化处理：直接使用提交员的输出作为提交信息
          const commitInfo = `[上一轮提交信息]\n${response.substring(0, 500)}${response.length > 500 ? "..." : ""}`
          lastResponse = commitInfo
          logFile.info(`[提交员] 提交信息已提取，将返还给规划者`)
        } else {
          lastResponse = response
        }

        // 压缩决策员输出后：解析其 { 是否压缩, 关键记忆点 } 以决定是否对下一角色（执行者）触发
        if (currentRole === 压缩决策员instance) {
          const compactorOutput = extractJSON(response)
          compactBeforeSend = compactorOutput?.是否压缩 === true
          if (compactBeforeSend) {
            consoleAndLogFile.info(`[压缩决策] 请求压缩执行者会话。`)
          }
        }
        // 执行者完成后：记录本次是否压缩，供跟随角色同步；复位标记避免影响压缩决策员自身
        if (currentRole === 执行者instance) {
          executorDidCompact = compactBeforeSend
          compactBeforeSend = false
        }

        const nextRole = Role跳转策略(currentRole, response)

        // 硬规则: 提前闭环回到首角色(规划者)，算一圈
        // 没回到首角色，不算一圈
        // 也就是说, 当前策略是"闭环First"策略
        if (isCycleCompleted(nextRole, 规划者instance)) {
          cycle++
          consoleAndLogFile.info(`[当前循环: 第${cycle + 1}圈]`)
          // 新一轮开始，重置跟随压缩标记
          executorDidCompact = false
          compactBeforeSend = false
        }

        currentRole = nextRole // 切换角色

      } catch (error) {

        if (!(error instanceof AbortError)) {
          throw error
        }

        logFile.info(`[暂停] 当前角色=${currentRole.name}, state=${session.getReceiveState()}`)
        logFile.info(`[暂停] 用户已中止消息, 等待下一次消息发送...`)

        try {
          const resumedResponse = await session.waitForUserMessage()
          logFile.info(`[恢复后收到] ${resumedResponse.substring(0, 80)}...`)
          logFile.info(`[暂停] 收到新的用户引导与模型恢复结果，回到派发阶段`)
          // 不在这里直接推进到下一个角色。
          // waitForUserMessage 期间会先收到 new_message，再收到 rollback。
          // 顶部循环会从 interruptionQueue 中取最新可派发中断统一处理。
          /**
           * 手工补充 rollback 事件
           * roleName 必须是被中断的那个 role（currentRole），不是"恢复后应切换到的角色"
           * 这样顶部循环才能正确清理：interruptedRole.currentSessionInstance.clearInterruption()
           * "恢复后默认派发给谁"由 Role跳转策略(interruptedRole) 计算
           */
          if (!interruptionQueue.some((item) => item.reason === INTERRUPTION_REASON.rollback)) {
            interruptionQueue.push({
              roleName: currentRole.name,
              beforeMessage: lastResponse || "（无）", // 记录恢复前的最后一条消息
              receivedMessage: resumedResponse,
              timestamp: new Date(),
              reason: INTERRUPTION_REASON.rollback,
            })
          }
          
          lastResponse = resumedResponse // 更新 lastResponse，确保恢复后消息能正确传递给下游
          continue

        } catch (waitError) {
          const err = waitError as Error
          logFile.info(`[暂停] 等待恢复结束: ${err.message}`)
          break
        }
      }
    }
  } finally {
    // 释放所有 role 的 session 资源，避免连接泄漏
    for (const role of allRoles) {
      if (role.currentSessionInstance) {
        await role.currentSessionInstance.disposeAsync()
      }
    }
    consoleAndLogFile.infoC(LOG_COLOR.GREEN, "[策略结束]")
  }
}

if (process.argv[1] === __filename) {
  initDb(process.env.任务表项目 ?? "default")
  main().catch((error) => {
    const err = error as any
    consoleAndLogFile.error("主函数错误:", err?.stack ?? err?.message ?? JSON.stringify(error))
  })
}
