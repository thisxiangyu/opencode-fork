import { Component, createEffect, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { Icon } from "@opencode-ai/ui/icon"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

// 定制：存储路径展示页（数据库/日志），数据来自 /global/storage/* 端点（对齐旧版 settings-data.tsx）
export const SettingsDataV2: Component = () => {
  const language = useLanguage()
  const server = useServer()

  const [dbPath, setDbPath] = createSignal("")
  const [channel, setChannel] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  const [logPath, setLogPath] = createSignal("")
  const [logCopied, setLogCopied] = createSignal(false)

  const headers = () => {
    const conn = server.current
    if (!conn) return undefined
    const url = conn.http.url
    if (!url) return undefined
    const headers: Record<string, string> = {}
    if (conn.http.username && conn.http.password) {
      headers["Authorization"] = `Basic ${btoa(`${conn.http.username}:${conn.http.password}`)}`
    }
    return { url, headers }
  }

  const loadDatabaseInfo = async () => {
    try {
      const ctx = headers()
      if (!ctx) return
      const res = await fetch(`${ctx.url}/global/storage/database`, { headers: ctx.headers })
      if (res.ok) {
        const data = await res.json()
        setDbPath(data.path ?? "")
        setChannel(data.channel ?? "")
      }
    } catch {
      setDbPath("")
      setChannel("")
    }
  }

  const loadLogInfo = async () => {
    try {
      const ctx = headers()
      if (!ctx) return
      const res = await fetch(`${ctx.url}/global/storage/log`, { headers: ctx.headers })
      if (res.ok) {
        const data = await res.json()
        setLogPath(data.path ?? "")
      }
    } catch {
      setLogPath("")
    }
  }

  createEffect(() => {
    if (server.current?.http.url) {
      void loadDatabaseInfo()
      void loadLogInfo()
    }
  })

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleLogCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setLogCopied(true)
    setTimeout(() => setLogCopied(false), 1500)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.data")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.data.section.database")}</h3>

          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.data.row.database.path")}
              description={
                <code class="text-12-regular text-text-weak bg-surface-weak px-2 py-1 rounded block truncate">
                  {dbPath() || "--"}
                </code>
              }
            >
              <div class="flex items-center gap-2">
                <Show when={channel()}>
                  <span class="text-11-medium text-info bg-info/10 px-2 py-0.5 rounded flex-shrink-0">
                    {channel()}
                  </span>
                </Show>
                <Show when={dbPath()}>
                  <button
                    class="p-1 rounded hover:bg-surface-base-hover transition-colors"
                    onClick={() => handleCopy(dbPath())}
                    title={language.t("settings.data.row.database.copy")}
                  >
                    <Icon
                      name={copied() ? "check" : "copy"}
                      size="small"
                      class={copied() ? "text-icon-success-base" : "text-icon-base"}
                    />
                  </button>
                </Show>
              </div>
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("settings.data.section.log")}</h3>

          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.data.row.log.path")}
              description={
                <code class="text-12-regular text-text-weak bg-surface-weak px-2 py-1 rounded block truncate">
                  {logPath() || "--"}
                </code>
              }
            >
              <Show when={logPath()}>
                <button
                  class="p-1 rounded hover:bg-surface-base-hover transition-colors"
                  onClick={() => handleLogCopy(logPath())}
                  title={language.t("settings.data.row.log.copy")}
                >
                  <Icon
                    name={logCopied() ? "check" : "copy"}
                    size="small"
                    class={logCopied() ? "text-icon-success-base" : "text-icon-base"}
                  />
                </button>
              </Show>
            </SettingsRowV2>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
