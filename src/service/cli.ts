import { defineCommand } from "citty";
import { handleAction } from "./supervision.js";
import type { ServiceAction } from "./supervision.js";

const SERVICE_ACTIONS: ServiceAction[] = ["install", "start", "stop", "status", "uninstall"];

const serviceCommand = defineCommand({
  meta: {
    name: "service",
    description: "Manage her launchd service",
  },
  args: {
    action: {
      type: "positional",
      description: `Service action: ${SERVICE_ACTIONS.join(", ")}`,
      required: true,
    },
  },
  async run({ args }) {
    const action = args.action as string;

    if (!SERVICE_ACTIONS.includes(action as ServiceAction)) {
      console.error(`Unknown action: ${action}`);
      console.error(`Valid actions: ${SERVICE_ACTIONS.join(", ")}`);
      process.exit(1);
    }

    try {
      const result = handleAction(action as ServiceAction);
      if (result && typeof result === "object" && "running" in result) {
        if (result.running) {
          console.log(`Service is running (PID: ${result.pid})`);
        } else {
          console.log("Service is stopped");
        }
      } else {
        console.log(`Service ${action} complete`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Service ${action} failed: ${message}`);
      process.exit(1);
    }
  },
});

export default serviceCommand;
