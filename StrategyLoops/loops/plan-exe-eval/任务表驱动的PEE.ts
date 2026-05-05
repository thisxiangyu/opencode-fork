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
import { formatDateTime } from "../../common/system"
import { initDb } from "../../common/tools/任务表/任务表CLI"
import { join } from "path"

const config = new LoopConfig({ maxCycles: 3 , startPrompt: "请使用任务表"})

// Note：先放在这里不用，因为先试一下不告知团队情况，让agent自己感知团队结构，省token，后续再试一下告知的版本。猜测：应该差别不大。
const 团队Prompt = `项目的团队成员包括：manager、planner、executor、evaluator、QA。
工作以'规划->执行->测评'循环进行，总共${config.maxCycles}轮。工作目标通过【任务表】的方式来具体化和跟踪。
`

/** 输出格式校验最大重试次数 */
const OUTPUT_MAX_FORMAT_RETRIES = 3

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
  if (codeBlock) {
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

  knowledgeDomainPrompt() { return `你是一个规划者，负责理解目标、分析当前局面、制定任务、派发任务。
    具体来说，每一轮都要做的事：
    1.阅读上游信息；
    2.理解当前任务表完成度；(这是统领全局的首要工具。通常而言，任务表的层次越厚实，末端任务越具体，证明对项目的理解越深入，规划质量越高。)
    3.分析上一轮执行的情况和进度，深度思考，不妥的任务需要重新规划，合格的任务要标记为完成;
    4.判断执行者是否正确理解了上一轮规划，如果偏离，需要多花一轮沟通/澄清；
    5.检查项目状态一致性，什么意思？比如说功能/代码更新了，文档或注释还是旧的；或者模块A已经更新了，依赖A的模块B还是旧用法；项目已经更新了，测试用例没同步...让人去fix。

    可能还有别的事，发挥想象力去做一些有助于项目推进的事，干活不用太着急。
    别对自己太自信，没有把握的业务多上网查资料，汲取一手经验。但网络信息良莠不齐，也不要被ai泔水浪费时间，结合项目实际情况判断。

    任务表工具已就绪：
    - ./任务表CLI.ts
    - ./任务表CLI使用说明书.md
    - 项目名即根目录名。

    熟练使用任务表，从全局把控项目进度、节奏、质量、深度、创新、产品体验。
    对于高层次任务，你像一个CEO，理清依赖关系、不断问自己“先做这个、后做那个好不好”、把控创新探索和实际落地的比例（探索可能失败，但也有可能带来巨大收益；循规蹈矩虽然稳妥，但可能错失创新机会）、决策创新探索的结果（可用、暂时不用、弃用）；
    末端是高层次任务的自然分解，对于这类任务，你像一个小队长，描述要具体、清晰、原子级、手把手、结构化。

    【项目交付】轮次有上限。超过上限未完成有一次延期机会。如果延期: 先汇报进度，接着分析还要几轮才能全部做完、有哪些会简化或绝对不可能完成、哪些建议只先完成demo，往后迭代新版本再做完整版不迟。
    【完美主义】如果达到上限前完成（即，还有富余的轮次），继续探索创新或者优化已有实现。直到实在没有任何可做的内容了，允许通过发送${this.项目已提前完成sign}宣告提前完成。
  ` }
  systemPrompt(upstreamMsg: string) { return `上游消息：
---
${upstreamMsg}
---
【慢思考】先尽到你本轮的职责。【任务派发】再发出执行指令。

本轮任务（仅派发末端任务，不派发高层次任务）。
` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = {
    type: "object",
    required: ["前情点评", "本轮任务", "留言"],
    properties: {
      前情点评: { type: "string" },
      本轮任务: { type: "string" },
      留言: { type: "string" },
    },
  }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    const json = extractJSON(raw)
    if (!json) return { valid: false, error: `输出中未找到有效的 JSON 对象（请使用 {${this.outputSchema.required.join(", ")} } 格式）` }
    for (const field of this.outputSchema.required as string[]) {
      if (!(field in json)) return { valid: false, error: `JSON 缺少必填字段: ${field}` }
    }
    return { valid: true }
  }
}

export class 执行者 implements IRole {
  name = "executor"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return "你是一个执行者，负责执行任务。" }
  systemPrompt(upstreamMsg: string) { return `下面是规划者上一轮给出的指令：
---
${upstreamMsg}
---

请根据以上指令完成本轮执行工作。` }

  fix任务反驳():string{
    return `如果你认为规划者的任务分配不合理，你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  add任务反驳():string{
    return `检查规划者的add任务是否合理（1.检查是否和已有功能冲突；2.检查是否并不优雅实现；3.其它各方面检查），你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  accessMode: "readonly" | "writable" = "readonly"
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
  knowledgeDomainPrompt() { return "你是一个评估者，负责评估结果.  你再回复我三句话." }
  systemPrompt(upstreamMsg: string) { return `下面是执行者上一轮的输出：
---
${upstreamMsg}
---
请评估以上结果，指出问题和改进建议。回复三句话。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}

export class 冗余枝剪者 implements IRole {
  name = "ScissorHands"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return "你是一个冗余枝剪者，负责寻找当前这次未提交的变更中：因前后逻辑覆盖、项目推进太快造成的不必要的冗余/误导性路径（代码、逻辑、文件、文件夹、资产等），如果有，提请执行者检查。" }
  systemPrompt(upstreamMsg: string) { return `下面是上一环节的输出：
---
${upstreamMsg}
---

请检查是否有不必要的冗余。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}

export class 架构师 implements IRole {
  name = "architect"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return `你是一个架构师，负责从更高明的角度审视项目。
    你只做重构评估，不新增功能。
    具体职责包括：
    1.评估代码结构是否合理，是否遵循设计原则和最佳实践，这需要你慢思考，调动细腻的感知力；
    2.分析模块间的依赖关系，你需要确保低耦合，但也要识别内聚性，避免过度解耦；
    3.识别关键路径和性能瓶颈；
    4.确保架构与业务需求匹配，考虑扩展性，动态匹配合理的演进路径。
    
    【全局视角】任务表工具请查看说明书。你只允许查询，不允许增删改动。

    【局部整体性视角】多查看diff（关注暂存区、工作区以及整体变动），跳出来看跨文件关系，多问自己：
      这次变动是否引入了冗余？
      是否有更优雅的实现？
      是否有更合理的分层？
      是否有更清晰的模块划分？
      是否有更高明的设计？

      逐行查找：过度设计（过度设计是原罪，简单清晰是最好的）
      原则：任务表权威，你的重构不应该违背任务表的规划意图。这要求你必须小心谨慎，真实理解了任务表的实际意图。
  ` }
  systemPrompt(upstreamMsg: string) { return `下面是上游的输出：
---
${upstreamMsg}
---

请从你的视角审视上述内容，提供反馈。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}

export class 质保员 implements IRole {
  name = "QA"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return "你是一个质保员，负责写测试、找bug/复现bug/记录bug" }
  systemPrompt(upstreamMsg: string) { return `下面是上一环节的输出：
---
${upstreamMsg}
---

请检查测试覆盖和bug情况。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}

export class 边缘质保员 implements IRole {
  name = "EdgeQA"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return "你是一个边缘质保员，负责寻找质保员测试时未覆盖到的边缘情况。找出以下可能发生的边缘情况：大数据量、大参数量、多次重复操作、交叠式重复操作、覆盖式操作、特殊情况中断。" }
  systemPrompt(upstreamMsg: string) { return `下面是质保员的测试结果：
---
${upstreamMsg}
---

请找出未覆盖的边缘情况。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}

export class 压缩决策员 implements IRole {
  name = "Compactor"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return `你是一个压缩决策员，负责在每轮执行前判断是否需要对执行者的会话进行压缩（compact）。
压缩的含义：将旧的对话历史总结为摘要，仅保留最近的关键上下文。好的压缩让执行者更聪明（释放无关历史，聚焦当前任务），坏的压缩因思维链断裂导致状态不一致。

你的判断依据：
1. 任务翻新度：如果本轮任务跟上一轮比是"高翻新"（7-10分：切换功能模块、不同文件、同文件中度或大型重构、思维链不需延续）→ 建议压缩
             如果本轮任务跟上一轮比是"低翻新"（1-6分：必须复用上一个任务思维链）→ 不建议压缩
2. Context Rot 迹象：如果会话过长或模型频繁"忘记"前文 → 建议压缩
3. 关键记忆点：如果有必须跨轮保留的关键信息（设计决策、重要思维链、未闭合的bug），请注明。只在需要压缩时注明，如果不需要压缩，则关键记忆点也应同样视作不需要。` }
  systemPrompt(upstreamMsg: string) { return `规划者本轮的指令：
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
  knowledgeDomainPrompt() { return "你是一个提交员，负责提交仓库。包括git仓库（如有）、svn仓库（如有）等等。" }
  systemPrompt(upstreamMsg: string) { return `下面是质保员的测试结果：
---
${upstreamMsg}
---

请找出未覆盖的边缘情况。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}

export class 测试 implements IRole {
  name = "test"
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return "当前是纯粹的测试。" }
  systemPrompt(upstreamMsg: string) { return `上游消息：
---
${upstreamMsg}
---
请回复我5句话即可。` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
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



export async function main(): Promise<void> {

  // let 规划者instance = new 规划者() as IRole
  // let 执行者instance = new 执行者() as IRole
  // let 评估者instance = new 评估者() as IRole
  // let 压缩决策员instance = new 压缩决策员() as IRole

  // Note：测试快速路径，非测试模式注释掉这段
  let 规划者instance = new 测试() as IRole
  let 压缩决策员instance = new 测试() as IRole
  let 执行者instance = new 测试() as IRole
  let 评估者instance = new 测试() as IRole
  规划者instance.name ="测1"
  压缩决策员instance.name ="测2"
  执行者instance.name ="测3"
  评估者instance.name ="测4"

  const allRoles = 检查names重复([规划者instance, 压缩决策员instance, 执行者instance, 评估者instance]) as IRole[]
  let currentRole = 规划者instance

    /**
   * 这里的跳转策略设置为基本固定闭环：规划->执行->评估，
   * 中间可穿插压缩决策员、架构师、冗余枝剪者等功能性角色，形成一个稳定结构。
   */
  const Role跳转策略: (current: IRole) => IRole = (r) => {
    if(r instanceof 规划者) {
      return 压缩决策员instance
    }
    if(r instanceof 压缩决策员) {
      return 执行者instance
    }
    if(r instanceof 执行者) {
      return 评估者instance
    }
    if(r instanceof 评估者) {
      return 规划者instance
    }
    if(r instanceof 测试) {
      // 测试路径
      if(r.name === "测1") return 压缩决策员instance
      if(r.name === "测2") return 执行者instance
      if(r.name === "测3") return 评估者instance
      if(r.name === "测4") return 规划者instance
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
  const toolsDir = Bun.fileURLToPath(new URL("../../common/tools/任务表", import.meta.url).href)
  const cliSource = join(toolsDir, "任务表CLI.ts")
  const readmeSource = join(toolsDir, "README.md")
  const cliDest = join(projectDir, "任务表CLI.ts")
  const readmeDest = join(projectDir, "任务表CLI使用说明书.md")

  await Bun.write(cliDest, Bun.file(cliSource))
  logFile.info(`[任务表] CLI已拷贝 -> ${cliDest}`)
  await Bun.write(readmeDest, Bun.file(readmeSource))
  logFile.info(`[任务表] 说明书已拷贝 -> ${readmeDest}`)

  const initResult = await Bun.spawn({
    cmd: ["bun", "run", cliDest, "init", "--项目", projectName],
    cwd: projectDir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const initExitCode = await initResult.exited
  const initStdout = await new Response(initResult.stdout).text()
  const initStderr = await new Response(initResult.stderr).text()
  if (initExitCode === 0) {
    logFile.info(`[任务表] 数据库初始化成功: ${initStdout.trim()}`)
  } else {
    consoleAndLogFile.warn(`[任务表] 数据库初始化失败 (exit=${initExitCode}): ${initStderr.trim()}，可能已存在同名项目数据库`)
  }

  // 【项目起始文档】将配置中的 startPrompt 写入项目根目录 AGENTS.md
  const readmePath = join(projectDir, "AGENTS.md")
  await Bun.write(readmePath, config.startPrompt)
  logFile.info(`[项目] 起始文档已创建 -> ${readmePath}`)


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
        const fallbackRole = Role跳转策略(interruptedRole)
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

        if (shouldActivateKnowledge) {
          if (!lastResponse?.trim()) // 空、null、undefined、纯空格
          {
            lastResponseEmptyCount++
            lastResponse = `暂无(第${lastResponseEmptyCount}次空缺上游消息)，请你自行决断本轮行为。`;            
          }else{
            lastResponseEmptyCount = 0 // 重置计数
          }
          msgToBeSent = currentRole.knowledgeDomainPrompt()+`\n${currentRole.systemPrompt(lastResponse)}`
          knowledgeSent.add(currentRole.name)
        } else {
          msgToBeSent = roundInfo + currentRole.systemPrompt(lastResponse)
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
        lastResponse = response

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

        const nextRole = Role跳转策略(currentRole)

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

if (import.meta.main) {
  initDb(process.env.任务表项目 ?? "default")
  main().catch((error) => {
    const err = error as any
    consoleAndLogFile.error("主函数错误:", err?.stack ?? err?.message ?? JSON.stringify(error))
  })
}
