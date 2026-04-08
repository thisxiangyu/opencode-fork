import { describe, it, expect } from "bun:test"
import { Npm } from "../npm"
import * as LSPServer from "./server"
import path from "path"

describe(".sh file write hang fix", () => {
  it("Npm.which should not hang when install=false", async () => {
    const start = Date.now()
    const TIMEOUT = 2000

    const result = await Promise.race([
      Npm.which("bash-language-server", false),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Npm.which timed out - hang detected!")), TIMEOUT),
      ),
    ])

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT)
    // Result is either undefined (not cached) or a string path (cached)
    expect(result === undefined || typeof result === "string").toBe(true)
  })

  it("BashLS.spawn should return undefined on Windows", async () => {
    if (process.platform !== "win32") {
      console.log("Skipping Windows-specific test on non-Windows platform")
      return
    }

    const start = Date.now()
    const TIMEOUT = 1000

    // Call BashLS.spawn directly
    const result = await Promise.race([
      LSPServer.LSPServer.BashLS.spawn(process.cwd()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("BashLS.spawn timed out - hang detected!")), TIMEOUT),
      ),
    ])

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(TIMEOUT)
    expect(result).toBeUndefined()
  })

  it("should complete quickly when resolving non-existent package without install", async () => {
    const start = Date.now()
    const result = await Npm.which("definitely-not-a-real-package-xyz", false)
    const elapsed = Date.now() - start

    // Should complete in less than 500ms (no network/installation)
    expect(elapsed).toBeLessThan(500)
    expect(result).toBeUndefined()
  })
})
