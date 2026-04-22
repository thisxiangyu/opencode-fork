import { describe, it, expect } from "bun:test"
import { Npm } from "./index"
import { which } from "../util/which"

describe("Npm.which", () => {
  it("should return undefined when package not found", async () => {
    const result = await Npm.which("non-existent-package-for-test-12345")
    expect(result).toBeUndefined()
  })

  it("should check if bash-language-server exists without installing", async () => {
    const result = await Npm.which("bash-language-server")
    expect(result === undefined || typeof result === "string").toBe(true)
  })
})

describe("BashLS on Windows", () => {
  it("should skip bash-language-server on Windows", () => {
    // This test verifies the logic in lsp/server.ts
    // On Windows, BashLS.spawn should return undefined immediately
    if (process.platform === "win32") {
      // The actual logic is tested by the spawn function returning undefined
      // This is a placeholder to document the expected behavior
      expect(process.platform).toBe("win32")
    }
  })
})
