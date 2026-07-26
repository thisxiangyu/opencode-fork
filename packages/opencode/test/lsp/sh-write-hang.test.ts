import { describe, expect, test } from "bun:test"
import { Npm } from "@opencode-ai/core/npm"
import { BashLS } from "../../src/lsp/server"

// 定制（Windows 兼容性修复）回归测试：写入 .sh 文件触发 LSP 时不得阻塞
// 1. Npm.which(install=false) 仅查缓存，不触发 npm install（受限网络下会挂起）
// 2. Windows 上跳过 bash-language-server 启动
describe(".sh file write hang fix", () => {
  test("Npm.which should not hang when install=false", async () => {
    const start = Date.now()
    const TIMEOUT = 2000

    const result = await Promise.race([
      Npm.which("bash-language-server", undefined, false),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Npm.which timed out - hang detected!")), TIMEOUT),
      ),
    ])

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT)
    // Result is either undefined (not cached) or a string path (cached)
    expect(result === undefined || typeof result === "string").toBe(true)
  })

  test("BashLS.spawn should return undefined on Windows", async () => {
    if (process.platform !== "win32") {
      console.log("Skipping Windows-specific test on non-Windows platform")
      return
    }

    const start = Date.now()
    const TIMEOUT = 1000

    // win32 分支在使用 ctx/flags 之前即返回，此处以桩对象调用
    const result = await Promise.race([
      BashLS.spawn(process.cwd(), { directory: process.cwd() } as any, {} as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("BashLS.spawn timed out - hang detected!")), TIMEOUT),
      ),
    ])

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT)
    expect(result).toBeUndefined()
  })

  test("should complete quickly when resolving non-existent package without install", async () => {
    const start = Date.now()
    const result = await Npm.which("definitely-not-a-real-package-xyz", undefined, false)
    const elapsed = Date.now() - start

    // Should complete in less than 500ms (no network/installation)
    expect(elapsed).toBeLessThan(500)
    expect(result).toBeUndefined()
  })
})
