const { spawn } = require("node:child_process")
const { existsSync } = require("node:fs")
const { join } = require("node:path")

// 初始化时用于确认已有脚本仍是PEE可识别的静态检查脚本，不执行真实检查。
if (process.argv.includes("__PEE_STATIC_CHECK_HEALTHCHECK__")) {
  process.exit(0)
}

// 把要检查的路径注册到这里,
// 注册相对路径，比如
// web和mobile两个文件夹下有tsconfig，就注册为：
// [
//  "./app/web", 
//  "./app/mobile"
// ]
const dirs = [
  ".",
]

const checkableDirs = dirs.filter(dir => {
  if (!existsSync(dir)) {
    console.log(`- ${dir} 跳过：路径不存在`)
    return false
  }
  if (!existsSync(join(dir, "tsconfig.json"))) {
    console.log(`- ${dir} 跳过：未找到 tsconfig.json`)
    return false
  }
  return true
})

Promise.all(checkableDirs.map(dir => new Promise((resolve) => {
  const proc = spawn("npx", ["tsc", "--noEmit", "-p", dir])
  let err = ""
  proc.stderr.on("data", d => err += d)
  proc.on("close", code => {
    console.log(code === 0 ? `✓ ${dir}` : `✗ ${dir}\n${err}`)
    resolve(code)
  })
}))).then(codes => {
  const fail = codes.some(c => c !== 0)
  process.exit(fail ? 1 : 0)
})
