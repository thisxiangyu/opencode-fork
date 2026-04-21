import * as fs from "fs"
import * as path from "path"

const LOG_DIR = "D:\\AI Model\\opencode-fork\\定制\\RalphLoopCore\\log"

type LogLevel = "info" | "warn" | "error"

type LoggerMode = "fileOnly" | "both"

class Logger {
  private logStream: fs.WriteStream | null = null
  private logFilePath: string = ""
  private consoleInfo: boolean = false
  private consoleWarn: boolean = false
  private consoleError: boolean = false

  constructor() {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true })
    }
    const today = new Date().toISOString().split("T")[0]
    this.logFilePath = path.join(LOG_DIR, `${today}.log`)
    this.logStream = fs.createWriteStream(this.logFilePath, { flags: "w" })
    this.setMode("fileOnly")
    const initLine = (msg: string) => this.logStream?.write(`[${new Date().toISOString()}] [INFO] ${msg}\n`)
    initLine("=".repeat(60))
    initLine(`[启动] 日志文件: ${this.logFilePath}`)
  }

  setMode(mode: LoggerMode) {
    this.consoleInfo = mode === "both"
    this.consoleWarn = mode === "both"
    this.consoleError = mode === "both"
  }

  format(...args: any[]): string {
    return args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")
  }

  private write(level: LogLevel, line: string) {
    if (this.logStream) {
      this.logStream.write(line + "\n")
    }
  }

  info(...args: any[]) {
    const message = this.format(...args)
    this.write("info", `[${new Date().toISOString()}] [INFO] ${message}`)
    if (this.consoleInfo) {
      console.log(message)
    }
  }

  warn(...args: any[]) {
    const message = this.format(...args)
    this.write("warn", `[${new Date().toISOString()}] [WARN] ${message}`)
    if (this.consoleWarn) {
      console.warn(message)
    }
  }

  error(...args: any[]) {
    const message = this.format(...args)
    this.write("error", `[${new Date().toISOString()}] [ERROR] ${message}`)
    if (this.consoleError) {
      console.error(message)
    }
  }

  close() {
    if (this.logStream) {
      this.logStream.end()
      this.logStream = null
    }
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
      if (prop === "warn") {
        return (...args: any[]) => {
          target.warn(...args)
          console.warn(target.format(...args))
        }
      }
      if (prop === "error") {
        return (...args: any[]) => {
          target.error(...args)
          console.error(target.format(...args))
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

export const logger = loggerInstance
export const consoleAndLogFile = createConsoleProxy(loggerInstance)
