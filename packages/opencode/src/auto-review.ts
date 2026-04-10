import { z } from "zod"
import { BusEvent } from "@/bus/bus-event"

export namespace AutoReview {
  // 内存中存储需要AutoReview的消息
  const pendingMessages = new Map<string, { question: string; processed: boolean }>()

  export function setPending(messageID: string, question: string) {
    pendingMessages.set(messageID, { question, processed: false })
  }

  export function getPending(messageID: string): { question: string; processed: boolean } | undefined {
    return pendingMessages.get(messageID)
  }

  export function markProcessed(messageID: string) {
    const pending = pendingMessages.get(messageID)
    if (pending) {
      pending.processed = true
      pendingMessages.set(messageID, pending)
    }
  }

  export function clearPending(messageID: string) {
    pendingMessages.delete(messageID)
  }

  export function findUnprocessed(
    sessionMsgs: Array<{ info: { id: string; role: string } }>,
  ): { messageID: string; question: string } | undefined {
    for (const msg of sessionMsgs) {
      if (msg.info.role !== "assistant") continue
      const pending = pendingMessages.get(msg.info.id)
      if (pending && !pending.processed) {
        return { messageID: msg.info.id, question: pending.question }
      }
    }
    return undefined
  }
  // 强制回顾检测事件 - 检测到疑问句结尾
  export const Detected = BusEvent.define(
    "autoReview.detected",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      partID: z.string(),
      preview: z.string(),
    }),
  )

  // 强制回顾完成事件
  export const Completed = BusEvent.define(
    "autoReview.completed",
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
      result: z.enum(["question_tool", "bubi", "unexpected"]),
    }),
  )

  // 默认检测模式：以?或?结尾
  export function matchQuestionPattern(text: string): boolean {
    try {
      return /[?？]\s*$/.test(text.trim())
    } catch {
      return false
    }
  }

  // 构建强制回顾提示词
  export function buildPrompt(detectedQuestion: string): string {
    return `<强制回顾提示词>
你刚才的回复以疑问句结尾："${detectedQuestion}"
根据语境思考是否要将这个疑问句转为一次question工具调用以优化用户的交互体验。
如果决定要调用，请直接用你最后的疑问句发起一次question工具调用。
如果认为不合适，请只回复"不必"。
</强制回顾提示词>`
  }

  // 检查是否是有效的强制回顾响应
  export function checkResponse(parts: Array<{ type: string; text?: string; tool?: string }>): {
    valid: boolean
    type: "bubi" | "question_tool" | "unexpected"
  } {
    const textParts = parts.filter((p) => p.type === "text")
    const toolParts = parts.filter((p) => p.type === "tool")
    const hasQuestionTool = toolParts.some((p) => p.tool === "question")

    if (hasQuestionTool) {
      return { valid: true, type: "question_tool" }
    }

    // 检查文本回复是否是"不必"
    const fullText = textParts
      .map((p) => p.text)
      .join("")
      .trim()
    if (fullText === "不必") {
      return { valid: true, type: "bubi" }
    }

    return { valid: false, type: "unexpected" }
  }
}
