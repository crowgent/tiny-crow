import test from "node:test";
import assert from "node:assert/strict";
import { WriteTool } from "../src/agent/tools/write.ts";
import { PermissionChecker } from "../src/permission/checker.ts";
import {
  SecurityMode,
  permissionConfigsFromGlob,
} from "../src/permission/mod.ts";
import {
  defaultRetryConfig,
  runPrint,
  type AgentLike,
  type StreamItem,
} from "../src/agent/runner.ts";

function guardedChecker(): PermissionChecker {
  return new PermissionChecker(
    permissionConfigsFromGlob({}),
    SecurityMode.Guarded,
    "/home/user/project",
    ["guarded", "standard", "yolo"],
  );
}

test("headless_ask_denies_instead_of_hanging", async () => {
  // The tool itself, wired with a Guarded-mode checker and no ask channel
  // (exactly what non-interactive dispatch passes), must fail closed.
  const writeTool = new WriteTool(guardedChecker(), null, null);
  await assert.rejects(
    writeTool.call({ path: "/etc/passwd", content: "x" }),
    /Permission denied \(non-interactive mode\)/,
  );

  // At the runPrint boundary, the denial is fed back to the model as an
  // ordinary tool result and the run completes instead of hanging. The
  // TS runPrint consumes a single stream (no stop-hook turn loop), so the
  // tool round trip and the follow-up reply arrive in one stream.
  const denial = "Permission denied (non-interactive mode)";
  const agent: AgentLike = {
    async *stream(): AsyncGenerator<StreamItem> {
      yield { kind: "toolCall", id: "call-1", name: "write", args: { path: "/etc/passwd", content: "x" } };
      yield { kind: "toolResult", callId: "call-1", name: "write", output: denial };
      yield { kind: "text", text: "acknowledged" };
      yield { kind: "final", output: "acknowledged", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationInputTokens: 0 } };
    },
  };

  const outcome = await Promise.race([
    runPrint(agent, "please write to /etc/passwd", false, defaultRetryConfig(), []),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("runPrint must complete within the timeout instead of hanging on an unserviced ask channel")), 2000),
    ),
  ]);
  assert.ok(outcome.toolInteractions.length >= 1);
  assert.ok(
    outcome.toolInteractions[0]!.output.includes(denial),
    `expected the tool result fed back to the model to contain the non-interactive denial, got ${JSON.stringify(outcome.toolInteractions)}`,
  );
  assert.ok(outcome.response.includes("acknowledged"));
});
