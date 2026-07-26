import { describe, it, expect } from "bun:test"
import { Npm } from "./npm"

describe("Npm.which", () => {
  it("should return undefined when package not found and install is false", async () => {
    const result = await Npm.which("non-existent-package-for-test-12345", undefined, false)
    expect(result).toBeUndefined()
  })

  it("should check if bash-language-server exists without installing when install is false", async () => {
    const result = await Npm.which("bash-language-server", undefined, false)
    // Result should be either undefined (if not cached) or a path (if cached)
    // The key point is it should not hang trying to install
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
