import { EOL } from "os"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { effectCmd } from "../effect-cmd"

export const ConfigCommand = effectCmd({
  command: "config init-global",
  describe: "initialize a default global config file",
  builder: (yargs) => yargs,
  instance: false,
  handler: Effect.fn("Cli.config.initGlobal")(function* () {
    const path = yield* Config.Service.use((cfg) => cfg.initGlobalConfig())
    process.stdout.write("Created global config at " + path + EOL)
  }),
})
