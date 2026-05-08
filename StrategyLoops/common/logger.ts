import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const LOG_DIR = path.resolve(__dirname, "log")

type LogLevel = "info" | "warn" | "error"

type LoggerMode = "fileOnly" | "both"

type LogColor = "white" | "green" | "yellow" | "red" | "cyan" | "magenta"

const COLOR_CODES: Record<LogColor, string> = {
  white: "\x1b[37m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
}

const LOG_COLOR = {
  WHITE: "white" as const,
  GREEN: "green" as const,
  YELLOW: "yellow" as const,
  RED: "red" as const,
  CYAN: "cyan" as const,
  MAGENTA: "magenta" as const,
}

const RESET = "\x1b[0m"

const DEFAULT_ROTATION_MINUTES = 15

/** 生成时间戳日志文件名，使用同一个 Date 对象避免日期和时间戳不一致 */
function makeTimestampFileName(date: Date, pid: number): string {
  const isoString = date.toISOString().replace(/[:.]/g, "-")
  const datePart = isoString.split("T")[0]
  return `${datePart}-${isoString}-pid${pid}.log`
}

function getRotationMinutes(): number {
  const env = process.env.STRATEGY_LOOPS_LOG_ROTATION_MINUTES
  if (env !== undefined) {
    const parsed = Number(env)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_ROTATION_MINUTES
}

class Logger {
  private logStream!: fs.WriteStream
  private shortFilePath: string = ""
  private currentFilePath: string = ""
  private consoleInfo = false
  private consoleWarn = false
  private consoleError = false
  private isLongRunning = false
  private longRunningTimer: NodeJS.Timeout | null = null
  private rotationTimer: NodeJS.Timeout | null = null
  private readonly rotationMinutes: number
  private readonly rotationIntervalMs: number
  private readonly startTime: Date

  constructor() {
    this.startTime = new Date()
    this.rotationMinutes = getRotationMinutes()
    this.rotationIntervalMs = this.rotationMinutes * 60 * 1000

    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true })
    }

    const today = new Date().toISOString().split("T")[0]
    this.shortFilePath = path.join(LOG_DIR, `${today}-pid${process.pid}.log`)
    this.currentFilePath = this.shortFilePath

    this.logStream = fs.createWriteStream(this.currentFilePath, { flags: "w" })
    this.setMode("fileOnly")

    const initLine = (msg: string) => this.logStream.write(`[${new Date().toISOString()}] [INFO] ${msg}\n`)
    initLine("=".repeat(60))
    initLine(`[启动] 日志文件: ${this.currentFilePath}`)
    initLine(`[模式] 短文件模式 (覆盖)，将在 ${this.rotationMinutes} 分钟后切换为长时间运行模式`)

    // 设置定时器，在 rotationMinutes 分钟后判定为长时间运行
    this.longRunningTimer = setTimeout(() => this.switchToLongRunning(), this.rotationIntervalMs)
    this.longRunningTimer.unref()
  }

  private switchToLongRunning() {
    if (this.isLongRunning) return
    this.isLongRunning = true

    const archivedFileName = makeTimestampFileName(this.startTime, process.pid)
    const archivedFilePath = path.join(LOG_DIR, archivedFileName)
    const now = new Date()
    const newFileName = makeTimestampFileName(now, process.pid)
    const newFilePath = path.join(LOG_DIR, newFileName)

    // 等待流完全关闭后再重命名，避免竞态
    this.logStream.end()
    this.logStream.on("finish", () => {
      // rename 完成后才写"归档完成"日志
      if (fs.existsSync(this.shortFilePath)) {
        fs.renameSync(this.shortFilePath, archivedFilePath)
      }
      this.currentFilePath = newFilePath
      this.logStream = fs.createWriteStream(this.currentFilePath, { flags: "w" })
      this.logStream.write(`[${now.toISOString()}] [INFO] ${"=".repeat(60)}\n`)
      this.logStream.write(`[${now.toISOString()}] [INFO] [模式切换] 短文件已归档: ${archivedFileName}\n`)
      this.logStream.write(`[${now.toISOString()}] [INFO] [模式] 长时间运行模式，每 ${this.rotationMinutes} 分钟轮换\n`)
      this.logStream.write(`[${now.toISOString()}] [INFO] [轮换] 新日志文件: ${newFileName}\n`)
    })

    // 设置周期性轮换定时器
    this.rotationTimer = setInterval(() => this.rotateLogFile(), this.rotationIntervalMs)
    this.rotationTimer.unref()
  }

  private isRotating = false

  private rotateLogFile() {
    if (!this.isLongRunning || this.isRotating) return
    this.isRotating = true

    const now = new Date()
    const newFileName = makeTimestampFileName(now, process.pid)
    const newFilePath = path.join(LOG_DIR, newFileName)

    this.logStream.end()
    this.logStream.on("finish", () => {
      this.currentFilePath = newFilePath
      this.logStream = fs.createWriteStream(this.currentFilePath, { flags: "w" })
      this.logStream.write(`[${now.toISOString()}] [INFO] ${"=".repeat(60)}\n`)
      this.logStream.write(`[${now.toISOString()}] [INFO] [轮换] 新日志文件: ${newFileName}\n`)
      this.isRotating = false
    })
  }

  setMode(mode: LoggerMode) {
    this.consoleInfo = mode === "both"
    this.consoleWarn = mode === "both"
    this.consoleError = mode === "both"
  }

  format(...args: any[]): string {
    return args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
  }

  write(level: LogLevel, line: string) {
    this.logStream.write(line + "\n")
  }

  info(...args: any[]) {
    const message = this.format(...args)
    this.write("info", `[${new Date().toISOString()}] [INFO] ${message}`)
    if (this.consoleInfo) {
      console.log(message)
    }
  }

  infoC(color: LogColor, ...args: any[]) {
    const message = this.format(...args)
    this.write("info", `[${new Date().toISOString()}] [INFO] ${message}`)
    if (this.consoleInfo) {
      console.log(`${COLOR_CODES[color]}${message}${RESET}`)
    }
  }

  warn(...args: any[]) {
    const message = this.format(...args)
    this.write("warn", `[${new Date().toISOString()}] [WARN] ${message}`)
    if (this.consoleWarn) {
      console.warn(message)
    }
  }

  warnC(color: LogColor, ...args: any[]) {
    const message = this.format(...args)
    this.write("warn", `[${new Date().toISOString()}] [WARN] ${message}`)
    if (this.consoleWarn) {
      console.warn(`${COLOR_CODES[color]}${message}${RESET}`)
    }
  }

  error(...args: any[]) {
    const message = this.format(...args)
    this.write("error", `[${new Date().toISOString()}] [ERROR] ${message}`)
    if (this.consoleError) {
      console.error(message)
    }
  }

  errorC(color: LogColor, ...args: any[]) {
    const message = this.format(...args)
    this.write("error", `[${new Date().toISOString()}] [ERROR] ${message}`)
    if (this.consoleError) {
      console.error(`${COLOR_CODES[color]}${message}${RESET}`)
    }
  }

  close() {
    if (this.longRunningTimer) {
      clearTimeout(this.longRunningTimer)
    }
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
    }
    this.logStream.end()
  }

  /**
   * 【测试专用】获取当前日志文件路径
   * @deprecated 仅用于单元测试，生产代码不应依赖此方法
   */
  getCurrentFilePath(): string {
    return this.currentFilePath
  }

  /**
   * 【测试专用】检查是否为长时间运行模式
   * @deprecated 仅用于单元测试，生产代码不应依赖此方法
   */
  isInLongRunningMode(): boolean {
    return this.isLongRunning
  }
}

const loggerInstance = new Logger()

const createConsoleProxy = (base: Logger): Logger =>
  new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "info") {
        return (...args: any[]) => {
          target.info(...args)
          console.log(target.format(...args))
        }
      }
      if (prop === "infoC") {
        return (color: LogColor, ...args: any[]) => {
          target.infoC(color, ...args)
        }
      }
      if (prop === "warn") {
        return (...args: any[]) => {
          target.warn(...args)
          console.warn(target.format(...args))
        }
      }
      if (prop === "warnC") {
        return (color: LogColor, ...args: any[]) => {
          target.warnC(color, ...args)
        }
      }
      if (prop === "error") {
        return (...args: any[]) => {
          target.error(...args)
          console.error(target.format(...args))
        }
      }
      if (prop === "errorC") {
        return (color: LogColor, ...args: any[]) => {
          target.errorC(color, ...args)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

export const logFile = loggerInstance
export const consoleAndLogFile = createConsoleProxy(loggerInstance)
export { LOG_COLOR, RESET }
export type { LogColor }
export { Logger }