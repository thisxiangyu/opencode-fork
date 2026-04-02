# OpenCode 代码风格指南

- 重新生成 JavaScript SDK，运行 `./packages/sdk/js/script/build.ts`
- 尽可能使用并行工具
- 本仓库默认分支为 `dev`
- 本地 `main` 引用可能不存在；diff 时使用 `dev` 或 `origin/dev`
- 优先自动化：执行请求的操作时无需确认，除非缺少信息或涉及安全/不可逆操作

## 代码风格

### 基本原则

- 尽量将逻辑放在单个函数中，除非可组合或可复用
- 尽可能避免 `try`/`catch`
- 避免使用 `any` 类型
- 变量名尽量用单词
- 尽可能使用 Bun API，如 `Bun.file()`
- 依赖类型推断；除非导出或明确需要，否则避免显式类型注解或接口
- 优先使用函数式数组方法（flatMap、filter、map）而非 for 循环；在 filter 上使用类型守卫以保持下游类型推断

### 命名

变量和函数名优先使用单词。仅在必要时使用多词。

### 命名强制要求（必读）

此规则对 AI 编写的代码是强制性的。

- 新的局部变量、参数和辅助函数默认使用单词命名
- 仅当单词会导致不清楚或歧义时才允许多词命名
- 当有更短的单词可用时，不要引入新的驼峰式组合
- 完成编辑前，检查修改行并缩短新引入的标识符
- 推荐使用的短名：`pid`、`cfg`、`err`、`opts`、`dir`、`root`、`child`、`state`、`timeout`
- 除非真正需要，否则应避免的示例：`inputPID`、`existingClient`、`connectTimeout`、`workerPath`

```ts
// 好
const foo = 1
function journal(dir: string) {}

// 差
const fooBar = 1
function prepareJournal(dir: string) {}
```

当值只使用一次时，通过内联减少变量总数。

```ts
// 好
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// 差
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### 解构

避免不必要的解构。使用点访问符以保持上下文。

```ts
// 好
obj.a
obj.b

// 差
const { a, b } = obj
```

### 变量

优先使用 `const` 而非 `let`。使用三元运算符或提前返回而非重新赋值。

```ts
// 好
const foo = condition ? 1 : 2

// 差
let foo
if (condition) foo = 1
else foo = 2
```

### 控制流

避免 `else` 语句。优先提前返回。

```ts
// 好
function foo() {
  if (condition) return 1
  return 2
}

// 差
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema 定义 (Drizzle)

字段名使用 snake_case，这样列名就不需要重新定义为字符串。

```ts
// 好
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// 差
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## 测试

- 尽可能避免使用 mock
- 测试实际实现，不要在测试中复制逻辑
- 测试不能从仓库根目录运行（守卫：`do-not-run-tests-from-root`）；从包目录运行，如 `packages/opencode`

## 类型检查

- 始终从包目录（如 `packages/opencode`）运行 `bun typecheck`，永远不要直接运行 `tsc`
