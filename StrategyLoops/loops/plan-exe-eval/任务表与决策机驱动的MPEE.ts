/**
 * MPEE是带决策节点的PEE，其中决策节点（manager角色）专门承担开放式决策职责，使规划者（planner角色）能专注于封闭式决策和任务规划。
 * 适合需要开放式决策的较大型项目。
 */
import { type IRole } from "../../common/role"

export class 管理者 implements IRole {
  memory?: string | undefined
  name = "manager"
  knowledgeDomainPrompt() { return "你是一个项目管理者，负责分析当前项目局面, 根据不同局面，调用不同工具。你只允许回复我三句话." }
  systemPrompt() { return "。" }
  accessMode: "readonly" | "writable" = "readonly"
  model = { providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M2.7-highspeed" }
}