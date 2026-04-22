import { consoleAndLogFile, LOG_DIR, logFile, LOG_COLOR } from "../../common/logger"
import { AskTo重新定位角色, 检查names重复, type Role } from "../../common/role"
import { LoopConfig } from "../../common/loopConfig"
import { OpenCodeSession } from "../../common/adapters/opencodeSession"
import { 选择会话实例 } from "../../common/adapters/opencodeSessionManager"
import { AbortError, INTERRUPTION_REASON, type InterruptedMessage, MSG_SOURCE } from "../../common/adapters/types"

const config = new LoopConfig({ maxCycles: 3 })

export class 规划者 implements Role {
  name = "planner"
  systemPrompt = "你是一个规划者，负责制定计划. 测试模式, 你只允许回复我三句话."
  accessMode: "readonly" | "writable" = "readonly"
}

export class 执行者 implements Role {
  name = "executor"
  systemPrompt = "你是一个执行者，负责执行任务. 测试模式, 你再回复我三句话."
  accessMode: "readonly" | "writable" = "readonly" // Note: 这里测试时用readonly, 后续再改成writable
}

export class 评估者 implements Role {
  name = "evaluator"
  systemPrompt = "你是一个评估者，负责评估结果. 测试模式, 你再回复我三句话."
  accessMode: "readonly" | "writable" = "readonly"
}

export const 策略描述 = "plan-exe-eval循环"
export const ServerURL = "http://127.0.0.1:4096"
export const Backend = "Opencode"

function getDispatchContext(currentRole: Role, allRoles: Role[], interrupt: InterruptedMessage) {
  if (interrupt.reason !== INTERRUPTION_REASON.rollback) {
    return {
      dispatchMsg: interrupt,
      fallbackRole: getNextRole(currentRole, allRoles),
    }
  }

  const resumedRole = getNextRole(currentRole, allRoles)
  return {
    dispatchMsg: {
      ...interrupt,
      roleName: resumedRole.name,
    },
    fallbackRole: getNextRole(resumedRole, allRoles),
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

function getNextRole(current: Role, allRoles: Role[]): Role {
  const currentIndex = allRoles.findIndex((role) => role.name === current.name)
  if (currentIndex === -1) throw new Error(`未知角色: ${current.name}`)
  return allRoles[(currentIndex + 1) % allRoles.length]!
}

function isCycleCompleted(nextRole: Role, allRoles: Role[]): boolean {
  return nextRole.name === allRoles[0]?.name
}

export async function main(): Promise<void> {
  const allRoles = 检查names重复([new 规划者(), new 执行者(), new 评估者()]) as Role[]
  let currentRole = allRoles[0]!
  const interruptionQueue: InterruptedMessage[] = []

  consoleAndLogFile.infoC(LOG_COLOR.GREEN, `[${策略描述}][预备] 总圈数=${config.maxCycles}`)
  consoleAndLogFile.info(`服务器URL: ${ServerURL}`)
  consoleAndLogFile.info(`当前进程目录: ${process.cwd()}`)
  consoleAndLogFile.info(`日志目录: ${LOG_DIR}`)
  consoleAndLogFile.info(`后端: ${Backend}`)

  const { client, sessionId, directory: sessionDir } = await 选择会话实例(ServerURL, process.cwd(), Backend)
  const session = new OpenCodeSession(client, sessionId, sessionDir)

  session.onInterruption((msg) => {
    interruptionQueue.push(msg)
    logFile.info(`[检测到中断] reason=${msg.reason}`)
  })

  await session.startEventListener()

  try {
    let cycle = 0
    while (cycle < config.maxCycles) {
      consoleAndLogFile.info(`[第${cycle + 1}圈] 当前角色=${currentRole.name}, 会话状态=${session.getReceiveState()}`)

      // 这里统一消费四种中断语义。
      // pause / new_message / rollback：都允许用户决定消息应该继续派发给哪个角色。
      // aborted：说明当前生成已经被终止，不在循环顶部处理，而是在 catch AbortError 后进入等待恢复路径。
      const interrupt = takeLatestDispatchableInterruption(interruptionQueue)
      if (interrupt) {
        logFile.info(`[中断处理] reason=${interrupt.reason}`)
        const dispatchContext = getDispatchContext(currentRole, allRoles, interrupt)
        logFile.info(`[派发决策] interruptRole=${interrupt.roleName}, dispatchRole=${dispatchContext.dispatchMsg.roleName}, fallbackRole=${dispatchContext.fallbackRole.name}`)
        currentRole = await AskTo重新定位角色(allRoles, dispatchContext.fallbackRole, dispatchContext.dispatchMsg)
        session.clearInterruption()
        continue
      }

      consoleAndLogFile.infoC(LOG_COLOR.GREEN, `>>> ${currentRole.name}`)
      session.setCurrentContext(currentRole.name)
      const agentType = currentRole.accessMode === "readonly" ? "plan" : "build"

      try {
        const response = await session.发消息(
          {
            msgSource: MSG_SOURCE.system,
            content: currentRole.systemPrompt,
          },
          agentType,
        )

        logFile.info(`[收到] ${response.substring(0, 80)}...`)
        logFile.infoC(LOG_COLOR.GREEN, `<<< ${currentRole.name} 完成`)
        const nextRole = getNextRole(currentRole, allRoles)

        // 提前闭环回到首角色，算一圈
        // 没回到首角色，不算一圈
        if (isCycleCompleted(nextRole, allRoles)) {
          cycle++ 
        }
        currentRole = nextRole
      } catch (error) {
        if (!(error instanceof AbortError)) {
          throw error
        }

        consoleAndLogFile.info(`[暂停] 当前角色=${currentRole.name}, state=${session.getReceiveState()}`)
        consoleAndLogFile.info(`[暂停] 用户已中止消息, 等待下一次消息发送...`)

        try {
          const resumedResponse = await session.waitForUserMessage()
          logFile.info(`[恢复后收到] ${resumedResponse.substring(0, 80)}...`)
          logFile.info(`[暂停] 收到新的用户引导与模型恢复结果，回到派发阶段`) 
          // 不在这里直接推进到下一个角色。
          // waitForUserMessage 期间会先收到 new_message，再收到 rollback。
          // 顶部循环会从 interruptionQueue 中取最新可派发中断统一处理。
          if (!interruptionQueue.some((item) => item.reason === INTERRUPTION_REASON.rollback)) {
            const resumedRole = getNextRole(currentRole, allRoles)
            interruptionQueue.push({
              roleName: resumedRole.name,
              beforeMessage: currentRole.systemPrompt,
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
    await session.stopEventListener()
    consoleAndLogFile.infoC(LOG_COLOR.GREEN, "[策略结束]")
  }
}

main().catch((error) => consoleAndLogFile.error("主函数错误:", error))
