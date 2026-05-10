import { afterEach, describe, expect, it } from "vitest"
import { existsSync, rmSync } from "fs"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { spawn } from "child_process"
import {
  runNodeScript,
  verifyStaticCheckTemplate,
  runStaticCheckScript,
  verifyExistingStaticCheckScript,
} from "../规划图驱动的PEE"
import { 静态检查脚本健康检查标记 } from "../../../common/CICD/staticCheckConstants"

const templatePath = join(__dirname, "../../../common/CICD/Node静态检查模版.js")
const 静态检查脚本名 = "静态检查脚本.js"

const tempDirs: string[] = []

async function makeProjectDir() {
  const dir = await mkdtemp(join(tmpdir(), "pee-static-check-"))
  tempDirs.push(dir)
  return dir
}

function cleanupTempDirs() {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
}

afterEach(cleanupTempDirs)

async function writeTsconfig(projectDir: string, extraCompilerOptions: Record<string, unknown> = {}) {
  const config = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      ...extraCompilerOptions,
    },
    include: ["*.ts"],
  }
  await writeFile(join(projectDir, "tsconfig.json"), JSON.stringify(config, null, 2), "utf-8")
}

async function copyTemplateTo(projectDir: string, customDirs?: string[]) {
  const content = await readFile(templatePath, "utf-8")
  if (customDirs) {
    const dirsRegex = /const dirs = \[[\s\S]*?\]/
    const dirsString = `const dirs = [\n${customDirs.map((d) => `  "${d}"`).join(",\n")}\n]`
    await writeFile(join(projectDir, 静态检查脚本名), content.replace(dirsRegex, dirsString), "utf-8")
  } else {
    await writeFile(join(projectDir, 静态检查脚本名), content, "utf-8")
  }
}

describe("Node静态检查模版 - 作为独立脚本", () => {
  it("被 require 时仅导出健康检查标记，不执行检查", async () => {
    const exported = require(templatePath)
    expect(exported).toHaveProperty("静态检查脚本健康检查标记", 静态检查脚本健康检查标记)
    // 被 require 时不应产生任何输出或副作用
  })

  it("带健康检查参数时直接 exit 0", async () => {
    const result = await runNodeScript(tmpdir(), [templatePath, 静态检查脚本健康检查标记])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("")
    expect(result.stderr.trim()).toBe("")
  })

  it("在无 tsconfig.json 的目录中运行，跳过并 exit 0", async () => {
    const projectDir = await makeProjectDir()
    await copyTemplateTo(projectDir)
    const result = await runNodeScript(projectDir, [join(projectDir, 静态检查脚本名)])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("跳过：未找到 tsconfig.json")
  })

  it("在有 tsconfig.json 且代码无错误的目录中运行，通过并 exit 0", async () => {
    const projectDir = await makeProjectDir()
    await writeTsconfig(projectDir)
    await writeFile(join(projectDir, "main.ts"), "const x: number = 42\n", "utf-8")
    await copyTemplateTo(projectDir)
    const result = await runNodeScript(projectDir, [join(projectDir, 静态检查脚本名)])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("✓")
  })

  it("在有 tsconfig.json 且代码有类型错误的目录中运行，失败并 exit 1", async () => {
    const projectDir = await makeProjectDir()
    await writeTsconfig(projectDir)
    await writeFile(join(projectDir, "main.ts"), "const x: number = 'string'\n", "utf-8")
    await copyTemplateTo(projectDir)
    const result = await runNodeScript(projectDir, [join(projectDir, 静态检查脚本名)])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("✗")
    expect(result.stdout + result.stderr).toContain("error")
  })

  it("配置多个目录时，部分失败导致整体 exit 1", async () => {
    const projectDir = await makeProjectDir()
    const goodDir = join(projectDir, "good")
    const badDir = join(projectDir, "bad")
    await mkdir(goodDir, { recursive: true })
    await mkdir(badDir, { recursive: true })

    await writeTsconfig(goodDir)
    await writeFile(join(goodDir, "main.ts"), "const x: number = 42\n", "utf-8")

    await writeTsconfig(badDir)
    await writeFile(join(badDir, "main.ts"), "const y: number = 'wrong'\n", "utf-8")

    await copyTemplateTo(projectDir, ["./good", "./bad"])
    const result = await runNodeScript(projectDir, [join(projectDir, 静态检查脚本名)])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("✓")
    expect(result.stdout).toContain("✗")
  })

  it("配置的部分目录不存在时跳过该目录，其余正常检查", async () => {
    const projectDir = await makeProjectDir()
    await writeTsconfig(projectDir)
    await writeFile(join(projectDir, "main.ts"), "const x: number = 42\n", "utf-8")
    await copyTemplateTo(projectDir, ["./missing", "."])
    const result = await runNodeScript(projectDir, [join(projectDir, 静态检查脚本名)])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("跳过：路径不存在")
    expect(result.stdout).toContain("✓")
  })
})

describe("runStaticCheckScript 集成", () => {
  it("脚本不存在时返回 ok: false", async () => {
    const projectDir = await makeProjectDir()
    const result = await runStaticCheckScript(projectDir)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("脚本不存在")
  })

  it("脚本存在且静态检查通过时返回 ok: true", async () => {
    const projectDir = await makeProjectDir()
    await writeTsconfig(projectDir)
    await writeFile(join(projectDir, "main.ts"), "const x: number = 42\n", "utf-8")
    await copyTemplateTo(projectDir)
    const result = await runStaticCheckScript(projectDir)
    expect(result.ok).toBe(true)
    expect(result.output).toContain("✓")
  })

  it("脚本存在但发现类型错误时返回 ok: false", async () => {
    const projectDir = await makeProjectDir()
    await writeTsconfig(projectDir)
    await writeFile(join(projectDir, "main.ts"), "const x: number = 'wrong'\n", "utf-8")
    await copyTemplateTo(projectDir)
    const result = await runStaticCheckScript(projectDir)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("✗")
  })

  it("脚本 stdout 为空但 exitCode 非零时返回退出码信息", async () => {
    const projectDir = await makeProjectDir()
    await writeFile(join(projectDir, 静态检查脚本名), "process.exit(2)\n", "utf-8")
    const result = await runStaticCheckScript(projectDir)
    expect(result.ok).toBe(false)
    expect(result.output).toContain("退出码: 2")
  })
})

describe("verifyExistingStaticCheckScript 集成", () => {
  it("已有脚本健康检查通过时不抛异常", async () => {
    const projectDir = await makeProjectDir()
    await copyTemplateTo(projectDir)
    await expect(verifyExistingStaticCheckScript(projectDir)).resolves.toBeUndefined()
  })

  it("已有脚本健康检查异常时抛出错误", async () => {
    const projectDir = await makeProjectDir()
    await writeFile(
      join(projectDir, 静态检查脚本名),
      "process.stderr.write('broken')\nprocess.exit(1)\n",
      "utf-8",
    )
    await expect(verifyExistingStaticCheckScript(projectDir)).rejects.toThrow("静态检查脚本已存在但运行不在预期")
  })
})

describe("verifyStaticCheckTemplate 集成", () => {
  it("模版语法有效时不抛异常", async () => {
    await expect(verifyStaticCheckTemplate()).resolves.toBeUndefined()
  })
})

describe("runNodeScript 通用行为", () => {
  it("正确捕获 stdout、stderr 和 exitCode", async () => {
    const result = await runNodeScript(tmpdir(), [
      "-e",
      "console.log('hello'); console.error('world'); process.exit(42)",
    ])
    expect(result.stdout.trim()).toBe("hello")
    expect(result.stderr.trim()).toBe("world")
    expect(result.exitCode).toBe(42)
  })

  it("脚本文件不存在时返回非零 exitCode", async () => {
    const result = await runNodeScript(tmpdir(), ["/nonexistent/script.js"])
    expect(result.exitCode).not.toBe(0)
  })
})
