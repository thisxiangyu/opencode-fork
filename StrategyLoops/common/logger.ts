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

const DEFAULT_COLORS: Record<LogLevel, LogColor> = {
  info: "white",
  warn: "yellow",
  error: "red",
}

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
    this.logFilePath = path.join(LOG_DIR, `${today}-pid${process.pid}.log`)
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

  write(level: LogLevel, line: string) {
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
      if (prop === "infoC") {
        return (color: LogColor, ...args: any[]) => {
          const message = target.format(...args)
          target.write("info", `[${new Date().toISOString()}] [INFO] ${message}`)
          console.log(`${COLOR_CODES[color]}${message}${RESET}`)
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
          const message = target.format(...args)
          target.write("warn", `[${new Date().toISOString()}] [WARN] ${message}`)
          console.warn(`${COLOR_CODES[color]}${message}${RESET}`)
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
          const message = target.format(...args)
          target.write("error", `[${new Date().toISOString()}] [ERROR] ${message}`)
          console.error(`${COLOR_CODES[color]}${message}${RESET}`)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

export const logFile = loggerInstance
export const consoleAndLogFile = createConsoleProxy(loggerInstance)
export { LOG_COLOR, RESET }
export type { LogColor }
