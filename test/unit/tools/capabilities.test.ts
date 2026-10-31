import { describe, expect, it } from "vitest";
import { checkCapabilityDependencies } from "../../../src/tools/capabilities.js";
import type { CapabilityManifest } from "../../../src/tools/capabilities.js";

describe("capability dependency health", () => {
  it("reports missing Python modules as unavailable dependencies", () => {
    const manifest: CapabilityManifest = {
      domains: ["browser"],
      aliases: ["rendered page"],
      access: "typed_cli",
      outputKind: "text",
      riskZone: 2,
      dependencies: [
        { kind: "python_module", name: "__definitely_missing_python_module_for_test__", required: true },
      ],
    };

    const health = checkCapabilityDependencies("browser_read", manifest);

    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({
      tool: "browser_read",
      ok: false,
      detail: "python module missing",
    });
  });
});
