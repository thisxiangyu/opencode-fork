import { spawn } from "child_process"
import { copyFile, mkdir, readdir, rm } from "fs/promises"
import { existsSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const strategyLoopsDir = join(__dirname, "../../..")

export const SCHEDULE_MAP_RUNTIME_DEPENDENCIES = ["better-sqlite3", "bindings", "file-uri-to-path"] as const

export type RuntimeDependencyDecision = "overwrite" | "keep"

export interface DeployScheduleMapRuntimeDependenciesOptions {
  askUser?: (prompt: string) => Promise<string>
  log?: (message: string) => void
  force?: boolean
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) {
    throw new Error(`规划图运行时依赖源不存在: ${src}。请先在 StrategyLoops 目录执行 npm install。`)
  }
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath)
      continue
    }
    await copyFile(srcPath, destPath)
  }
}

export function isMissingBetterSqlite3Error(stderr: string): boolean {
  return stderr.includes("Cannot find module 'better-sqlite3'") || stderr.includes('Cannot find module "better-sqlite3"')
}

export async function deployScheduleMapRuntimeDependencies(
  projectDir: string,
  options: DeployScheduleMapRuntimeDependenciesOptions = {},
): Promise<RuntimeDependencyDecision> {
  const nodeModulesDir = join(projectDir, "node_modules")
  const betterSqliteDest = join(nodeModulesDir, "better-sqlite3")
  const shouldCopy = options.force || !existsSync(betterSqliteDest)
    ? true
    : (await options.askUser?.("[初始环境] node_modules/better-sqlite3 已存在，是否覆盖？(y/n): "))?.toLowerCase() !== "n"

  if (!shouldCopy) {
    options.log?.("[初始环境] 跳过 node_modules/better-sqlite3")
    return "keep"
  }

  await mkdir(nodeModulesDir, { recursive: true })
  await Promise.all(SCHEDULE_MAP_RUNTIME_DEPENDENCIES.map(async (dependency) => {
    const dest = join(nodeModulesDir, dependency)
    if (existsSync(dest)) await rm(dest, { recursive: true, force: true })
    await copyDirRecursive(join(strategyLoopsDir, "node_modules", dependency), dest)
  }))
  options.log?.(`${options.force ? "[规划图]" : "[初始环境]"} better-sqlite3 + bindings + file-uri-to-path 已拷贝 -> ${nodeModulesDir}`)
  return "overwrite"
}

export async function verifyScheduleMapRuntimeDependencies(projectDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("node", ["-e", "require('better-sqlite3'); require('bindings'); require('file-uri-to-path');"], {
      cwd: projectDir,
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr?.on("data", (data) => { stderr += data.toString() })
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`[规划图] 运行时依赖验证失败 (exit=${code}): ${stderr.trim()}`))
    })
    child.on("error", (err) => reject(new Error(`[规划图] 运行时依赖验证失败: ${err.message}`)))
  })
}

export async function repairScheduleMapRuntimeDependencies(projectDir: string, log?: (message: string) => void): Promise<void> {
  log?.("[规划图] 检测到 better-sqlite3 缺失，开始自动修复运行时依赖")
  await deployScheduleMapRuntimeDependencies(projectDir, { force: true, log })
  await verifyScheduleMapRuntimeDependencies(projectDir)
  log?.("[规划图] better-sqlite3 自动修复与验证完成")
}
