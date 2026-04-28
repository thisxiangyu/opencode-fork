import * as readline from "readline"

export const CHANNEL = process.env.CHANNEL as "Release" | "Test" ?? "Release"
export const IS_TEST = CHANNEL === "Test"

export const TIME_PERIODS = [
  "早晨",   // 5:00-7:59
  "上午",   // 8:00-11:59
  "中午",   // 12:00-12:59
  "下午",   // 13:00-17:59
  "傍晚",   // 18:00-18:59
  "晚上",   // 19:00-23:59
  "午夜",   // 0:00-4:59
] as const

export type TimePeriod = typeof TIME_PERIODS[number]

export function getTimePeriod(date: Date = new Date()): TimePeriod {
  const hour = date.getHours()
  if (hour >= 5 && hour < 8) return "早晨"
  if (hour >= 8 && hour < 12) return "上午"
  if (hour >= 12 && hour < 13) return "中午"
  if (hour >= 13 && hour < 18) return "下午"
  if (hour >= 18 && hour < 19) return "傍晚"
  if (hour >= 19 && hour < 24) return "晚上"
  return "午夜"
}

export interface FormatDateTimeOptions {
  period?: TimePeriod | "auto"
  showYear?: boolean
  showPeriod?: boolean
  showTime?: boolean
  showSeconds?: boolean
  isoString: string
}

export function formatDateTime(options: FormatDateTimeOptions): string {
  const date = new Date(options.isoString)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const period = options.period === "auto" || options.period === undefined
    ? getTimePeriod(date)
    : options.period
  const yearStr = options.showYear !== false ? `${year}年` : ""
  const periodStr = options.showPeriod ? `${period}` : ""
  const timeStr = options.showTime
    ? ` ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}${options.showSeconds ? `:${date.getSeconds().toString().padStart(2, "0")}` : ""}`
    : ""
  return `${yearStr}${month}月${day}日${periodStr}${timeStr}`
}

export async function askUser(question: string): Promise<string> {
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

export async function askUserWithTimeout(
  question: string,
  timeoutMs: number,
): Promise<string | null> {
  process.stdout.write(question)
  const stdin = process.stdin
  if (stdin.isTTY) {
    stdin.setEncoding("utf8")
    stdin.resume()
    stdin.setRawMode(true)
  }
  return new Promise((resolve) => {
    let settled = false
    let buffer = ""
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdin.off("data", onData)
      if (stdin.isTTY) {
        stdin.setRawMode(false)
      }
      process.stdout.write("\n")
      resolve(value)
    }
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk)
      for (const char of text) {
        if (char === "\u0003") {
          finish(buffer.length > 0 ? buffer : null)
          return
        }
        if (char === "\r" || char === "\n") {
          finish(buffer)
          return
        }
        if (char === "\u0008" || char === "\u007f") {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1)
            process.stdout.write("\b \b")
          }
          continue
        }
        buffer += char
        process.stdout.write(char)
      }
    }
    const timer = setTimeout(() => {
      finish(buffer.length > 0 ? buffer : null)
    }, timeoutMs)
    stdin.on("data", onData)
  })
}
