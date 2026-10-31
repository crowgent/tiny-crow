import assert from "node:assert/strict";
import test from "node:test";
import { launcherContent } from "../scripts/install.ts";

test("launcher uses node from PATH by default", () => {
  assert.equal(
    launcherContent("/opt/tiny-crow/src/main.ts"),
    "#!/bin/sh\n" +
      "# tiny-crow launcher: runs the TS sources directly with Node.\n" +
      "exec 'node' '/opt/tiny-crow/src/main.ts' \"$@\"\n",
  );
});

test("launcher can pin a selected Node executable path", () => {
  assert.equal(
    launcherContent(
      "/opt/tiny-crow/src/main.ts",
      "/opt/node 24/bin/node",
    ),
    "#!/bin/sh\n" +
      "# tiny-crow launcher: runs the TS sources directly with Node.\n" +
      "exec '/opt/node 24/bin/node' '/opt/tiny-crow/src/main.ts' \"$@\"\n",
  );
});
