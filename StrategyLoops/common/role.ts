import { INTERRUPTION_REASON, type InterruptedMsgContext } from "./types"
import type { ISession } from "./session"
import { logFile,consoleAndLogFile } from "./logger"
import { askUserWithTimeout } from "./system"

/**
 * 角色
 * 代表单个角色，包含系统Prompt和长期记忆等信息
 */
export interface IRole {
  name: string
  knowledgeDomainPrompt(): string // 知识域提示词, 区分Role的系统提示词。
  systemPrompt(upstreamMsg: string): string // 接收上一个上游的响应，构造本轮发送内容。
  memory?: string
  accessMode: "readonly" | "writable"
  model?: {
    providerID: string
    modelID: string
  }
  currentSessionInstance?: ISession
  outputSchema: Record<string, any>    // JSON Schema 定义输出格式
  validateOutput(raw: string): { valid: boolean; error?: string } // 校验输出是否符合格式；不通过则触发重试
  /** 需要禁用的内置工具 ID 列表，适配层会在 session 创建/连接时通过 permission 规则关闭 */
  disabledTools?: string[]
}

export function 检查names重复(roles: { name: string }[]): { name: string }[] {
  const seen = new Set<string>()

  for (const r of roles) {
    if (seen.has(r.name)) {
      const err = `重复的name: ${r.name}`
      consoleAndLogFile.error(err);
      throw new Error(err)
    }
    seen.add(r.name)
  }
  return roles
}

export async function AskTo重新定位角色(
  allRoles : IRole[],
  nextRole: IRole,
  interruptedMsg: InterruptedMsgContext,
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
  const next = nextIdx + 1

  const timeout_s = 15
  const timeout_ms = timeout_s * 1000
  const promptMsg = `将消息派发给哪个角色? (1-${names.length}, 当前: ${current}.${interruptedMsg.roleName}, 下一个: ${next}.${nextRole.name}) [${timeout_s}s后自动选择下一个角色, 回车可提前确认已有输入]: `
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
