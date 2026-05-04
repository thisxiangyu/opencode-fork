export function 开发环境与工具链搭建(): string {
  return ""
}

export function 集思广益(): string {
  return "针对当前任务建言献策（针对具体文件/代码段/变量的建议应具体）、经验分享（踩坑记录、认知对齐）"
}

export function 代码骨架与基础框架(): string {
  return ""
}

export function 改动前先了解全貌_改之后纪律性检查(语言: string = "ts"): string {
  const 检查命令: Record<string, string> = {
    ts: "tsc --noEmit",
    tsx: "tsc --noEmit",
    js: "tsc --noEmit",
    py: "ruff check . && mypy .",
    python: "ruff check . && mypy .",
    rs: "cargo check",
    rust: "cargo check",
    go: "go build ./...",
    java: "javac *.java",
    cpp: "g++ -fsyntax-only *.cpp",
    c: "gcc -fsyntax-only *.c",
    cs: "dotnet build",
    csharp: "dotnet build",
  }
  const 检查 = 检查命令[语言.toLowerCase()] ?? `语言「${语言}」的类型检查命令未配置，请自行判断应使用什么命令`
  return `改之前了解一下项目文件结构和依赖再动手，改之后要确保代码无报错、找到所有相关的测试代码确保能跑通。注意各种边界情况。建议运行：${检查}`
}

export function 功能模块开发(): string {
  return ""
}

export function 资产生产与导入(): string {
  return ""
}

export function 接口联调与数据对接(): string {
  return ""
}

export function 每日构建与持续集成(): string {
  return ""
}

export function 代码审查与风格校验(): string {
  return ""
}

export function 开发文档同步撰写(): string {
  return ""
}

export function 技术难点攻关与早期性能优化(): string {
  return ""
}

export function 开发阶段内部演示(): string {
  return ""
}