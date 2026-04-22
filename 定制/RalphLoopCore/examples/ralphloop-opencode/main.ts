import { LoopEngine } from "../../src/index.js"
import { logger, consoleAndLogFile } from "../../src/logger"
import * as path from "path"
import { ralphLoopStrategy } from "./strategy"
import { OpenCodeSessionAdapter } from "./session-adapter"
import { selectSessionInstance } from "./session-manager"
import { controlledExecute } from "./engine-runner"

const ServerURL = "http://127.0.0.1:4096"
const DEFAULT_TASK = "路径: F:/WebProjects/PTK_Official_Site/  任务:为名为\"琴神排名\"的音乐游戏项目开发官方网站"

export async function main(task: string = DEFAULT_TASK): Promise<void> {
  consoleAndLogFile.info(`RLC × OpenCode 集成测试`)
  consoleAndLogFile.info(`服务器URL: ${ServerURL}`)
  consoleAndLogFile.info(`当前进程目录: ${process.cwd()}`)
  consoleAndLogFile.info(`日志目录: ${path.join(process.cwd(), "log")}`)

  const { client, sessionId, directory: sessionDir } = await selectSessionInstance(ServerURL, process.cwd(),"Opencode")

  const session = new OpenCodeSessionAdapter(client, sessionId, sessionDir)
  await session.startEventListener()

  const engine = new LoopEngine({
    maxCycles: 5,
    cycleDelay: 1000,
  })

  engine.loadStrategy(ralphLoopStrategy)

  engine.on("paused", (node, reason) => {
    logger.info(`[暂停] ${node.name}: ${reason}`)
  })

  engine.on("resumed", (node) => {
    logger.info(`[恢复] ${node.name}`)
  })

  engine.on("waitingForDecision", (node, options) => {
    consoleAndLogFile.info(`[等待决策] ${node.name}: ${options.join(", ")}`)
  })

  engine.on("decisionMade", (node, selected) => {
    logger.info(`[决策] ${node.name}: ${selected}`)
  })

  engine.on("cycleComplete", (cycle) => {
    logger.info(`[循环 ${cycle}] 完成`)
  })

  engine.on("error", (error) => {
    logger.error(`[执行错误] ${error.message}`)
  })

  logger.info(`任务: ${task}`)

  await controlledExecute(engine, session, task)

  logger.info("\n历史记录:")
  for (const record of engine.getExecutionHistory()) {
    const status = record.state === "pass" ? "✓" : "✗"
    logger.info(`  ${status} ${record.nodeName} (轮次: ${record.cycle}, 迭代: ${record.iteration})`)
  }

  await session.stopEventListener()
}

main().catch((e) => logger.error("主函数错误:", e))