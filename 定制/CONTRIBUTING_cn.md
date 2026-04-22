# OpenCode 协作开发指南

## 参与贡献

我们希望你能够轻松地参与 OpenCode 的贡献。以下是最常见的可被合并的更改类型：

- Bug 修复
- 新增 LSP / 格式化器支持
- LLM 性能改进
- 新增 AI 提供商支持
- 环境兼容性修复
- 补充缺失的标准行为
- 文档改进

但是，任何 UI 或核心产品功能在实现前必须经过核心团队的设计审查。

如果你不确定某个 PR 是否会被接受，可以咨询维护者，或寻找带有以下标签的 issue：

- [`help wanted`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Ahelp-wanted)
- [`good first issue`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22)
- [`bug`](https://github.com/anomalyco/opencode/issues?q=is%3Aissue%20state%3Aopen%20label%3Abug)
- [`perf`](https://github.com/anomalyco/opencode/issues?q=is%3Aopen%20is%3Aissue%20label%3A%22perf%22)

> [!NOTE]
> 忽略这些规则的 PR 很可能会被关闭。

想要认领 issue？留言即可，除非是我们已在处理的任务，否则维护者会将其分配给你。

## 添加新 AI 提供商

新增提供商通常不需要太多代码更改。如果你想添加对新提供商的支持，请先向以下仓库提交 PR：
https://github.com/anomalyco/models.dev

## 开发 OpenCode

- 要求：Bun 1.3+
- 安装依赖并从仓库根目录启动开发服务器：

  ```bash
  bun install
  bun dev
  ```

### 后端2种运行方式: 
1.bun dev serve （开发模式）

2.opencode serve（win平台exe启动）
 ./opencode serve（mac平台exe启动）

如果后端开发模式要设置密码:

windows ： $env:OPENCODE_SERVER_USERNAME="myopencode";$env:OPENCODE_SERVER_PASSWORD="123"; bun dev -- serve --hostname 0.0.0.0 --port 9999

mac：OPENCODE_SERVER_USERNAME="myopencode" OPENCODE_SERVER_PASSWORD="123" bun dev serve --hostname 0.0.0.0 --port 9999


### 前端3种运行方式: 
1.bun dev web (远程WebUI) 

2.bun run --cwd packages/app dev （开发时热更新,Vite模式）

3.opencode web（win平台exe启动）
 ./opencode web（mac平台exe启动）

如果Vite模式要输入密码:

windows：
$env:VITE_OPENCODE_SERVER_PORT="9999"; $env:VITE_OPENCODE_SERVER_USERNAME="myopencode"; $env:VITE_OPENCODE_SERVER_PASSWORD="123"; bun run --cwd packages/app dev

mac：
export VITE_OPENCODE_SERVER_PORT=9999
export VITE_OPENCODE_SERVER_USERNAME=myopencode
export VITE_OPENCODE_SERVER_PASSWORD=123
bun run --cwd packages/app dev


### 指定运行目录

默认情况下，`bun dev` 在 `packages/opencode` 目录中运行 OpenCode。要指定其他目录或仓库：

```bash
bun dev <目录路径>
```

在 opencode 仓库自身根目录运行：

```bash
bun dev .
```

### 构建独立可执行文件

编译独立可执行文件：

```bash
mac ./packages/opencode/script/build.ts --single
win bun run ./packages/opencode/script/build.ts --single
```

可执行文件会创建在以下文件夹：

```
./packages/opencode/dist/opencode-<平台>/bin/
```

将 `<平台>` 替换为你的平台（如 `darwin-arm64`、`linux-x64`）。

- 核心模块：
  - `packages/opencode`：OpenCode 核心业务逻辑和服务器
  - `packages/opencode/src/cli/cmd/tui/`：TUI 代码，使用 SolidJS + [opentui](https://github.com/sst/opentui) 编写
  - `packages/app`：共享 Web UI 组件，使用 SolidJS 编写
  - `packages/desktop`：原生桌面应用，使用 Tauri 构建（封装 `packages/app`）
  - `packages/plugin`：`@opencode-ai/plugin` 源码

### bun dev 与 opencode 的关系

开发期间，`bun dev` 等同于构建后的 `opencode` 命令。两者运行相同的 CLI 接口：

```bash
# 开发模式（项目根目录）
bun dev --help           # 显示所有可用命令
bun dev serve            # 启动无界面 API 服务器
bun dev web              # 启动服务器 + 打开 Web 界面 (这条命令的后端是本地后端, 但前端是基于Opencode远程站点的, 所以不会显示本地WebUI更新)
bun dev <目录>           # 在指定目录启动 TUI

# 生产模式
opencode --help          # 显示所有可用命令
opencode serve           # 启动无界面 API 服务器
opencode web             # 启动服务器 + 打开 Web 界面
opencode <目录>          # 在指定目录启动 TUI
```

### 启动 API 服务器

启动 OpenCode 无头 API 服务器：

```bash
bun dev serve
```

默认在端口 4096 启动。可指定其他端口：

```bash
bun dev serve --port 8080
```

### 运行 Web 应用

开发期间测试 UI 更改：

1. **先启动 OpenCode 服务器**（见上方 [启动 API 服务器](#启动-api-服务器) 部分）
2. **然后运行 Web 应用：**

```bash
bun run --cwd packages/app dev
```

这会在 http://localhost:5173（或类似端口）启动本地开发服务器。大多数 UI 更改可在此测试，但完整功能需服务器运行。

### 运行桌面应用

桌面应用是基于 Tauri 的原生应用，封装了 Web UI。

启动原生桌面应用：

```bash
bun run --cwd packages/desktop tauri dev
```

这会在 http://localhost:1420 启动 Web 开发服务器并打开原生窗口。

如果只需要 Web 开发服务器（无原生外壳）：

```bash
bun run --cwd packages/desktop dev
```

创建生产版本 `dist/` 并构建原生安装包：

```bash
bun run --cwd packages/desktop tauri build
```

这会自动通过 Tauri 的 `beforeBuildCommand` 运行 `bun run --cwd packages/desktop build`。

> [!NOTE]
> 运行桌面应用需要额外的 Tauri 依赖（Rust 工具链、平台特定库）。参见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/) 进行设置。

> [!NOTE]
> 如果更改了 API 或 SDK（如 `packages/opencode/src/server/server.ts`），请运行 `./script/generate.ts` 重新生成 SDK 及相关文件。

请尽量遵循 [代码风格指南](./AGENTS.md)

### 设置调试器

Bun 的调试体验目前还有些粗糙。希望本指南能帮你顺利设置。

最可靠的调试方式是在终端中手动运行 `bun run --inspect=<url> dev ...` 并通过该 URL 附加调试器。其他方法可能导致断点映射错误（至少在 VSCode 中如此）。

注意事项：

- 如果想运行 OpenCode TUI 并在服务器代码中触发断点，可能需要运行 `bun dev spawn` 而非 `bun dev`。因为 `bun dev` 在工作线程中运行服务器，断点可能无法生效。
- 如果 `spawn` 不工作，可以分别调试服务器和 TUI：
  - 调试服务器：`bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096`，然后用 `opencode attach http://localhost:4096` 附加 TUI
  - 调试 TUI：`bun run --inspect=ws://localhost:6499/ --cwd packages/opencode --conditions=browser ./src/index.ts`

其他技巧：

- 可根据工作流使用 `--inspect-wait` 或 `--inspect-brk` 替代 `--inspect`
- 每次输入 `--inspect=ws://localhost:6499/` 很繁琐，可以设置 `export BUN_OPTIONS=--inspect=ws://localhost:6499/`

#### VSCode 设置

如果使用 VSCode，可参考示例配置 [.vscode/settings.example.json](.vscode/settings.example.json) 和 [.vscode/launch.example.json](.vscode/launch.example.json)。

部分调试方式可能存在问题：

- 使用 `"request": "launch"` 的调试配置可能导致断点映射错误而无法使用
- 在 VSCode `JavaScript Debug Terminal` 中运行 OpenCode 也会出现同样问题

尽管如此，你可以尝试这些方法，它们对你可能有效。

## Pull Request 规范

### Issue 优先原则

**所有 PR 必须引用已存在的 issue。** 在提交 PR 前，先开一个 issue 描述 bug 或功能。这有助于维护者分类任务并避免重复工作。没有关联 issue 的 PR 可能会被直接关闭。

- 在 PR 描述中使用 `Fixes #123` 或 `Closes #123` 关联 issue
- 对于小修复，简短的 issue 即可——只需提供足够上下文让维护者理解问题

### 基本要求

- 保持 PR 小而聚焦
- 解释问题以及你的更改如何修复它
- 在添加新功能前，确保代码库中不存在类似功能

### UI 更改

如果 PR 包含 UI 更改，请附上前后对比的截图或视频。这能帮助维护者更快审查并给你更及时的反馈。

### 逻辑更改

对于非 UI 更改（bug 修复、新功能、重构），请解释**你如何验证其有效性**：

- 你测试了什么？
- 审查者如何复现/确认修复？

### 拒绝 AI 生成的长篇大论

冗长的、AI 生成的 PR 描述和 issue 是不可接受的，可能会被忽略。请尊重维护者的时间：

- 写简短、聚焦的描述
- 用自己的话解释改了什么以及为什么
- 如果你无法简短解释，说明你的 PR 可能太大了

### PR 标题

PR 标题应遵循 conventional commit 规范：

- `feat:` 新功能
- `fix:` bug 修复
- `docs:` 文档或 README 更改
- `chore:` 维护任务、依赖更新等
- `refactor:` 代码重构，不改变行为
- `test:` 添加或更新测试

可选添加作用域以表明影响的包：

- `feat(app):` app 包的功能
- `fix(desktop):` desktop 包的 bug 修复
- `chore(opencode):` opencode 包的维护

示例：

- `docs: update contributing guidelines`
- `fix: resolve crash on startup`
- `feat: add dark mode support`
- `feat(app): add dark mode support`
- `fix(desktop): resolve crash on startup`
- `chore: bump dependency versions`

### 代码风格偏好

这些不是强制要求，只是一般性指南：

- **函数：** 尽量将逻辑放在单个函数中，除非拆分能带来明显的复用或组合优势
- **解构：** 不要做不必要的变量解构
- **控制流：** 避免使用 `else` 语句
- **错误处理：** 尽量使用 `.catch(...)` 而非 `try`/`catch`
- **类型：** 使用精确类型，避免 `any`
- **变量：** 坚持不可变模式，避免 `let`
- **命名：** 选择简洁的单词标识符
- **运行时 API：** 使用 Bun 辅助函数如 `Bun.file()`

## 功能请求

对于全新功能，先从设计讨论开始。开一个 issue 描述问题、你的方案（可选），以及为什么它应该属于 OpenCode。核心团队会帮助决定是否应该继续；请等待确认后再提交功能 PR。

## 信任与担保系统

本项目使用 [vouch](https://github.com/mitchellh/vouch) 来管理贡献者信任。担保列表维护在 [`.github/VOUCHED.td`](.github/VOUCHED.td)。

### 工作原理

- **已担保用户** 是明确受信任的贡献者
- **被举报用户** 会被明确屏蔽。被举报用户的 issue 和 PR 会被自动关闭。如果你被举报，可以通过 [Discord](https://opencode.ai/discord) 联系维护者请求解除
- **其他所有人** 可以正常参与——你不需要被担保即可开 issue 或 PR

### 维护者

拥有写权限的协作者可以通过在任意 issue 下评论来管理担保列表：

- `vouch` — 为 issue 作者担保
- `vouch @用户名` — 为特定用户担保
- `denounce` — 举报 issue 作者
- `denounce @用户名` — 举报特定用户
- `denounce @用户名 <原因>` — 带原因的举报
- `unvouch` / `unvouch @用户名` — 从列表中移除

更改会自动提交到 `.github/VOUCHED.td`。

### 举报政策

举报仅用于反复提交低质量 AI 生成贡献、垃圾邮件或其他恶意行为的用户。不用于意见分歧或无心之失。

## Issue 要求

所有 issue **必须** 使用我们的 issue 模板之一：

- **Bug 报告** — 用于报告 bug（需要描述）
- **功能请求** — 用于建议增强（需要验证复选框和描述）
- **问题** — 用于提问（需要具体问题）

不允许空白 issue。开新 issue 时，自动化检查会验证是否遵循模板并符合贡献指南。如果 issue 不符合要求，你会收到一条评论说明需要修改什么，并有 **2 小时** 时间编辑。之后 issue 会被自动关闭。

Issue 可能因以下原因被标记：

- 未使用模板
- 必填字段留空或填写占位文本
- AI 生成的长篇大论
- 缺少有意义的内容

如果你认为 issue 被错误标记，请联系维护者。
