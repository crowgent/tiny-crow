import test from "node:test";
import assert from "node:assert/strict";
import { parseHooksConfig } from "../../src/extras/hooks/mod.ts";

test("cc_shaped_config_parses_with_command_handler_defaults", () => {
  const config = parseHooksConfig({
    PreToolUse: [
      {
        matcher: "Bash|Write",
        hooks: [{ type: "command", command: "echo hi", timeout: 60 }],
      },
    ],
  });
  const group = config.PreToolUse[0];
  assert.equal(group.matcher, "Bash|Write");
  assert.equal(group.hooks.length, 1);
  const handler = group.hooks[0];
  assert.equal(handler.type, "command");
  assert.equal(handler.command, "echo hi");
  assert.equal(handler.timeout, 60);
  assert.equal(handler.async, false);
  assert.equal(handler.if, undefined);
  assert.equal(handler.once, false);
});

test("if_and_once_fields_are_preserved", () => {
  const config = parseHooksConfig({
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: "echo stop",
            if: "test -f ./Cargo.toml",
            once: true,
          },
        ],
      },
    ],
  });
  const handler = config.Stop[0].hooks[0];
  assert.equal(handler.if, "test -f ./Cargo.toml");
  assert.equal(handler.once, true);
});

test("non_command_handler_type_is_a_parse_error", () => {
  assert.throws(
    () =>
      parseHooksConfig({
        PreToolUse: [{ hooks: [{ type: "http", command: "echo hi" }] }],
      }),
    /http|unsupported/,
  );
});

test("args_parse_as_a_string_list", () => {
  const config = parseHooksConfig({
    PreToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: "echo",
            args: ["hello", "world"],
          },
        ],
      },
    ],
  });
  const handler = config.PreToolUse[0].hooks[0];
  assert.deepEqual(handler.args, ["hello", "world"]);
});
