import { consoleAndLogFile, LOG_DIR, logFile, LOG_COLOR } from "../../common/logger"
import { AskTo重新定位角色, 检查names重复, type IRole } from "../../common/role"
import { LoopConfig } from "../../common/loopConfig"
import { AbortError, INTERRUPTION_REASON, type InterruptedMessage, MSG_SOURCE } from "../../common/types"
import type { ISession } from "../../common/session"
import { linkBackend,createSession, selectOrCreateSession } from "../../common/adapters/opencodeAdapter"
import { formatDateTime } from "../../common/system"

const config = new LoopConfig({ maxCycles: 3 })

export class 规划者 implements IRole {
  memory?: string | undefined
  name = "planner"
  knowledgeDomainPrompt = "你是一个规划者，负责制定计划. 测试模式, 你只允许回复我三句话."
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 执行者 implements IRole {
  name = "executor"
  knowledgeDomainPrompt = "你是一个执行者，负责执行任务. 测试模式, 你再回复我三句话."
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export class 评估者 implements IRole {
  name = "evaluator"
  knowledgeDomainPrompt = "你是一个评估者，负责评估结果. 测试模式, 你再回复我三句话."
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}

export const 策略描述 = "plan-exe-eval循环"
export const backendURL = "http://127.0.0.1:4096"
export const projectDir = process.cwd()

/**
 * 计算中断派发上下文
 * @param sourceRole 中断来源角色（interrupt.roleName 对应的 role）
 * @param allRoles 所有角色列表
 * @param interrupt 当前待处理的中断
 *
 * 【roleName 语义统一约定】
 * interrupt.roleName 表示"哪个 role 的 session 产生了这个中断"，而非"恢复结果应派发给谁"
 * 这使得每个 role 的 session 状态能独立管理，不会因角色切换而混乱
 */
function getDispatchContext(sourceRole: IRole, allRoles: IRole[], interrupt: InterruptedMessage) {
  if (interrupt.reason !== INTERRUPTION_REASON.rollback) {
    return {
      dispatchMsg: interrupt,
      fallbackRole: getNextRole(sourceRole, allRoles),
    }
  }

  const resumedRole = getNextRole(sourceRole, allRoles)
  return {
    dispatchMsg: interrupt,
    fallbackRole: resumedRole,
  }
}

function isDispatchableInterruption(reason: InterruptedMessage["reason"]): boolean {
  return (
    reason === INTERRUPTION_REASON.pause ||
    reason === INTERRUPTION_REASON.new_message ||
    reason === INTERRUPTION_REASON.rollback
  )
}

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

function getNextRole(current: IRole, allRoles: IRole[]): IRole {
  const currentIndex = allRoles.findIndex((role) => role.name === current.name)
  if (currentIndex === -1) throw new Error(`未知角色: ${current.name}`)
  return allRoles[(currentIndex + 1) % allRoles.length]!
}

function isCycleCompleted(nextRole: IRole, allRoles: IRole[]): boolean {
  return nextRole.name === allRoles[0]?.name
}

export async function main(): Promise<void> {
  const allRoles = 检查names重复([new 规划者(), new 执行者(), new 评估者()]) as IRole[]
  let theFirstRole = allRoles[0]!
  let currentRole = theFirstRole

  const interruptionQueue: InterruptedMessage[] = []

  consoleAndLogFile.infoC(LOG_COLOR.GREEN, `[${策略描述}][预备] 总圈数=${config.maxCycles}`)
  consoleAndLogFile.info(`服务器URL: ${backendURL}`)
  consoleAndLogFile.info(`项目目录: ${projectDir}`)
  consoleAndLogFile.info(`日志目录: ${LOG_DIR}`)
  consoleAndLogFile.info(`后端: ${linkBackend(backendURL)}`)

  const defaultDir = projectDir
  const entrySession: ISession = await selectOrCreateSession(defaultDir)

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
    const session = await createSession(`[${role.name}] (${formatDateTime({ showYear: false, showPeriod: true, showTime: true })})`, projectDir)
    role.currentSessionInstance = session
    session.onInterruption((msg) => {
      interruptionQueue.push(msg)
      logFile.info(`[检测到中断] reason=${msg.reason}`)
    })
    return session
  }

  theFirstRole.currentSessionInstance = entrySession

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
        const dispatchContext = getDispatchContext(interruptedRole, allRoles, interrupt)
        logFile.info(`[派发决策] interruptRole=${interrupt.roleName}, dispatchRole=${dispatchContext.dispatchMsg.roleName}, fallbackRole=${dispatchContext.fallbackRole.name}`)

        currentRole = await AskTo重新定位角色(allRoles, dispatchContext.fallbackRole, dispatchContext.dispatchMsg)

        // 清理的是触发中断的那个 role 的 session，不是 currentRole 的
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
      const agentType = currentRole.accessMode === "readonly" ? "plan" : "build"

      try {
        const msg = currentRole.knowledgeDomainPrompt;
        consoleAndLogFile.infoC(LOG_COLOR.GREEN,`[发送>>] "${msg.substring(0, 60)}..."`)
        const response = await session.sendMsg(
          {
            msgSource: MSG_SOURCE.system,
            content: msg,
          },
          agentType,
          currentRole.model,
        )

        consoleAndLogFile.infoC(LOG_COLOR.GREEN,`[<<收到] "${response.substring(0, 80)}..."`)
        logFile.infoC(LOG_COLOR.GREEN, `<<< ${currentRole.name} 完成`)
        const nextRole = getNextRole(currentRole, allRoles)

        // 硬规则: 提前闭环回到首角色，算一圈
        // 没回到首角色，不算一圈
        // 也就是说, 当前策略是"闭环First"策略
        if (isCycleCompleted(nextRole, allRoles)) {
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
              beforeMessage: currentRole.knowledgeDomainPrompt,
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

main().catch((error) => consoleAndLogFile.error("主函数错误:", error))
