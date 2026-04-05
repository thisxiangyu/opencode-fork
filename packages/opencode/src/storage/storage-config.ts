import path from "path"
import { Global } from "../global"
import { existsSync, readFileSync } from "fs"

export namespace StorageConfig {
  export type Type = "database" | "log"

  export interface Options {
    type: Type
    flag?: string
    defaultPath: string
    allowRelative?: boolean
  }

  const CONFIG_FILES = ["opencode.jsonc", "opencode.json", "config.json"]

  function parseConfigFile(file: string): Record<string, unknown> | undefined {
    if (!existsSync(file)) return undefined

    try {
      const raw = readFileSync(file, "utf8")
      if (file.endsWith(".jsonc")) {
        const { parse: parseJsonc } = require("jsonc-parser")
        return parseJsonc(raw) as Record<string, unknown>
      }
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return undefined
    }
  }

  function findConfigValue(key: Type): string | undefined {
    for (const file of CONFIG_FILES) {
      const fullPath = path.join(Global.Path.config, file)
      const parsed = parseConfigFile(fullPath)
      if (!parsed) continue

      const storage = parsed.storage as Record<string, unknown> | undefined
      if (!storage) continue

      const value = storage[key]
      if (typeof value === "string" && value) {
        return value
      }
    }
    return undefined
  }

  export function resolvePath(opts: Options): string {
    // 1. Check environment flag
    if (opts.flag) {
      if (opts.flag === ":memory:" || path.isAbsolute(opts.flag)) {
        return opts.flag
      }
      if (opts.allowRelative) {
        return path.join(Global.Path.data, opts.flag)
      }
    }

    // 2. Check config file
    const configured = findConfigValue(opts.type)
    if (configured) {
      if (configured === ":memory:" || path.isAbsolute(configured)) {
        return configured
      }
      if (opts.allowRelative) {
        return path.join(Global.Path.data, configured)
      }
    }

    // 3. Return default
    return opts.defaultPath
  }

  export function configFiles(): string[] {
    const files: string[] = []
    for (const file of CONFIG_FILES) {
      const fullPath = path.join(Global.Path.config, file)
      if (existsSync(fullPath)) {
        files.push(fullPath)
      }
    }
    return files
  }
}
