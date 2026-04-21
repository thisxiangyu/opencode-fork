import type { LoopEngine } from "../../src/index.js"
import type { InterruptedMessage } from "./types"
import { MessageReceiveState, AbortError } from "./types"
import { logger, consoleAndLogFile } from "../../src/logger"
import type { OpenCodeSessionAdapter } from "./session-adapter"
import { askUserWhereToGo } from "./session-manager"

export async function controlledExecute(
  engine: LoopEngine,
  session: OpenCodeSessionAdapter,
  task: string,
): Promise<void> {
  const strategy = engine.getStrategy()
  if (!strategy) {
    throw new Error("策略未加载")
  }

  let currentNodeId = strategy.entryNode
  let iteration = 0
  const maxIterations = 500

  console.log(`[调试-controlledExecute] 初始状态: entryNode=${strategy.entryNode}, 节点总数=${strategy.nodes.length}`)
  console.log(`[调试-controlledExecute] 所有节点: ${strategy.nodes.map(n => n.name).join(", ")}`)

  let pendingInterrupt: InterruptedMessage | null = null

  session.onInterruption((msg) => {
    pendingInterrupt = msg
    logger.info(`[中断] reason=${msg.reason}`)
  })

  while (iteration < maxIterations) {
    iteration++

    logger.info(`[迭代 iteration=${iteration}] node=${currentNodeId}, sessionState=${session.getReceiveState()}`)
    console.log()

    if (pendingInterrupt) {
      const interrupt = pendingInterrupt as InterruptedMessage
      logger.info(`[中断处理] reason=${interrupt.reason}`)
      const targetNodeId = await askUserWhereToGo(engine, pendingInterrupt)
      logger.info(`[用户决策] 跳转: ${targetNodeId}`)
      currentNodeId = targetNodeId
      pendingInterrupt = null
      session.clearInterruption()
      continue
    }

    const node = strategy.nodes.find((n) => n.id === currentNodeId)
    if (!node) {
      logger.error(`[错误] 节点 ${currentNodeId} 未找到`)
      break
    }

    consoleAndLogFile.info(`>>> ${node.name}`)
    engine.emit("nodeStart", node, engine.getState())

    const roleInstance = node.roles[0]
    if (!roleInstance) {
      logger.info(`[跳过] 节点 ${node.name} 没有角色`)
      continue
    }

    const systemPrompt = roleInstance.role.systemPrompt
    const userMessage = task

    try {
      session.setCurrentContext(node.name, roleInstance.role.name)
      const agent = node.accessMode === "readonly" ? "plan" : "build"
      consoleAndLogFile.info(`[DEBUG] node.accessMode=${node.accessMode}, calculated agent=${agent}`)
      await session.sendMessage({ role: "system", content: systemPrompt }, agent)
      logger.info(`[发送] user: ${userMessage.substring(0, 50)}...`)
      const response = await session.sendMessage({ role: "user", content: userMessage }, agent)

      if (session.getReceiveState() === MessageReceiveState.EXPECTING_NEXT_MESSAGE) {
        consoleAndLogFile.info(`[节点暂停] 等待用户消息...`)
        const userInput = await session.waitForUserMessage()
        consoleAndLogFile.info(`[节点继续] 收到用户消息: "${userInput.substring(0, 30)}..."`)
        continue
      }

      logger.info(`[收到] ${response.substring(0, 50)}...`)

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

      logger.info(`<<< ${node.name} 完成`)
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

      const nextTransition = strategy.transitions.find(
        (t) => t.from === currentNodeId && t.condition.type === "always",
      )

      if (nextTransition) {
        const nextNodeId = nextTransition.to
        logger.info(`⇢ 跳转: ${currentNodeId} → ${nextNodeId}`)
        engine.emit(
          "transition",
          currentNodeId,
          nextNodeId,
          { matched: true, targetNode: nextNodeId },
          engine.getState(),
        )
        currentNodeId = nextNodeId
      } else if (strategy.exitNodes.includes(currentNodeId)) {
        consoleAndLogFile.info(`[完成] 到达退出节点`)
        break
      } else {
        logger.info(`[警告] 节点 ${currentNodeId} 没有出边`)
        break
      }
    } catch (error) {
      const err = error as Error
      if (err.name === "AbortError" || err.message.includes("Session aborted")) {
        consoleAndLogFile.info(`[暂停] ========== [已暂停] ==========, 当前state=${session.getReceiveState()}`)
        session.setCurrentContext(node.name, roleInstance.role.name)

        try {
          consoleAndLogFile.info(`[暂停] 开始等待用户消息和模型响应...`)
          const modelResponse = await session.waitForUserMessage()
          consoleAndLogFile.info(`[暂停] 收到模型响应: "${modelResponse.substring(0, 30)}..."`)

          const result: Record<string, unknown> = {
            step: `role:${roleInstance.role.name}`,
            executed: `Role ${roleInstance.role.name} executed (after pause)`,
            systemPrompt,
            weight: roleInstance.weight,
            status: "completed",
            session_output: modelResponse,
          }

          if (node.name === "终评节点") {
            result.qualityPassed = modelResponse.includes("通过") || modelResponse.includes("达标")
          }

          if (node.name === "体验节点") {
            result.ueApproved = modelResponse.includes("完成") || modelResponse.includes("通过")
            result.shouldExit = result.ueApproved === true
          }

          if (node.name === "分析节点") {
            result.needsReplan = false
          }

          logger.info(`<<< ${node.name} 完成 (暂停后)`)
          engine.emit("nodeComplete", node, result as any, engine.getState())

          const ctx = engine.getContext()
          if (ctx.nodeResults) {
            ctx.nodeResults[currentNodeId] = result as any
          }

          session.clearInterruption()

          const nextTransition = strategy.transitions.find(
            (t) => t.from === currentNodeId && t.condition.type === "always",
          )

          if (nextTransition) {
            const nextNodeId = nextTransition.to
            logger.info(`⇢ 跳转: ${currentNodeId} → ${nextNodeId}`)
            engine.emit(
              "transition",
              currentNodeId,
              nextNodeId,
              { matched: true, targetNode: nextNodeId },
              engine.getState(),
            )
            currentNodeId = nextNodeId
          } else if (strategy.exitNodes.includes(currentNodeId)) {
            consoleAndLogFile.info(`[完成] 到达退出节点`)
            break
          } else {
            logger.info(`[警告] 节点 ${currentNodeId} 没有出边`)
            break
          }

          continue
        } catch (e) {
          const waitErr = e as Error
          logger.info(`[暂停] 等待结束: ${waitErr.message}`)
          break
        }
      }

      logger.error(`[错误] ${error}`)
      const errMsg = err.message
      if (errMsg.includes("检测到外部活动")) {
        logger.info(`[错误恢复] 检测到外部活动`)
        if (!pendingInterrupt) {
          logger.error(`[错误] pendingInterrupt 未设置`)
          engine.emit("nodeError", node, error as Error, engine.getState())
          break
        }
        const targetNodeId = await askUserWhereToGo(engine, pendingInterrupt as InterruptedMessage)
        logger.info(`[用户决策] 跳转: ${targetNodeId}`)
        currentNodeId = targetNodeId
        pendingInterrupt = null
        session.clearInterruption()
        continue
      } else {
        engine.emit("nodeError", node, error as Error, engine.getState())
        break
      }
    }
  }

  engine.emit("complete", { success: true, totalIterations: iteration }, engine.getState())
}