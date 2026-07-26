import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { EventV2 } from "@opencode-ai/core/event"
import { EventManifest } from "@/event-manifest"
import { InstanceDisposed } from "@/server/event"
import "@opencode-ai/core/account"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
})

const SyncEventSchemas = EventManifest.Latest.values()
  .flatMap((definition) => {
    if (!definition.durable) return []
    return [
      Schema.Struct({
        type: Schema.Literal("sync"),
        id: EventV2.ID,
        syncEvent: Schema.Struct({
          type: Schema.Literal(EventV2.versionedType(definition.type, definition.durable.version)),
          id: EventV2.ID,
          seq: Schema.Finite,
          aggregateID: Schema.String,
          data: definition.data,
        }),
      }).annotate({ identifier: `SyncEvent.${definition.type}` }),
    ]
  })
  .toArray()

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([
    ...EventManifest.Latest.values()
      .map((definition) =>
        Schema.Struct({ id: EventV2.ID, type: Schema.Literal(definition.type), properties: definition.data }),
      )
      .toArray(),
    InstanceDisposed,
    ...SyncEventSchemas,
  ]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.optional(Schema.String),
})

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  config: "/global/config",
  configInit: "/global/config/init",
  configPath: "/global/config/path",
  storageDatabase: "/global/storage/database",
  storageLog: "/global/storage/log",
  storageWorktree: "/global/storage/worktree",
  storageSnapshot: "/global/storage/snapshot",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
} as const

// 定制：可配置存储路径查询端点的响应结构（数据库/日志/worktree/snapshot）
const GlobalStorageInfo = Schema.Struct({
  path: Schema.String,
  channel: Schema.optional(Schema.String),
  configFiles: Schema.optional(Schema.Array(Schema.String)),
})

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the OpenCode server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the OpenCode system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(ConfigV1.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: ConfigV1.Info,
        success: described(ConfigV1.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.post("configInit", GlobalPaths.configInit, {
        success: described(Schema.Struct({ path: Schema.String }), "Global config initialized"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.init",
          summary: "Initialize global config",
          description: "Creates a default global config file if none exists.",
        }),
      ),
      HttpApiEndpoint.get("configPath", GlobalPaths.configPath, {
        success: described(Schema.Struct({ path: Schema.String }), "Global config path information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.path",
          summary: "Get global config path",
          description: "Returns the resolved global config file path.",
        }),
      ),
      HttpApiEndpoint.get("storageDatabase", GlobalPaths.storageDatabase, {
        success: described(GlobalStorageInfo, "Database path information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.storage.database",
          summary: "Get current database path",
          description: "Returns the resolved database file path currently in use by OpenCode.",
        }),
      ),
      HttpApiEndpoint.get("storageLog", GlobalPaths.storageLog, {
        success: described(GlobalStorageInfo, "Log directory path information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.storage.log",
          summary: "Get current log directory path",
          description: "Returns the resolved log directory path currently in use by OpenCode.",
        }),
      ),
      HttpApiEndpoint.get("storageWorktree", GlobalPaths.storageWorktree, {
        success: described(GlobalStorageInfo, "Worktree directory path information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.storage.worktree",
          summary: "Get current worktree directory path",
          description: "Returns the resolved worktree directory path currently in use by OpenCode.",
        }),
      ),
      HttpApiEndpoint.get("storageSnapshot", GlobalPaths.storageSnapshot, {
        success: described(GlobalStorageInfo, "Snapshot directory path information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.storage.snapshot",
          summary: "Get current snapshot directory path",
          description: "Returns the resolved snapshot directory path currently in use by OpenCode.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: [HttpApiSchema.NoContent, GlobalUpgradeInput],
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade opencode",
          description: "Upgrade opencode to the specified version or latest if not specified.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
