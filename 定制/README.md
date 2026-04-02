# 定制

本目录包含所有针对 OpenCode 的定制化内容，与上游代码分离，便于同步更新。

## 目录结构

```
定制/
├── README.md           # 本文件
├── plugins/            # 自定义插件
├── themes/             # 自定义主题
├── agents/             # 自定义 Agent 配置
├── commands/           # 自定义命令
├── tools/              # 自定义工具
└── assets/             # 自定义资源(图标、样式等)
```

## 使用方式

将 `.opencode/` 中的配置指向本目录:

```jsonc
// .opencode/opencode.jsonc
{
  "tools": {
    "my-tool": "./定制/tools/my-tool.ts",
  },
}
```

```json
// .opencode/tui.json
{
  "plugin": ["../定制/plugins/my-plugin.tsx"]
}
```

## 同步上游

```bash
# 拉取上游更新
git fetch upstream
git rebase upstream/dev

# 如果有冲突，优先保留上游代码，手动合并定制内容
```

## 规则

- 所有定制代码必须放在此目录下
- 不修改 `packages/` 下的源码，除非必要
- 每个功能一个文件，保持清晰
