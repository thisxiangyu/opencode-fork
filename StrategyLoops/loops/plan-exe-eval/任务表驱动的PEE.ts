/**
 * PEE是隐式地将【决策】包含在"规划"当中的，即规划者同时承担决策职责（coo和ceo同体，类似于早期创业公司的组织形态，缺点是，对于开放式决策缺乏慢思考），
 * 适合不需要开放式决策、以封闭式决策为主的项目。
 */
import { consoleAndLogFile, LOG_DIR, logFile, LOG_COLOR } from "../../common/logger"
import { AskTo重新定位角色, 检查names重复, type IRole } from "../../common/role"
import { LoopConfig } from "../../common/loopConfig"
import { AbortError, INTERRUPTION_REASON, type InterruptedMessage, MSG_SOURCE } from "../../common/types"
import type { ISession } from "../../common/session"
import { linkBackend,createSession, selectOrCreateSession } from "../../common/adapters/opencodeAdapter"
import { formatDateTime } from "../../common/system"
import { initDb, 查询任务表_返回视图, type I读取任务表 } from "../../common/tools/任务表/任务表CLI"

const config = new LoopConfig({ maxCycles: 3 })

const 团队Prompt = `项目的团队成员包括：manager、planner、executor、evaluator、QA。
工作以'规划->执行->测评'循环进行，总共${config.maxCycles}轮。工作目标通过【任务表】的方式来具体化和跟踪。
`

export class 规划者 implements IRole, I读取任务表 {
  memory?: string | undefined
  name = "planner"
  knowledgeDomainPrompt() { return "你是一个规划者，负责理解目标、分析当前局面、制定可执行的具体开发任务、挑选执行者、派发任务。" }
  systemPrompt() { return `1.阅读上一轮的评估；2.理解当前任务表完成度；3.分析本轮执行的情况和进度；4.判断执行者是否正确理解了上一轮规划；5.让执行者直接继续/压缩。
  通常而言，任务树的层次越厚实，末端任务越具体，证明对项目的理解越深入，规划质量越高。现在，请视察情况，先完成本轮任务表规划或调整。
   
  完成任务表规划或调整后，需要向执行者传递发出指令，按下列格式输出：
  {
    前情点评: "",
    本轮任务标题: "",
    我的规划: "",
    留言: "你好执行者，...（给执行者的具体留言、规划或指导，不要跟前情点评重复）"
  }
  ` }

  查询任务表(一次性聚焦数量上限: number, 从: string | undefined, 到: string | undefined, 描述字数展示阈值: number, 任务动态字数展示阈值: number): string {
    return 查询任务表_返回视图(一次性聚焦数量上限, 从, 到, 描述字数展示阈值, 任务动态字数展示阈值)
  }

  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 执行者 implements IRole, I读取任务表 {
  name = "executor"
  knowledgeDomainPrompt() { return "你是一个执行者，负责执行任务。" }
  systemPrompt() { return "。" }
  查询任务表(一次性聚焦数量上限: number, 从: string | undefined, 到: string | undefined, 描述字数展示阈值: number, 任务动态字数展示阈值: number): string {
    return `《任务表》`
  }
  fix任务反驳():string{
    return `如果你认为规划者的任务分配不合理，你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  add任务反驳():string{
    return `检查规划者的add任务是否合理（1.检查是否和已有功能冲突；2.检查是否并不优雅实现；3.其它各方面检查），你需要给出明确的理由和建议，反驳规划者的决策。`
  }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 评估者 implements IRole {
  name = "evaluator"
  knowledgeDomainPrompt() { return "你是一个评估者，负责评估结果.  你再回复我三句话." }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 质保员 implements IRole {
  name = "QA"
  knowledgeDomainPrompt() { return "你是一个质保员，负责写测试、找bug/复现bug/记录bug" }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 冗余枝剪者 implements IRole {
  name = "ScissorHands"
  knowledgeDomainPrompt() { return "你是一个冗余枝剪者，负责寻找当前这次未提交的变更中：因前后逻辑覆盖、项目推进太快造成的不必要的冗余（代码、逻辑、文件、文件夹、资产等），如果有，提请执行者检查。" }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 边缘质保员 implements IRole {
  name = "EdgeQA"
  knowledgeDomainPrompt() { return "你是一个边缘质保员，负责寻找质保员测试时未覆盖到的边缘情况。找出以下可能发生的边缘情况：大数据量、大参数量、多次重复操作、交叠式重复操作、覆盖式操作、特殊情况中断。" }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export const 策略描述 = "任务表驱动的MPEE（manage-plan-execute-eval）策略"
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
function takeLatestDispatchableInterruption(queue: InterruptedMessage[]): InterruptedMessage | null {
  for (let index = queue.length - 1; index >= 0; index--) {
    const item = queue[index]
    if (!item) continue
    if (!isDispatchableInterruption(item.reason)) continue
    queue.length = 0
    return item
  }
  return null
}

function isDispatchableInterruption(reason: InterruptedMessage["reason"]): boolean {
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

  let 规划者instance = new 规划者() as IRole
  let 执行者instance = new 执行者() as IRole
  let 评估者instance = new 评估者() as IRole

  const allRoles = 检查names重复([规划者instance, 执行者instance, 评估者instance]) as IRole[]
  let currentRole = 规划者instance

    /**
   * 这里的跳转策略设置为固定的闭环：规划->执行->评估->规划
   */
  const Role跳转策略: (current: IRole) => IRole = (r) => {
    if(r instanceof 规划者) {
      return 执行者instance
    }
    if(r instanceof 执行者) {
      return 评估者instance
    }
    if(r instanceof 评估者) {
      return 规划者instance
    }
    throw new Error(`未知角色类型: ${r.name}`)
  }

    /**
   * 计算中断派发上下文
   * @param sourceRole 中断来源角色（interrupt.roleName 对应的 role）
   * @param interrupt 当前待处理的中断
   *
   * 【roleName 语义统一约定】
   * interrupt.roleName 表示"哪个 role 的 session 产生了这个中断"，而非"恢复结果应派发给谁"
   * 这使得每个 role 的 session 状态能独立管理，不会因角色切换而混乱
   */
  function getDispatchContext(sourceRole: IRole, interrupt: InterruptedMessage) {
    if (interrupt.reason !== INTERRUPTION_REASON.rollback) {
      return {
        dispatchMsg: interrupt,
        fallbackRole: Role跳转策略(sourceRole),
      }
    }

    const resumedRole = Role跳转策略(sourceRole)
    return {
      dispatchMsg: interrupt,
      fallbackRole: resumedRole,
    }
  }

  const interruptionQueue: InterruptedMessage[] = []

  consoleAndLogFile.infoC(LOG_COLOR.GREEN, `[${策略描述}][预备] 总圈数=${config.maxCycles}`)
  consoleAndLogFile.info(`服务器URL: ${backendURL}`)
  consoleAndLogFile.info(`日志目录: ${LOG_DIR}`)
  consoleAndLogFile.info(`后端: ${linkBackend(backendURL)}`)

  const defaultDir = process.cwd()
  let projectDir = defaultDir
  const entrySession: ISession = await selectOrCreateSession(defaultDir, 规划者instance)
  projectDir = entrySession.directory


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
    const session = await createSession(role, `[${role.name}] (${formatDateTime({ isoString: new Date().toISOString(), showYear: false, showPeriod: true, showTime: true ,showSeconds: false})})`, projectDir)
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
        const interruptedRole = allRoles.find((r) => r.name === interrupt.roleName)
        if (!interruptedRole) throw new Error(`中断来源角色不存在: ${interrupt.roleName}`)

        logFile.info(`[中断处理] reason=${interrupt.reason}, 来源角色=${interruptedRole.name}`)
        const dispatchContext = getDispatchContext(interruptedRole, interrupt)
        logFile.info(`[派发决策] interruptRole=${interrupt.roleName}, dispatchRole=${dispatchContext.dispatchMsg.roleName}, fallbackRole=${dispatchContext.fallbackRole.name}`)

        currentRole = await AskTo重新定位角色(allRoles, dispatchContext.fallbackRole, dispatchContext.dispatchMsg)

        // 要清理的是触发中断的那个 role 的 session，不是 currentRole 的
        if (interruptedRole.currentSessionInstance) {
          interruptedRole.currentSessionInstance.clearInterruption()
        }
        continue
      }

      // 没有待处理的中断，才获取当前 role 的 session 并执行任务
      const session = await getOrCreateSession(currentRole)
      logFile.info(`[第${cycle + 1}圈] 当前角色=${currentRole.name}, 会话状态=${session.getReceiveState()}`)

      consoleAndLogFile.infoC(LOG_COLOR.GREEN, `>>> ${currentRole.name}`)
      session.setCurrentContext(currentRole.name)

      try {
        const msg = currentRole.knowledgeDomainPrompt();
        consoleAndLogFile.infoC(LOG_COLOR.GREEN,`[发送>>] "${msg.substring(0, 60)}..."`)
        const response = await session.sendMsg({
          msgSource: MSG_SOURCE.system,
          content: msg,
        })

        consoleAndLogFile.infoC(LOG_COLOR.GREEN,`[<<收到] "${response.substring(0, 80)}..."`)
        logFile.infoC(LOG_COLOR.GREEN, `<<< ${currentRole.name} 完成`)
        const nextRole = Role跳转策略(currentRole)

        // 硬规则: 提前闭环回到首角色(规划者)，算一圈
        // 没回到首角色，不算一圈
        // 也就是说, 当前策略是"闭环First"策略
        if (isCycleCompleted(nextRole, 规划者instance)) {
          cycle++
          consoleAndLogFile.info(`[当前循环: 第${cycle + 1}圈]`)
        }

        currentRole = nextRole // 切换角色

        // TODO 交接信息


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
           * "恢复后默认派发给谁"由 getDispatchContext(sourceRole).fallbackRole 计算
           */
          if (!interruptionQueue.some((item) => item.reason === INTERRUPTION_REASON.rollback)) {
            interruptionQueue.push({
              roleName: currentRole.name,
              beforeMessage: currentRole.knowledgeDomainPrompt(),
              receivedMessage: resumedResponse,
              timestamp: new Date(),
              reason: INTERRUPTION_REASON.rollback,
            })
          }
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
  main().catch((error) => consoleAndLogFile.error("主函数错误:", error))
}
