import * as readline from "readline"

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
