/**
 * MPEE是带决策节点的PEE，其中决策节点（manager角色）专门承担开放式决策职责，使规划者（planner角色）能专注于封闭式决策和任务规划。
 * 适合需要开放式决策的较大型项目。
 */
import { type IRole } from "../../common/role"
import { 执行者 } from "./规划图驱动的PEE";


const 执行者调度器: {
  可调度的执行者: 执行者[];

} = {
  可调度的执行者: [],
};

export class 管理者 implements IRole {
  memory?: string | undefined
  name = "manager"
  介入间隔 = 0
  介入偏移 = 0
  disabledTools = ["question", "github_*"]
  knowledgeDomainPrompt() { return `你是一个项目管理者，负责分析当前项目局面, 根据不同局面，调用不同工具。你只允许回复我三句话.` }
  systemPrompt(upstreamMsg: string) { return `下面是上一环节的输出：
---
${upstreamMsg}
---

把任务交给合适的人、新的任务交给新的人、重大重构交给新的人` }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }

  outputSchema = { type: "text" }
  validateOutput(raw: string): { valid: boolean; error?: string } {
    if (!raw.trim()) return { valid: false, error: "输出为空" }
    return { valid: true }
  }
}
