import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { logFile, consoleAndLogFile } from "../logger"
import * as readline from "readline"

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

export async function 选择会话实例(
  baseUrl: string,
  directory: string,
  backend: "Opencode" | "Custom"
): Promise<{ client: OpencodeClient; sessionId: string; directory: string }> {
  console.log("=".repeat(60))
  console.log("选择会话")
  console.log("=".repeat(60))
  console.log()

  if(backend != "Opencode")
    throw new Error("当前仅支持 Opencode 后端")

  const client = createOpencodeClient({ baseUrl })
  const sessions: { data: Session[] | undefined } = await client.session.list()
  const sessionList: Session[] = sessions.data ?? []
  const MAX_RECENT = 5

  console.log("  0. 打开新会话")
  console.log()

  if (sessionList.length > 0) {
    const recentSessions = sessionList.slice(0, MAX_RECENT)
    console.log(`  最近 ${recentSessions.length} 个会话：`)
    console.log()
    for (let i = 0; i < recentSessions.length; i++) {
      const s = recentSessions[i]
      if (!s) continue
      const title = s.title ?? "(无标题)"
      const updatedAt = s.time?.updated ? new Date(s.time.updated).toLocaleString() : "未知"
      console.log(`  ${i + 1}. ${title}`)
      logFile.info(`  ${i + 1}. ${title}  ( SessionID: ${s.id})`)
      console.log(`     ${updatedAt}`)
      console.log()
    }
  } else {
    console.log("  (暂无已有会话)")
    console.log()
  }

  let selected = 0
  let selectedSession: (typeof sessionList)[0] | null = null

  while (true) {
    const answer = await prompt("请输入选项 (0-新增, 1-" + MAX_RECENT + "选最近会话, s-输入会话ID, 或输入字符按会话名称搜索): ")

    if (answer.trim().toLowerCase() === "s") {
      const sessionIdInput = await prompt("请输入会话ID (ses_xxx): ")
      const inputId = sessionIdInput.trim()
      if (inputId.startsWith("ses_")) {
        logFile.info(`[连接] ${inputId}`)
        return { client, sessionId: inputId, directory }
      } else {
        consoleAndLogFile.info("无效的会话ID格式，应以 ses_ 开头")
        continue
      }
    }

    if (answer.trim() === "") {
      selected = 0
      break
    }

    selected = parseInt(answer, 10)

    if (!isNaN(selected) && selected >= 0 && selected <= MAX_RECENT) {
      break
    }

    const searchTerm = answer.trim().toLowerCase()
    if (searchTerm.length > 0) {
      const matched = sessionList.filter((s) => (s.title ?? "").toLowerCase().includes(searchTerm))
      if (matched.length > 0) {
        console.log()
        console.log(`  搜索 "${answer}" 结果 (${matched.length} 个)：`)
        for (let i = 0; i < Math.min(matched.length, 10); i++) {
          const s = matched[i]
          if (!s) continue
          console.log(`  ${i + 1}. ${s.title ?? "(无标题)"}`)
          console.log(`     ID: ${s.id}`)
        }
        console.log()

        const pickAnswer = await prompt("选择会话 (1-" + Math.min(matched.length, 10) + "): ")
        const pickIdx = parseInt(pickAnswer, 10) - 1
        if (!isNaN(pickIdx) && pickIdx >= 0 && pickIdx < matched.length) {
          const selected = matched[pickIdx]
          if (selected) {
            selectedSession = selected
            break
          }
        }
      } else {
        console.log(`  未找到包含 "${answer}" 的会话`)
        console.log()
      }
    } else {
      consoleAndLogFile.warn("无效的选项，请重新输入")
    }
  }

  console.log()

  if (selected === 0) {
    logFile.info("[创建] 打开新会话...")
    const defaultDir = directory
    const dirAnswer = await prompt(`项目目录 (直接回车使用: ${defaultDir}): `)
    const sessionDir = dirAnswer.trim() || defaultDir

    const titleAnswer = await prompt("会话标题 (直接回车使用默认): ")
    const sessionTitle = titleAnswer.trim() || "RalphLoopCore 集成测试"

    logFile.info(`[配置] 目录: ${sessionDir}`)
    logFile.info(`[配置] 标题: ${sessionTitle}`)

    const session = await client.session.create({
      directory: sessionDir,
      title: sessionTitle,
    })
    if (!session.data) {
      throw new Error("创建会话失败")
    }
    logFile.info(`[创建] 新会话: ${session.data.id}`)
    return { client, sessionId: session.data.id, directory: sessionDir }
  } else if (selectedSession) {
    logFile.info(`[选择] 使用已有会话: ${selectedSession.id} - ${selectedSession.title ?? "(无标题)"}`)
    return { client, sessionId: selectedSession.id, directory }
  } else {
    const recentSessions = sessionList.slice(0, MAX_RECENT)
    const s = recentSessions[selected - 1]
    if (!s) {
      throw new Error("会话不存在")
    }
    logFile.info(`[选择] 使用已有会话: ${s.id} - ${s.title ?? "(无标题)"}`)
    return { client, sessionId: s.id, directory }
  }
}