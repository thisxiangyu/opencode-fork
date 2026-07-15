import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Effect } from "effect"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { GlobalBus } from "@/bus/global"
import { Bus } from "@/bus"
import { AppRuntime } from "@/effect/app-runtime"
import { AsyncQueue } from "@/util/queue"
import { Installation } from "@/installation"
import { InstallationVersion, InstallationChannel } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"
import { lazy } from "../../util/lazy"
import { Config } from "@/config/config"
import { Path as DatabasePath } from "../../storage/db"
import { StorageConfig } from "../../storage/storage-config"
import { Worktree } from "../../worktree"
import { Snapshot } from "../../snapshot"
import { errors } from "../error"
import { disposeAllInstancesAndEmitGlobalDisposed } from "../global-lifecycle"

const log = Log.create({ service: "server" })

async function streamEvents(c: Context, subscribe: (q: AsyncQueue<string | null>) => () => void) {
  return streamSSE(c, async (stream) => {
    const q = new AsyncQueue<string | null>()
    let done = false

    q.push(
      JSON.stringify({
        payload: {
          id: Bus.createID(),
          type: "server.connected",
          properties: {},
        },
      }),
    )

    // Send heartbeat every 10s to prevent stalled proxy streams.
    const heartbeat = setInterval(() => {
      q.push(
        JSON.stringify({
          payload: {
            id: Bus.createID(),
            type: "server.heartbeat",
            properties: {},
          },
        }),
      )
    }, 10_000)

    const stop = () => {
      if (done) return
      done = true
      clearInterval(heartbeat)
      unsub()
      q.push(null)
      log.info("global event disconnected")
    }

    const unsub = subscribe(q)

    stream.onAbort(stop)

    try {
      for await (const data of q) {
        if (data === null) return
        await stream.writeSSE({ data })
      }
    } finally {
      stop()
    }
  })
}

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the OpenCode server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: InstallationVersion })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the OpenCode system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      project: z.string().optional(),
                      workspace: z.string().optional(),
                      payload: z.union([...BusEvent.payloads(), ...SyncEvent.payloads()]),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")

        return streamEvents(c, (q) => {
          async function handler(event: any) {
            q.push(JSON.stringify(event))
          }
          GlobalBus.on("event", handler)
          return () => GlobalBus.off("event", handler)
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global OpenCode configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal())))
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global OpenCode configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info.zod),
      async (c) => {
        const config = c.req.valid("json")
        const result = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.updateGlobal(config)))
        if (result.changed) {
          void AppRuntime.runPromise(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })).catch(
            () => undefined,
          )
        }
        return c.json(result.info)
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await AppRuntime.runPromise(disposeAllInstancesAndEmitGlobalDisposed())
        return c.json(true)
      },
    )
    .post(
      "/upgrade",
      describeRoute({
        summary: "Upgrade opencode",
        description: "Upgrade opencode to the specified version or latest if not specified.",
        operationId: "global.upgrade",
        responses: {
          200: {
            description: "Upgrade result",
            content: {
              "application/json": {
                schema: resolver(
                  z.union([
                    z.object({
                      success: z.literal(true),
                      version: z.string(),
                    }),
                    z.object({
                      success: z.literal(false),
                      error: z.string(),
                    }),
                  ]),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          target: z.string().optional(),
        }),
      ),
      async (c) => {
        const result = await AppRuntime.runPromise(
          Installation.Service.use((svc) =>
            Effect.gen(function* () {
              const method = yield* svc.method()
              if (method === "unknown") {
                return { success: false as const, status: 400 as const, error: "Unknown installation method" }
              }

              const target = c.req.valid("json").target || (yield* svc.latest(method))
              const result = yield* Effect.catch(
                svc.upgrade(method, target).pipe(Effect.as({ success: true as const, version: target })),
                (err) =>
                  Effect.succeed({
                    success: false as const,
                    status: 500 as const,
                    error: err instanceof Error ? err.message : String(err),
                  }),
              )
              if (!result.success) return result
              return { ...result, status: 200 as const }
            }),
          ),
        )
        if (!result.success) {
          return c.json({ success: false, error: result.error }, result.status)
        }
        const target = result.version
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: Installation.Event.Updated.type,
            properties: { version: target },
          },
        })
        return c.json({ success: true, version: target })
      },
    )
    .get(
      "/storage/database",
      describeRoute({
        summary: "Get current database path",
        description: "Returns the resolved database file path currently in use by OpenCode.",
        operationId: "global.storage.database",
        responses: {
          200: {
            description: "Database path information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string().describe("Absolute path to the database file"),
                    channel: z.string().optional().describe("Installation channel"),
                    configFiles: z.array(z.string()).optional().describe("Config files"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          path: DatabasePath,
          channel: InstallationChannel,
          configFiles: StorageConfig.configFiles(),
        })
      },
    )
    .get(
      "/storage/log",
      describeRoute({
        summary: "Get current log directory path",
        description: "Returns the resolved log directory path currently in use by OpenCode.",
        operationId: "global.storage.log",
        responses: {
          200: {
            description: "Log directory path information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string().describe("Absolute path to the log directory"),
                    configFiles: z.array(z.string()).optional().describe("Config files"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          path: Log.LogDir(),
          configFiles: StorageConfig.configFiles(),
        })
      },
    )
    .get(
      "/storage/worktree",
      describeRoute({
        summary: "Get current worktree directory path",
        description: "Returns the resolved worktree directory path currently in use by OpenCode.",
        operationId: "global.storage.worktree",
        responses: {
          200: {
            description: "Worktree directory path information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string().describe("Absolute path to the worktree directory"),
                    configFiles: z.array(z.string()).optional().describe("Config files"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          path: Worktree.resolveDir(),
          configFiles: StorageConfig.configFiles(),
        })
      },
    )
    .get(
      "/storage/snapshot",
      describeRoute({
        summary: "Get current snapshot directory path",
        description: "Returns the resolved snapshot directory path currently in use by OpenCode.",
        operationId: "global.storage.snapshot",
        responses: {
          200: {
            description: "Snapshot directory path information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string().describe("Absolute path to the snapshot directory"),
                    configFiles: z.array(z.string()).optional().describe("Config files"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          path: Snapshot.resolveDir(),
          configFiles: StorageConfig.configFiles(),
        })
      },
    )
    .post(
      "/config/init",
      describeRoute({
        summary: "Initialize global config",
        description: "Creates a default global config file if none exists.",
        operationId: "global.config.init",
        responses: {
          200: {
            description: "Global config initialized",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string().describe("Absolute path to the global config file"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const path = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.initGlobalConfig()))
        return c.json({ path })
      },
    )
    .get(
      "/config/path",
      describeRoute({
        summary: "Get global config path",
        description: "Returns the resolved global config file path.",
        operationId: "global.config.path",
        responses: {
          200: {
            description: "Global config path information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string().describe("Absolute path to the global config file"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const files = StorageConfig.configFiles()
        return c.json({
          path: files.length > 0 ? files[0] : "",
        })
      },
    ),
)
