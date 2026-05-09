import { afterEach, describe, expect, test } from "vitest"
import { existsSync, rmSync } from "fs"
import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import {
  deployTaskTableRuntimeDependencies,
  isMissingBetterSqlite3Error,
  verifyTaskTableRuntimeDependencies,
} from "../任务表Runtime依赖"

const tempDirs: string[] = []

async function makeProjectDir() {
  const dir = await mkdtemp(join(tmpdir(), "task-table-runtime-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
})

describe("任务表Runtime依赖", () => {
  test("首次部署会从 StrategyLoops node_modules 离线拷贝 better-sqlite3 及运行时依赖", async () => {
    const projectDir = await makeProjectDir()

    await deployTaskTableRuntimeDependencies(projectDir)

    expect(existsSync(join(projectDir, "node_modules", "better-sqlite3", "package.json"))).toBe(true)
    expect(existsSync(join(projectDir, "node_modules", "bindings", "package.json"))).toBe(true)
    expect(existsSync(join(projectDir, "node_modules", "file-uri-to-path", "package.json"))).toBe(true)
    await expect(verifyTaskTableRuntimeDependencies(projectDir)).resolves.toBeUndefined()
  })

  test("目标 better-sqlite3 已存在且选择 n 时沿用旧目录", async () => {
    const projectDir = await makeProjectDir()
    const markerPath = join(projectDir, "node_modules", "better-sqlite3", "marker.txt")
    await mkdir(join(projectDir, "node_modules", "better-sqlite3"), { recursive: true })
    await writeFile(markerPath, "keep", "utf-8")

    const decision = await deployTaskTableRuntimeDependencies(projectDir, { askUser: async () => "n" })

    expect(decision).toBe("keep")
    await expect(readFile(markerPath, "utf-8")).resolves.toBe("keep")
  })

  test("目标 better-sqlite3 已存在且选择 y 时覆盖为 StrategyLoops 版本", async () => {
    const projectDir = await makeProjectDir()
    const markerPath = join(projectDir, "node_modules", "better-sqlite3", "marker.txt")
    await mkdir(join(projectDir, "node_modules", "better-sqlite3"), { recursive: true })
    await writeFile(markerPath, "old", "utf-8")

    const decision = await deployTaskTableRuntimeDependencies(projectDir, { askUser: async () => "y" })

    expect(decision).toBe("overwrite")
    expect(existsSync(markerPath)).toBe(false)
    await expect(verifyTaskTableRuntimeDependencies(projectDir)).resolves.toBeUndefined()
  })

  test("识别系统级 better-sqlite3 缺失错误", () => {
    expect(isMissingBetterSqlite3Error("Error: Cannot find module 'better-sqlite3'")).toBe(true)
    expect(isMissingBetterSqlite3Error("forced activity failure")).toBe(false)
  })
})
