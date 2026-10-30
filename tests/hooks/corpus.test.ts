import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HookDispatcher, Verdict } from "../../src/extras/hooks/mod.ts";
import type { HookHandler, HooksConfig } from "../../src/extras/hooks/settings.ts";
import type { HookCtx } from "../../src/extras/hooks/envelope.ts";

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "corpus");

function ctx(): HookCtx {
  return {
    sessionId: "corpus-sess",
    sessionPath: "",
    cwd: "/repo",
    permissionMode: "standard",
  };
}

function dispatcherFor(event: string, hookPath: string): HookDispatcher {
  const handler: HookHandler = {
    type: "command",
    command: `sh ${hookPath}`,
    args: undefined,
    timeout: 5,
    async: false,
    if: undefined,
    once: false,
  };
  const config: HooksConfig = { [event]: [{ hooks: [handler] }] };
  return HookDispatcher.fromConfig(config);
}

test("corpus_cases_match_expected_decisions", async () => {
  const cases = readdirSync(corpusDir)
    .map((name) => join(corpusDir, name))
    .filter((p) => statSync(p).isDirectory())
    .sort();
  assert.notEqual(cases.length, 0, `corpus at ${corpusDir} is empty`);

  for (const caseDir of cases) {
    const caseName = caseDir.split("/").at(-1) ?? caseDir;
    const envelope = JSON.parse(readFileSync(join(caseDir, "envelope.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const expected = JSON.parse(readFileSync(join(caseDir, "expected.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const event = envelope.event as string;
    assert.ok(typeof event === "string", `[${caseName}] envelope.json missing "event"`);
    const dispatcher = dispatcherFor(event, join(caseDir, "hook.sh"));
    const kind = expected.kind as string;
    assert.ok(typeof kind === "string", `[${caseName}] expected.json missing "kind"`);

    if (kind === "pre_tool_use") {
      const toolName = envelope.tool_name as string;
      assert.ok(typeof toolName === "string", `[${caseName}] envelope.json missing "tool_name"`);
      const decision = await dispatcher.dispatchPreToolUse(ctx(), toolName, envelope.tool_input);
      const expectedVerdict = {
        Deny: Verdict.Deny,
        Ask: Verdict.Ask,
        Allow: Verdict.Allow,
        Defer: Verdict.Defer,
      }[expected.verdict as string];
      assert.ok(expectedVerdict !== undefined, `[${caseName}] unknown expected verdict`);
      assert.equal(decision.verdict, expectedVerdict, `[${caseName}] verdict mismatch`);

      assert.equal(
        (decision.reason ?? null) === null ? null : decision.reason!.trim(),
        (expected.reason as string | null) ?? null,
        `[${caseName}] reason mismatch`,
      );
      if ("updated_input" in expected) {
        assert.deepEqual(
          decision.updatedInput,
          expected.updated_input,
          `[${caseName}] updated_input mismatch`,
        );
      }
    } else if (kind === "generic") {

      assert.equal(
        event,
        "Stop",
        `[${caseName}] the "generic" harness path only supports event "Stop" today`,
      );
      const decision = await dispatcher.dispatch("Stop", null, ctx(), {
        kind: "Stop",
        stopHookActive: false,
        loopIteration: null,
        loopActive: null,
      });
      if (expected.decision === "Continue") {
        assert.deepEqual(decision, { kind: "Continue" }, `[${caseName}] decision mismatch`);
      } else if (expected.decision === "Block") {
        assert.deepEqual(
          decision,
          { kind: "Block", reason: (expected.reason as string) ?? "" },
          `[${caseName}] decision mismatch`,
        );
      } else {
        assert.fail(`[${caseName}] unknown expected decision: ${String(expected.decision)}`);
      }
    } else {
      assert.fail(`[${caseName}] unknown expected.json "kind": ${kind}`);
    }
  }
});
