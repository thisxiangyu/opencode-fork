import { afterEach, describe, expect, it, vi } from "vitest"
import { existsSync, rmSync } from "fs"
import { mkdir, mkdtemp, readFile, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { main } from "../规划图驱动的PEE"
import { LoopConfig } from "../../../common/loopConfig"
import type { IRole } from "../../../common/role"
import type { ISession } from "../../../common/session"
import type { SessionMessage } from "../../../common/types"

class SetupOnlySession implements ISession {
  id: string
  role: IRole
  directory: string

  constructor(role: IRole, directory: string) {
    this.id = `${role.name}-setup-only`
    this.role = role
    this.directory = directory
  }

  onInterruption(): void {}
  onMessage(): void {}
  setCurrentContext(): void {}
  getReceiveState() { return "EXPECTING_NEXT_MESSAGE" as any }
  async disposeAsync(): Promise<void> {}
  clearInterruption(): void {}
  async waitForInterruption(): Promise<string> { return "" }
  async getMessages(): Promise<SessionMessage[]> { return [] }
  getTokenUsage() { return undefined }
  async waitForUserMessage(): Promise<string> { return "" }
  async sendMsg(): Promise<string> { throw new Error("setup test should stop before sending messages") }
}

const tempDirs: string[] = []

async function makeProjectDir() {
  const dir = await mkdtemp(join(tmpdir(), "pee-setup-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
})

describe("PEE 环境初始化", () => {
  it("已有数据库与 REPO_WIKI 时不覆盖，并按用户选择沿用说明书和 better-sqlite3", async () => {
    const projectDir = await makeProjectDir()
    const projectName = projectDir.split("/").pop() || "project"
    const repoWikiPath = join(projectDir, "REPO_WIKI.ts")
    const readmePath = join(projectDir, "规划图CLI使用说明书.md")
    const staticCheckPath = join(projectDir, "静态检查脚本.js")
    const dbPath = join(projectDir, "data", `.scheduleMap.${projectName}`, `${projectName}ScheduleMap.db`)
    const markerPath = join(projectDir, "node_modules", "better-sqlite3", "marker.txt")

    await mkdir(join(projectDir, "data", `.scheduleMap.${projectName}`), { recursive: true })
    await mkdir(join(projectDir, "node_modules", "better-sqlite3"), { recursive: true })
    await writeFile(repoWikiPath, "old wiki", "utf-8")
    await writeFile(readmePath, "old readme", "utf-8")
    await writeFile(staticCheckPath, "if (process.argv.includes('__STATIC_CHECK_HEALTHCHECK__')) process.exit(0)\n// old static check", "utf-8")
    await writeFile(dbPath, "old db", "utf-8")
    await writeFile(markerPath, "old better sqlite", "utf-8")

    await main({
      linkBackend: vi.fn().mockReturnValue("mock"),
      selectOrCreateSession: vi.fn(async (role: IRole) => new SetupOnlySession(role, projectDir)),
      createSession: vi.fn(async (role: IRole) => new SetupOnlySession(role, projectDir)),
      relocateRole: vi.fn(async (roles: IRole[]) => roles[0]),
      loopConfig: new LoopConfig({ maxCycles: 0, startPrompt: "new wiki" }),
      askUser: vi.fn(async () => "n"),
    })

    await expect(readFile(repoWikiPath, "utf-8")).resolves.toBe("old wiki")
    await expect(readFile(readmePath, "utf-8")).resolves.toBe("old readme")
    await expect(readFile(staticCheckPath, "utf-8")).resolves.toContain("old static check")
    await expect(readFile(dbPath, "utf-8")).resolves.toBe("old db")
    await expect(readFile(markerPath, "utf-8")).resolves.toBe("old better sqlite")
  })

  it("缺少 REPO_WIKI 和数据库时创建，并自动部署 better-sqlite3 运行时依赖", async () => {
    const projectDir = await makeProjectDir()

    await main({
      linkBackend: vi.fn().mockReturnValue("mock"),
      selectOrCreateSession: vi.fn(async (role: IRole) => new SetupOnlySession(role, projectDir)),
      createSession: vi.fn(async (role: IRole) => new SetupOnlySession(role, projectDir)),
      relocateRole: vi.fn(async (roles: IRole[]) => roles[0]),
      loopConfig: new LoopConfig({ maxCycles: 0, startPrompt: "fresh wiki" }),
      askUser: vi.fn(async () => "n"),
    })

    const projectName = projectDir.split("/").pop() || "project"
    expect(existsSync(join(projectDir, "REPO_WIKI.ts"))).toBe(true)
    await expect(readFile(join(projectDir, "静态检查脚本.js"), "utf-8")).resolves.toContain("const { spawn } = require(\"node:child_process\")")
    expect(existsSync(join(projectDir, "data", `.scheduleMap.${projectName}`, `${projectName}ScheduleMap.db`))).toBe(true)
    expect(existsSync(join(projectDir, "node_modules", "better-sqlite3", "package.json"))).toBe(true)
    expect(existsSync(join(projectDir, "node_modules", "bindings", "package.json"))).toBe(true)
    expect(existsSync(join(projectDir, "node_modules", "file-uri-to-path", "package.json"))).toBe(true)
  })

  it("已有静态检查脚本但健康检查异常时中止初始化", async () => {
    const projectDir = await makeProjectDir()
    await writeFile(join(projectDir, "静态检查脚本.js"), "process.stderr.write('broken static check')\nprocess.exit(1)\n", "utf-8")

    await expect(main({
      linkBackend: vi.fn().mockReturnValue("mock"),
      selectOrCreateSession: vi.fn(async (role: IRole) => new SetupOnlySession(role, projectDir)),
      createSession: vi.fn(async (role: IRole) => new SetupOnlySession(role, projectDir)),
      relocateRole: vi.fn(async (roles: IRole[]) => roles[0]),
      loopConfig: new LoopConfig({ maxCycles: 0, startPrompt: "fresh wiki" }),
      askUser: vi.fn(async () => "n"),
    })).rejects.toThrow("静态检查脚本已存在但运行不在预期")
  })
})
