/**
 * 规划图CLI构建脚本
 * 将 规划图CLI.ts 编译为 规划图CLI.js
 *
 * 用法:
 *   npx tsx 规划图Build.ts                    # 输出到同目录
 *   npx tsx 规划图Build.ts ./dist/           # 输出到指定目录
 *   npx tsx 规划图Build.ts /path/to/out.js   # 输出到指定文件
 */
import { spawn } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { mkdirSync, existsSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const sourceFile = join(__dirname, "规划图CLI.ts")
const defaultOutFile = join(__dirname, "规划图CLI.js")

function getOutFile(args: string[]): string {
  if (args[0]) {
    const target = args[0]
    // 只有以 .js 结尾才当文件路径，否则当目录
    if (target.endsWith(".js")) {
      return target
    }
    // 目录：输出到该目录下的 规划图CLI.js
    return join(target, "规划图CLI.js")
  }
  return defaultOutFile
}

const outFile = getOutFile(process.argv.slice(2))
const outDir = dirname(outFile)

// 确保输出目录存在
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true })
}

console.log(`[构建] 源文件: ${sourceFile}`)
console.log(`[构建] 输出: ${outFile}`)

const child = spawn("npx", [
  "esbuild",
  sourceFile,
  `--outfile=${outFile}`,
  "--platform=node",
  "--format=cjs",
  "--target=node18",
  "--charset=utf8",
  "--banner:js=/* 基于 规划图CLI.ts 构建 */",
], {
  cwd: __dirname,
  stdio: ["ignore", "pipe", "pipe"],
})

let stderr = ""
child.stderr?.on("data", (data) => { stderr += data.toString() })

child.on("close", (code) => {
  if (code === 0) {
    console.log(`[构建] ✓ 编译成功 -> ${outFile}`)
  } else {
    console.error(`[构建] ✗ 编译失败 (exit=${code}): ${stderr.trim()}`)
    process.exit(1)
  }
})

child.on("error", (err) => {
  console.error(`[构建] ✗ 启动失败: ${err.message}`)
  process.exit(1)
})
