import { BusEvent } from "@/bus/bus-event"
import { Schema } from "effect"

export const Event = {
  Connected: BusEvent.define("server.connected", Schema.Struct({})),
  Disposed: BusEvent.define("global.disposed", Schema.Struct({})),
  ConfigUpdated: BusEvent.define(
    "global.config.updated",
    Schema.Struct({
      restart_required: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
}
