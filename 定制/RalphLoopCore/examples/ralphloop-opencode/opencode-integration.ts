/**
 * RalphLoopCore × OpenCode 集成示例 - 可控循环版本
 *
 * 本示例展示如何将 RalphLoopCore 的节点图执行引擎与 OpenCode 会话连接
 * 支持 WebUI 暂停/回滚时手动选择消息派发节点
 *
 * 运行前提：OpenCode 服务器必须正在运行
 * 启动服务器：opencode web
 */

import { LoopEngine } from "../../src/index.js"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk"
import { ralphLoopStrategy } from "./strategy.js"
import * as readline from "readline"

interface InterruptedMessage {
  nodeName: string
  roleName: string
  beforeMessage: string
  receivedMessage: string
  timestamp: Date
  reason: "pause" | "resend" | "unknown"
}

interface PendingMessage {
  content: string
  timestamp: Date
  sequence: number
}

class OpenCodeSessionAdapter {
  id: string
  private client: OpencodeClient
  private directory: string
  private messageHistory: Array<{ role: string; content: string }> = []
  private eventSource: AbortController | null = null
  private lastStatus: "idle" | "busy" = "idle"
  private interruptionCallback: ((msg: InterruptedMessage) => void) | null = null
  private messageCallback: ((msg: { role: string; content: string }) => void) | null = null
  private pendingMessage: PendingMessage | null = null
  private messageSequence: number = 0
  private lastReceivedMessageContent: string = ""
  private abortController: AbortController | null = null

  constructor(client: OpencodeClient, sessionId: string, directory: string) {
    this.client = client
    this.id = sessionId
    this.directory = directory
  }

  onInterruption(callback: (msg: InterruptedMessage) => void): void {
    this.interruptionCallback = callback
  }

  onMessage(callback: (msg: { role: string; content: string }) => void): void {
    this.messageCallback = callback
  }

  async startEventListener(): Promise<void> {
    this.eventSource = new AbortController()
    try {
      const events = await this.client.event.subscribe()
      console.log(`[事件监听] 已订阅事件, sessionId: ${this.id}`)
      ;(async () => {
        try {
          for await (const event of events.stream) {
            if (event.type === "session.status") {
              console.log(`[事件] 收到 session.status: ${JSON.stringify(event.properties)}`)
            }
            if (event.type === "message.part.updated") {
              const part = (event.properties as any)?.part
              if (part?.sessionID === this.id && part?.type === "text") {
                const text = (part as any)?.text
                if (text && this.messageCallback) {
                  this.messageCallback({ role: "assistant", content: text })
                }
              }
            }
          }
        } catch (e) {
          console.error("[事件监听] 错误:", e)
        }
      })()
    } catch (e) {
      console.error("[事件订阅] 失败:", e)
    }
  }

  async stopEventListener(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.abort()
      this.eventSource = null
    }
  }

  private messageBaselineId: string = ""
  private messageBaselineTime: number = 0

  private async checkForExternalActivity(): Promise<{ detected: boolean; newUserMessage: string | null }> {
    try {
      const messages = await this.client.session.messages({
        path: { id: this.id },
        query: { directory: this.directory, limit: 20 },
      })
      const msgList = messages.data || []

      const pendingContent = this.pendingMessage?.content ?? ""

      for (let i = msgList.length - 1; i >= 0; i--) {
        const m = msgList[i] as any
        if (m?.info?.role === "user") {
          const msgId = m.info?.id ?? ""
          const msgTime = new Date(m.info?.createdAt ?? 0).getTime()

          if (msgId === this.messageBaselineId && msgTime <= this.messageBaselineTime) {
            continue
          }

          const userContent = (m.parts || [])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("")

          console.log(`[检测] 发现新的用户消息 (id=${msgId}, time=${msgTime})`)
          if (userContent !== pendingContent) {
            console.log(
              `[检测] 内容不同于我们发送的: 我们=${pendingContent.substring(0, 30)}..., 实际=${userContent.substring(0, 30)}...`,
            )
            return { detected: true, newUserMessage: userContent }
          }
        }
      }
    } catch (e) {
      console.log("[检测] 检查外部活动出错:", e)
    }
    return { detected: false, newUserMessage: null }
  }

  setMessageBaseline(): void {
    this.messageBaselineTime = Date.now()
    this.messageBaselineId = ""
  }

  async sendMessage(message: { role: string; content: string }): Promise<string> {
    this.messageHistory.push(message)

    this.messageSequence++
    this.pendingMessage = {
      content: message.content,
      timestamp: new Date(),
      sequence: this.messageSequence,
    }

    const previousContent = this.lastReceivedMessageContent
    const abortCtrl = new AbortController()
    this.abortController = abortCtrl

    const pollForActivity = async () => {
      while (!abortCtrl.signal.aborted) {
        await new Promise((r) => setTimeout(r, 1000))
        if (abortCtrl.signal.aborted) break

        const { detected, newUserMessage } = await this.checkForExternalActivity()
        if (detected && newUserMessage) {
          console.log("[检测] 检测到外部活动（新用户消息），触发中断")
          abortCtrl.abort()
          if (this.interruptionCallback) {
            this.interruptionCallback({
              nodeName: "未知节点",
              roleName: "未知角色",
              beforeMessage: this.pendingMessage?.content ?? "",
              receivedMessage: newUserMessage,
              timestamp: new Date(),
              reason: "resend",
            })
          }
          return true
        }
      }
      return false
    }

    const pollPromise = pollForActivity()

    const response = await this.client.session.prompt({
      path: { id: this.id },
      body: {
        parts: [{ type: "text", text: message.content }],
        system: message.role === "system" ? message.content : undefined,
      },
      query: { directory: this.directory },
    })

    abortCtrl.abort()
    this.abortController = null
    this.pendingMessage = null

    const activityDetected = await pollPromise
    if (activityDetected) {
      throw new Error("检测到外部活动，消息发送被中断")
    }

    let responseText = ""
    if (response.data?.parts) {
      for (const p of response.data.parts) {
        if (p.type === "text") {
          responseText += (p as { text: string }).text + "\n"
        }
      }
      if (responseText) {
        const trimmed = responseText.trim()
        this.messageHistory.push({ role: "assistant", content: trimmed })
        this.lastReceivedMessageContent = trimmed

        const messages = await this.client.session.messages({
          path: { id: this.id },
          query: { directory: this.directory, limit: 5 },
        })
        const msgList = messages.data || []
        const lastUserMsg = msgList.find((m: any) => m.info?.role === "user")
        if (lastUserMsg) {
          this.messageBaselineId = lastUserMsg.info?.id ?? ""
          this.messageBaselineTime = lastUserMsg.info?.time?.created ?? 0
          console.log(`[基准] 更新基准: id=${this.messageBaselineId}, time=${this.messageBaselineTime}`)
        }

        return trimmed
      }
    }
    return responseText
  }

  async getMessages(): Promise<Array<{ role: string; content: string }>> {
    return [...this.messageHistory]
  }

  getLastAssistantMessage(): string | null {
    for (let i = this.messageHistory.length - 1; i >= 0; i--) {
      const msg = this.messageHistory[i]
      if (msg && msg.role === "assistant") {
        return msg.content
      }
    }
    return null
  }

  clearLastAssistantMessage(): void {
    for (let i = this.messageHistory.length - 1; i >= 0; i--) {
      const msg = this.messageHistory[i]
      if (msg && msg.role === "assistant") {
        this.messageHistory.splice(i, 1)
        break
      }
    }
  }
}

async function prompt(question: string): Promise<string> {
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

async function selectSession(
  baseUrl: string,
  directory: string,
): Promise<{ client: OpencodeClient; sessionId: string; directory: string }> {
  console.log("=".repeat(60))
  console.log("选择会话")
  console.log("=".repeat(60))
  console.log()

  const client = createOpencodeClient({ baseUrl })
  const sessions = await client.session.list()
  const sessionList = sessions.data ?? []
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
      console.log(`     更新于: ${updatedAt}`)
      console.log()
    }
  } else {
    console.log("  (暂无已有会话)")
    console.log()
  }

  let selected = 0
  let selectedSession: (typeof sessionList)[0] | null = null

  while (true) {
    const answer = await prompt("请输入选项 (0-新增, 1-" + MAX_RECENT + "选最近会话, 或输入字符按会话名称搜索): ")
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
      console.log("无效的选项，请重新输入")
    }
  }

  console.log()

  if (selected === 0) {
    console.log("[创建] 打开新会话...")
    const defaultDir = directory
    const dirAnswer = await prompt(`项目目录 (直接回车使用: ${defaultDir}): `)
    const sessionDir = dirAnswer.trim() || defaultDir

    const titleAnswer = await prompt("会话标题 (直接回车使用默认): ")
    const sessionTitle = titleAnswer.trim() || "RalphLoopCore 集成测试"

    console.log(`[配置] 目录: ${sessionDir}`)
    console.log(`[配置] 标题: ${sessionTitle}`)

    const session = await client.session.create({
      query: { directory: sessionDir },
      body: { title: sessionTitle },
    })
    if (!session.data) {
      throw new Error("创建会话失败")
    }
    console.log(`[创建] 新会话: ${session.data.id}`)
    return { client, sessionId: session.data.id, directory: sessionDir }
  } else if (selectedSession) {
    console.log(`[选择] 使用已有会话: ${selectedSession.id} - ${selectedSession.title ?? "(无标题)"}`)
    return { client, sessionId: selectedSession.id, directory }
  } else {
    const recentSessions = sessionList.slice(0, MAX_RECENT)
    const s = recentSessions[selected - 1]
    if (!s) {
      throw new Error("会话不存在")
    }
    console.log(`[选择] 使用已有会话: ${s.id} - ${s.title ?? "(无标题)"}`)
    return { client, sessionId: s.id, directory }
  }
}

async function askUserWhereToGo(engine: LoopEngine, interruptedMsg: InterruptedMessage): Promise<string> {
  const reasonText = interruptedMsg.reason === "resend" ? "⚠️  检测到您在WebUI中变更了消息" : "⚠️  检测到会话被中断"

  console.log("\n" + "=".repeat(60))
  console.log(reasonText)
  console.log("=".repeat(60))
  console.log(`  节点名称: ${interruptedMsg.nodeName}`)
  console.log(`  角色名称: ${interruptedMsg.roleName}`)
  console.log(`  中断前消息: ${interruptedMsg.beforeMessage.substring(0, 100)}...`)
  console.log(`  当前收到消息: ${interruptedMsg.receivedMessage.substring(0, 100)}...`)
  console.log(`  检测时间: ${interruptedMsg.timestamp.toLocaleString()}`)
  console.log()

  const strategy = engine.getStrategy()
  if (!strategy) {
    throw new Error("策略未加载")
  }

  const nodeNames = strategy.nodes.map((n) => n.name)
  console.log("当前策略可用节点:")
  for (let i = 0; i < nodeNames.length; i++) {
    console.log(`  ${i + 1}. ${nodeNames[i]}`)
  }
  console.log()

  if (interruptedMsg.reason === "resend") {
    console.log("提示: 您在WebUI中重新发送了消息，原执行流程已中断。")
    console.log("请选择将新消息派发给哪个节点继续执行。")
    console.log()
  }

  while (true) {
    const answer = await prompt(`请选择将消息派发给哪个节点 (1-${nodeNames.length}): `)
    const idx = parseInt(answer, 10) - 1
    if (!isNaN(idx) && idx >= 0 && idx < nodeNames.length) {
      const targetNode = strategy.nodes[idx]
      if (targetNode) {
        return targetNode.id
      }
    }
    console.log("无效的选项，请重新输入")
  }
}

async function controlledExecute(engine: LoopEngine, session: OpenCodeSessionAdapter, task: string): Promise<void> {
  const strategy = engine.getStrategy()
  if (!strategy) {
    throw new Error("策略未加载")
  }

  let currentNodeId = strategy.entryNode
  let iteration = 0
  const maxIterations = 500

  let pendingInterrupt: InterruptedMessage | null = null

  session.onInterruption((msg) => {
    pendingInterrupt = msg
    console.log("\n[中断] 检测到会话中断，等待用户决策...")
  })

  while (iteration < maxIterations) {
    iteration++
    console.log(
      `\n[循环] iteration=${iteration}, currentNodeId=${currentNodeId}, pendingInterrupt=${pendingInterrupt ? "有" : "无"}`,
    )

    if (pendingInterrupt) {
      console.log(`[中断处理] 调用askUserWhereToGo`)
      const targetNodeId = await askUserWhereToGo(engine, pendingInterrupt)
      console.log(`\n[用户决策] 跳转到节点: ${targetNodeId}`)
      currentNodeId = targetNodeId
      pendingInterrupt = null
      continue
    }

    const node = strategy.nodes.find((n) => n.id === currentNodeId)
    if (!node) {
      console.error(`[错误] 节点 ${currentNodeId} 未找到`)
      break
    }

    console.log(`\n>>> 进入节点: ${node.name}`)
    engine.emit("nodeStart", node, engine.getState())

    const roleInstance = node.roles[0]
    if (!roleInstance) {
      console.log(`[跳过] 节点 ${node.name} 没有角色`)
      continue
    }

    const systemPrompt = roleInstance.role.systemPrompt
    const userMessage = task

    try {
      console.log(`\x1b[38;2;0;255;0m[发送>>]\x1b[0m system: ${systemPrompt.substring(0, 60)}...`)
      await session.sendMessage({ role: "system", content: systemPrompt })
      console.log(`\x1b[38;2;0;255;0m[发送]\x1b[0m user: ${userMessage}`)
      const response = await session.sendMessage({ role: "user", content: userMessage })

      console.log(`\x1b[38;2;0;255;0m[<<收到]\x1b[0m ${response.substring(0, 80)}...`)

      const result: Record<string, unknown> = {
        step: `role:${roleInstance.role.name}`,
        executed: `Role ${roleInstance.role.name} executed`,
        systemPrompt,
        weight: roleInstance.weight,
        status: "completed",
        session_output: response,
      }

      if (node.name === "终评节点") {
        result.qualityPassed = response.includes("通过") || response.includes("达标")
      }

      if (node.name === "体验节点") {
        result.ueApproved = response.includes("完成") || response.includes("通过")
        result.shouldExit = result.ueApproved === true
      }

      if (node.name === "分析节点") {
        result.needsReplan = false
      }

      console.log(`<<< 离开节点: ${node.name} [completed]`)
      engine.emit("nodeComplete", node, result as any, engine.getState())

      const ctx = engine.getContext()
      if (ctx.nodeResults) {
        ctx.nodeResults[currentNodeId] = result as any
      }

      if (engine.isWaitingForDecision()) {
        const nodeOptions = strategy.nodes.map((n) => n.id)
        engine.waitForDecision(nodeOptions)
        continue
      }

      const nextTransition = strategy.transitions.find((t) => t.from === currentNodeId && t.condition.type === "always")

      if (nextTransition) {
        const nextNodeId = nextTransition.to
        console.log(`\n⇢ 跳转: ${currentNodeId} → ${nextNodeId}`)
        engine.emit(
          "transition",
          currentNodeId,
          nextNodeId,
          { matched: true, targetNode: nextNodeId },
          engine.getState(),
        )
        currentNodeId = nextNodeId
      } else if (strategy.exitNodes.includes(currentNodeId)) {
        console.log("\n到达退出节点，执行完成")
        break
      } else {
        console.log(`\n[警告] 节点 ${currentNodeId} 没有出边`)
        break
      }
    } catch (error) {
      console.error(`[错误] ${error}`)
      const errMsg = error instanceof Error ? error.message : String(error)
      if (errMsg.includes("检测到外部活动")) {
        console.log("[错误恢复] 检测到外部活动，等待用户决策...")
        if (!pendingInterrupt) {
          console.error("[错误] pendingInterrupt 未设置，但检测到外部活动错误")
          engine.emit("nodeError", node, error as Error, engine.getState())
          break
        }
      } else {
        engine.emit("nodeError", node, error as Error, engine.getState())
        break
      }
    }
  }

  engine.emit("complete", { success: true, totalIterations: iteration }, engine.getState())
}

async function main() {
  console.log("=".repeat(60))
  console.log("RalphLoopCore × OpenCode 集成测试 (可控循环版)")
  console.log("=".repeat(60))
  console.log()

  const baseUrl = "http://127.0.0.1:4096"
  const directory = process.cwd()

  console.log(`[配置] 服务器: ${baseUrl}`)
  console.log(`[配置] 项目目录: ${directory}`)
  console.log()

  const { client, sessionId, directory: sessionDir } = await selectSession(baseUrl, directory)

  const session = new OpenCodeSessionAdapter(client, sessionId, sessionDir)
  await session.startEventListener()

  const engine = new LoopEngine({
    maxCycles: 5,
    cycleDelay: 1000,
  })

  engine.loadStrategy(ralphLoopStrategy)

  engine.on("paused", (node, reason) => {
    console.log(`\n[暂停] 节点 ${node.name} 已暂停，原因: ${reason}`)
  })

  engine.on("resumed", (node) => {
    console.log(`\n[恢复] 节点 ${node.name} 已恢复`)
  })

  engine.on("waitingForDecision", (node, options) => {
    console.log(`\n[等待决策] 节点 ${node.name} 等待决策，可选节点: ${options.join(", ")}`)
  })

  engine.on("decisionMade", (node, selected) => {
    console.log(`\n[决策] 节点 ${node.name} 决策完成，选择: ${selected}`)
  })

  engine.on("cycleComplete", (cycle) => {
    console.log(`\n${"=".repeat(40)}`)
    console.log(`第 ${cycle} 轮循环完成`)
    console.log(`${"=".repeat(40)}`)
  })

  engine.on("error", (error) => {
    console.error(`\n[执行错误] ${error.message}`)
  })

  // const task = "在F:/WebProjects/PTK_Official_Site/下面创建音乐游戏\"琴神排名\"的官方网站"
  const task = "在F:/WebProjects/PTK_Official_Site/下面写一个简单的python测试脚本, 实现print hello world"

  console.log(`\n开始任务: ${task}\n`)

  await controlledExecute(engine, session, task)

  console.log("\n历史记录:")
  for (const record of engine.getExecutionHistory()) {
    const status = record.state === "pass" ? "✓" : "✗"
    console.log(`  ${status} ${record.nodeName} (轮次: ${record.cycle}, 迭代: ${record.iteration})`)
  }

  await session.stopEventListener()
}

main().catch(console.error)
