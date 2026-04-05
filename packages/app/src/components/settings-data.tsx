import { Component, createEffect, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { SettingsList } from "./settings-list"
import { Icon } from "@opencode-ai/ui/icon"

export const SettingsData: Component = () => {
  const language = useLanguage()
  const server = useServer()

  const [dbPath, setDbPath] = createSignal("")
  const [channel, setChannel] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  const [configFiles, setConfigFiles] = createSignal<string[]>([])

  const loadDatabaseInfo = async () => {
    try {
      const conn = server.current
      if (!conn) return
      const url = conn.http.url
      if (!url) return
      const headers: Record<string, string> = {}
      if (conn.http.username && conn.http.password) {
        headers["Authorization"] = `Basic ${btoa(`${conn.http.username}:${conn.http.password}`)}`
      }
      const res = await fetch(`${url}/global/storage/database`, { headers })
      if (res.ok) {
        const data = await res.json()
        setDbPath(data.path ?? "")
        setChannel(data.channel ?? "")
        setConfigFiles(data.configFiles ?? [])
      }
    } catch {
      setDbPath("")
      setChannel("")
      setConfigFiles([])
    }
  }

  createEffect(() => {
    if (server.current?.http.url) {
      void loadDatabaseInfo()
    }
  })

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.data")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.data.section.database")}</h3>

          <SettingsList>
            <div class="flex flex-col gap-3 py-3">
              <div class="flex flex-col gap-0.5">
                <span class="text-14-medium text-text-strong">{language.t("settings.data.row.database.path")}</span>
              </div>

              <div class="flex items-center gap-2">
                <code class="text-12-regular text-text-weak bg-surface-weak px-2 py-1 rounded flex-1 truncate block">
                  {dbPath() || "--"}
                </code>
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
                <Show when={channel()}>
                  <span class="text-11-medium text-info bg-info/10 px-2 py-0.5 rounded flex-shrink-0">{channel()}</span>
                </Show>
              </div>
            </div>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}
