/**
 * RalphLoopCore × OpenCode 集成示例 - 事件驱动版本
 *
 * 本示例展示如何将 RalphLoopCore 的节点图执行引擎与 OpenCode 会话连接
 * 支持三种用户操作检测：
 * 1. 用户按下 ESC 暂停 - RLC 节点暂停，以下一条用户消息作为接收
 * 2. 用户触发回滚 - 以回滚后新消息的返回作为 RLC 接收
 * 3. 用户直接发新消息引导 - 以新消息的返回作为接收
 *
 * 运行前提：OpenCode 服务器必须正在运行
 * 启动服务器：opencode web
 *
 * ============================================================================
 * Opencode SDK 版本坑点说明 (v1 vs v2)
 * ============================================================================
 *
 * 1. 导入差异:
 *    - v1: import { createOpencodeClient } from "@opencode-ai/sdk"
 *    - v2: import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
 *
 * 2. 事件订阅端点差异:
 *    - v1: client.event.subscribe() -> /event (按目录过滤)
 *    - v2: client.global.event() -> /global/event (全局事件流)
 *    重要: 必须使用 v2 的 global.event 才能接收到 session.error 等事件!
 *
 * 3. session.prompt 参数结构差异:
 *    - v1: client.session.prompt({ path: { id: sessionId }, body: { parts: [...] } })
 *    - v2: client.session.prompt({ sessionID: sessionId, parts: [...] })
 *    重要: v2 使用平铺的参数结构，不是嵌套在 path/body 中!
 *
 * 4. 事件结构差异:
 *    - v1: event.type, event.properties
 *    - v2: event.payload.type, event.payload.properties
 *    重要: v2 的事件嵌套在 payload 字段中!
 *
 * 5. directory 参数:
 *    - v2 中 directory 是 query 参数: client.session.prompt({ sessionID, directory })
 *    不是 body 参数!
 *
 * ============================================================================
 * 日志分级说明
 * ============================================================================
 * - 控制台输出: 精简的关键信息
 * - 文件输出: 详细日志，保存在 ./log 目录下，按日期命名
 *
 * ============================================================================
 */

export { main } from "./main"
export { controlledExecute } from "./engine-runner"
export { OpenCodeSessionAdapter } from "./session-adapter"
export { selectSessionInstance as selectSession, askUserWhereToGo, askUser as prompt } from "./session-manager"
export type {
  InterruptionReason,
  InterruptedMessage,
  WaitPhase,
  WaitContext,
} from "./types"
export { AbortError, MessageReceiveState } from "./types"