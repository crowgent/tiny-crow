import test from "node:test";
import assert from "node:assert/strict";
import { splitBashCommands } from "../src/agent/tools/bash.ts";

const cases: [string, string, string[]][] = [
  ["split_simple_semicolon", "ls; pwd", ["ls", "pwd"]],
  ["split_double_ampersand", "cargo build && cargo test", ["cargo build", "cargo test"]],
  ["split_double_pipe", "false || echo fail", ["false", "echo fail"]],
  ["split_mixed_separators", "make; cargo build && cargo test || echo fail", ["make", "cargo build", "cargo test", "echo fail"]],
  ["split_single_command_no_separator", "echo hello", ["echo hello"]],
  ["split_empty_input", "", []],
  ["split_semicolons_only", ";", []],
  ["split_leading_semicolon", "; ls", ["ls"]],
  ["split_trailing_semicolon", "ls;", ["ls"]],
  ["split_single_quoted_separators", "echo 'hello;world'", ["echo 'hello;world'"]],
  ["split_double_quoted_separators", 'echo "a && b"', ['echo "a && b"']],
  ["split_escaped_single_quote_inside_single_quotes", "echo 'it\\'s working'", ["echo 'it\\'s working'"]],
  ["split_escaped_double_quote_inside_double_quotes", 'echo "she said \\"hi\\""', ['echo "she said \\"hi\\""']],
  ["split_pipe_not_double_is_inline", "cat file | sort", ["cat file | sort"]],
  ["split_single_ampersand_inline", "sleep 1 & echo done", ["sleep 1 & echo done"]],
  ["split_append_redirect_is_separator", "echo foo >> log.txt", ["echo foo", "log.txt"]],
  ["split_quoted_string_with_mixed_content", "grep '; && ||' file.txt; echo done", ["grep '; && ||' file.txt", "echo done"]],
  ["split_escaped_backslash_before_quote", "echo \\\\'; echo two", ["echo \\\\'; echo two"]],
  ["split_newline_is_separator", "ls\npwd", ["ls", "pwd"]],
];
for (const [name, input, expected] of cases) {
  test(name, () => {
    assert.deepEqual(splitBashCommands(input), expected);
  });
}
