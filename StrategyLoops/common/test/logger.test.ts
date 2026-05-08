/**
 * Logger 日志轮换测试
 * 测试日志文件的轮换逻辑：
 * 1. 未超过 n 分钟时只保留短日期文件（覆盖模式）
 * 2. 超过 n 分钟后产生带时间戳文件
 * 3. 每隔 n 分钟继续产生新时间戳文件
 */
/// <reference types="node" />
import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { rmSync, existsSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Logger 实际日志目录
const LOG_DIR = join(__dirname, "..", "log")

function getShortFileName(pid: number): string {
  const today = new Date().toISOString().split("T")[0]
  return `${today}-pid${pid}.log`
}

function getAllLogFiles(): string[] {
  if (!existsSync(LOG_DIR)) return []
  return readdirSync(LOG_DIR).filter((f: string) => f.endsWith(".log"))
}

function getTimestampLogFiles(): string[] {
  return getAllLogFiles().filter((f: string) => f.match(/^\d{4}-\d{2}-\d{2}-.+T.+-pid\d+\.log$/) !== null)
}

describe("Logger 日志轮换逻辑", () => {
  const testPids: number[] = []

  beforeEach(() => {
    // 清理测试产生的日志文件
    const files = getAllLogFiles()
    for (const file of files) {
      const match = file.match(/pid(\d+)/)
      if (match) {
        const filePid = parseInt(match[1], 10)
        if (process.pid === filePid || testPids.includes(filePid)) {
          try {
            rmSync(join(LOG_DIR, file))
          } catch {}
        }
      }
    }
  })

  afterEach(() => {
    // 清理所有测试产生的日志文件
    const files = getAllLogFiles()
    for (const file of files) {
      const match = file.match(/pid(\d+)/)
      if (match) {
        const filePid = parseInt(match[1], 10)
        if (process.pid === filePid || testPids.includes(filePid)) {
          try {
            rmSync(join(LOG_DIR, file))
          } catch {}
        }
      }
    }
    testPids.length = 0
    delete process.env.STRATEGY_LOOPS_LOG_ROTATION_MINUTES
  })

  test("短运行：未超过 n 分钟时只保留短日期文件", async () => {
    const { Logger } = await import("../logger")

    const logger = new Logger()
    const pid = process.pid
    testPids.push(pid)

    const shortFileName = getShortFileName(pid)
    const shortFilePath = join(LOG_DIR, shortFileName)

    logger.info("短运行测试日志")
    logger.close()

    // 等待文件 flush 到磁盘
    await new Promise((resolve) => setTimeout(resolve, 10))

    // 短文件应该存在
    expect(existsSync(shortFilePath)).toBe(true)

    // 还未切换到长时间运行模式
    expect(logger.isInLongRunningMode()).toBe(false)

    // 不应该有带时间戳的文件
    expect(getTimestampLogFiles().filter((f) => f.includes(`pid${pid}`))).toHaveLength(0)
  })

  test("超过 n 分钟后产生带时间戳文件并归档短文件", async () => {
    const { Logger } = await import("../logger")

    // 设置极短的轮换间隔（50ms）
    process.env.STRATEGY_LOOPS_LOG_ROTATION_MINUTES = "0.00083"

    const logger = new Logger()
    const pid = process.pid
    testPids.push(pid)

    const shortFileName = getShortFileName(pid)
    const shortFilePath = join(LOG_DIR, shortFileName)

    logger.info("初始日志")

    // 等待超过轮换时间
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 应该已切换到长时间运行模式
    expect(logger.isInLongRunningMode()).toBe(true)

    // 应该有带时间戳的文件
    const timestampFiles = getTimestampLogFiles().filter((f) => f.includes(`pid${pid}`))
    expect(timestampFiles.length).toBeGreaterThan(0)

    // 当前文件应该是带时间戳的
    const currentPath = logger.getCurrentFilePath()
    expect(currentPath).toContain("T")

    // 短文件应该不存在（已被归档）
    expect(existsSync(shortFilePath)).toBe(false)

    logger.close()
  })

  test("每 n 分钟产生新的时间戳文件", async () => {
    const { Logger } = await import("../logger")

    // 设置轮换间隔为60ms
    process.env.STRATEGY_LOOPS_LOG_ROTATION_MINUTES = "0.001"

    const logger = new Logger()
    const pid = process.pid
    testPids.push(pid)

    logger.info("初始日志")

    // 等待第一次轮换
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(logger.isInLongRunningMode()).toBe(true)

    const firstTimestampFiles = getTimestampLogFiles().filter((f) => f.includes(`pid${pid}`))
    const firstCount = firstTimestampFiles.length

    // 写入日志
    logger.info("第一次轮换后日志")

    // 等待第二次轮换
    await new Promise((resolve) => setTimeout(resolve, 80))

    const secondTimestampFiles = getTimestampLogFiles().filter((f) => f.includes(`pid${pid}`))
    expect(secondTimestampFiles.length).toBeGreaterThan(firstCount)

    logger.close()
  })

  test("无效环境变量使用默认值", async () => {
    const { Logger } = await import("../logger")

    process.env.STRATEGY_LOOPS_LOG_ROTATION_MINUTES = "invalid"

    const logger = new Logger()
    const pid = process.pid
    testPids.push(pid)

    const shortFileName = getShortFileName(pid)
    const shortFilePath = join(LOG_DIR, shortFileName)

    logger.info("测试无效环境变量")
    logger.close()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // 未超时前应该是短文件模式
    expect(logger.isInLongRunningMode()).toBe(false)
    expect(existsSync(shortFilePath)).toBe(true)
  })

  test("负数环境变量使用默认值", async () => {
    const { Logger } = await import("../logger")

    process.env.STRATEGY_LOOPS_LOG_ROTATION_MINUTES = "-5"

    const logger = new Logger()
    const pid = process.pid
    testPids.push(pid)

    const shortFileName = getShortFileName(pid)
    const shortFilePath = join(LOG_DIR, shortFileName)

    logger.info("测试负数环境变量")
    logger.close()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // 未超时前应该是短文件模式
    expect(logger.isInLongRunningMode()).toBe(false)
    expect(existsSync(shortFilePath)).toBe(true)
  })

  test("零环境变量使用默认值", async () => {
    const { Logger } = await import("../logger")

    process.env.STRATEGY_LOOPS_LOG_ROTATION_MINUTES = "0"

    const logger = new Logger()
    const pid = process.pid
    testPids.push(pid)

    const shortFileName = getShortFileName(pid)
    const shortFilePath = join(LOG_DIR, shortFileName)

    logger.info("测试零环境变量")
    logger.close()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // 未超时前应该是短文件模式
    expect(logger.isInLongRunningMode()).toBe(false)
    expect(existsSync(shortFilePath)).toBe(true)
  })
})