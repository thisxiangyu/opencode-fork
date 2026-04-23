import { INTERRUPTION_REASON, type InterruptedMessage } from "./types"
import type { ISession } from "./session"
import { logFile,consoleAndLogFile } from "./logger"
import { askUserWithTimeout } from "./system"

/**
 * 角色
 * 代表单个角色，包含系统Prompt和长期记忆等信息
 */
export interface IRole {
  name: string
  knowledgeDomainPrompt: string // 知识域提示词, 区分Role的系统提示词。这里命名很长, 但是为了强调Role必须由“知识域”作为核心识别属性, 所以采用了更长的命名。之前在某篇文章中看到: Less is more，单Agent很多时候比多Agent互通信的工作成功率更高, 衡量要不要开新Agent的关键在于两项任务是否 “跨知识域”。所以拿这个来作为系统提示词的命名。
  memory?: string
  accessMode: "readonly" | "writable"
  currentSessionInstance?: ISession
}

export function 检查names重复(roles: { name: string }[]): { name: string }[] {
  const seen = new Set<string>()

  for (const r of roles) {
    if (seen.has(r.name)) {
      throw new Error(`重复的name: ${r.name}`)
    }
    seen.add(r.name)
  }
  return roles
}

export async function AskTo重新定位角色(
  allRoles : IRole[],
  nextRole: IRole,
  interruptedMsg: InterruptedMessage,
): Promise<IRole> {
  const reasonText =
    interruptedMsg.reason === INTERRUPTION_REASON.rollback
      ? "[回滚] 检测到消息回滚"
      : interruptedMsg.reason === INTERRUPTION_REASON.new_message
        ? "[新消息] 检测到新消息"
        : "[暂停] 检测到会话中断"

  logFile.info("\n" + "=".repeat(60))
  logFile.info(reasonText)
  logFile.info("=".repeat(60))
  logFile.info(`  角色名称: ${interruptedMsg.roleName}`)
  logFile.info(`  中断前消息: ${interruptedMsg.beforeMessage.substring(0, 100)}...`)
  logFile.info(`  当前收到消息: ${interruptedMsg.receivedMessage.substring(0, 100)}...`)
  logFile.info(`  检测时间: ${interruptedMsg.timestamp.toLocaleString()}`)
  logFile.info()

  const names = allRoles.map((n) => n.name)
  consoleAndLogFile.info("当前策略可用角色:")
  for (let i = 0; i < names.length; i++) {
    consoleAndLogFile.info(`  ${i + 1}. ${names[i]}`)
  }

  const currentIdx = allRoles.findIndex((n) => n.name === interruptedMsg.roleName)

  const current = currentIdx + 1
  const nextIdx = allRoles.findIndex((n) => n.name === nextRole.name)

  if (nextIdx === -1)
    throw new Error(`未找到下一个角色: ${nextRole.name}`);

  const timeout_s = 6
  const timeout_ms = timeout_s * 1000
  const promptMsg = `将消息派发给哪个角色? (1-${names.length}, 当前: ${current}.${interruptedMsg.roleName}, 下一个: ${nextIdx + 1}.${nextRole.name}) [${timeout_s}s后自动选择下一个角色, 回车可提前确认已有输入]: `
  logFile.info(`[派发等待] ${promptMsg}`)
  const answer = await askUserWithTimeout(promptMsg, timeout_ms)
  const trimmed = answer?.trim() ?? ""
  if (answer === null) {
    logFile.info(`[派发输入] <timeout>`)
  } else if (trimmed === "") {
    logFile.info(`[派发输入] <empty>`)
  } else {
    logFile.info(`[派发输入] ${trimmed}`)
    const idx = parseInt(trimmed, 10) - 1
    if (!isNaN(idx) && idx >= 0 && idx < names.length) {
      const target = allRoles[idx]
      if (target) {
        logFile.info(`消息派发给 ${target.name}`)
        return target
      }
    }
    consoleAndLogFile.info("无效的选项，自动派发给下一个角色")
  }

  const target = allRoles[nextIdx]
  if (target) {
    logFile.info(`超时，自动派发给: ${target.name}`)
    return target
  }
  throw new Error("未找到可派发的角色")
}
