import { Component } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { SettingsList } from "./settings-list"

export const SettingsInteraction: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.interaction")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <SettingsList>
            <SettingsRow
              title={language.t("settings.interaction.question.title")}
              description={language.t("settings.interaction.question.description")}
            >
              <div data-action="settings-interaction-question">
                <Switch
                  checked={settings.interaction.question()}
                  onChange={(checked) => settings.interaction.setQuestion(checked)}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string
  description: string
  children: any
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
