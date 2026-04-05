import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const Event = {
  Connected: BusEvent.define("server.connected", z.object({})),
  Disposed: BusEvent.define("global.disposed", z.object({})),
  ConfigUpdated: BusEvent.define(
    "global.config.updated",
    z.object({
      restart_required: z.array(z.string()).optional(),
    }),
  ),
}
