import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { TelemetrySink, quietSink } from "./telemetry";

const MAX_PENDING = 100;

// The Convex client queues mutations over its socket and retries them after a
// reconnect, so a ride through a dead zone still lands once the phone is back.
export function convexSink(url: string | undefined): TelemetrySink {
  if (!url) return quietSink;
  const client = new ConvexClient(url, { unsavedChangesWarning: false });
  let pending = 0;
  function send(write: () => Promise<unknown>): void {
    if (pending >= MAX_PENDING) return;
    pending += 1;
    write()
      .catch(() => undefined)
      .finally(() => {
        pending -= 1;
      });
  }
  return {
    rideStarted: (ride) => send(() => client.mutation(api.rides.start, ride)),
    rideEvent: (event) => send(() => client.mutation(api.rides.event, event)),
    rideFinished: (finish) => send(() => client.mutation(api.rides.finish, finish)),
    linkEvent: (event) => send(() => client.mutation(api.link.record, event)),
  };
}
