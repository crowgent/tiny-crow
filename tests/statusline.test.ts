import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLines,
  defaultSpec,
  formatChanges,
  formatStatus,
  fmtTokens,
  itemIcon,
  powerlineGlyph,
  type StatusContext,
  type StatusLineConfig,
  type StatusLineSegment,
  type StatusSpan,
} from "../src/ui/statusline.ts";
import { parseColor } from "../src/ui/utils.ts";
import { emptyGitStatus } from "../src/session/mod.ts";
import { MessageRole, Session } from "../src/session/mod.ts";

function ctx(): StatusContext {
  return { btwCost: 0, btwIn: 0, btwOut: 0 };
}

function seg(item: string): StatusLineSegment {
  return { item };
}

function lineText(spans: StatusSpan[]): string {
  return spans
    .map((s) => (s.kind === "text" ? s.text : "\0FLEX\0"))
    .join("");
}

type AnySession = Parameters<typeof buildLines>[1];
function asStatusSession(s: Session): AnySession {
  return s as unknown as AnySession;
}

test("default_statusline_shows_core_items", () => {
  const session = Session.create("openrouter", "deepseek/deepseek-v4-pro", 1048576, "");
  const lines = buildLines(defaultSpec(), asStatusSession(session), ctx());
  assert.equal(lines.length, 1);
  const text = lineText(lines[0]!);
  assert.ok(text.includes("deepseek/deepseek-v4-pro"), text);
  assert.ok(text.includes("/1.0M"), text);
});

test("flex_separator_is_preserved", () => {
  const spec: StatusLineConfig = {
    lines: [{ segments: [seg("model"), seg("flex_separator"), seg("context_max")] }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  const lines = buildLines(spec, asStatusSession(session), ctx());
  assert.equal(lines[0]![1]!.kind, "flex");
});

test("skipped_optional_item_drops_adjacent_separator", () => {
  const spec: StatusLineConfig = {
    lines: [{ segments: [seg("model"), { item: "separator", text: " | " }, seg("cost")] }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  session.totalCost = 0;
  const lines = buildLines(spec, asStatusSession(session), ctx());
  assert.equal(lineText(lines[0]!), "m", "trailing separator should be dropped");
});

test("cost_shown_when_always_flag_set", () => {
  const spec: StatusLineConfig = { lines: [{ segments: [seg("cost")] }] };
  const session = Session.create("openrouter", "m", 1000, "");
  session.showCostAlways = true;
  const lines = buildLines(spec, asStatusSession(session), ctx());
  assert.equal(lineText(lines[0]!), "$0.0000");
});

test("format_changes_lists_nonzero_parts", () => {
  const g = { ...emptyGitStatus(), staged: 2, modified: 3, deleted: 0, untracked: 1, ahead: 0, behind: 0 };
  assert.equal(formatChanges(g), "+2 ~3 ?1");
  assert.equal(formatChanges(emptyGitStatus()), null);
});

test("format_status_shows_sync_and_dirty", () => {
  const g = { ...emptyGitStatus(), modified: 1, ahead: 2, behind: 1 };
  assert.equal(formatStatus(g), "↑2 ↓1 *");
  assert.equal(formatStatus(emptyGitStatus()), "✓");
});

test("fmt_tokens_scales", () => {
  assert.equal(fmtTokens(0), "0");
  assert.equal(fmtTokens(12000), "12k");
  assert.equal(fmtTokens(1048576), "1.0M");
});

test("powerline_glyph_resolves_names_and_passthrough", () => {
  assert.equal(powerlineGlyph("pl_right"), "");
  assert.equal(powerlineGlyph("round_left"), "");
  assert.equal(powerlineGlyph(""), "");
  assert.equal(powerlineGlyph(">"), ">");
});

test("left_right_caps_wrap_the_item", () => {
  const spec: StatusLineConfig = {
    lines: [{
      segments: [{
        item: "model",
        color: "white",
        bg: "blue",
        left: "pl_round_left",
        right: "pl_round_right",
      }],
    }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  const lines = buildLines(spec, asStatusSession(session), ctx());
  assert.equal(lines[0]!.length, 3);
  assert.equal(lineText(lines[0]!), "m");
});

test("caps_skipped_when_item_is_hidden", () => {
  const spec: StatusLineConfig = {
    lines: [{ segments: [{ item: "cost", left: "pl_round_left", right: "pl_round_right" }] }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  const lines = buildLines(spec, asStatusSession(session), ctx());
  assert.deepEqual(lines[0], []);
});

test("light_blue_color_parses_to_rgb", () => {
  assert.deepEqual(parseColor("light_blue"), { kind: "rgb", r: 0x5f, g: 0xaf, b: 0xff });
});

test("auto_icon_prepends_item_glyph", () => {
  const spec: StatusLineConfig = {
    lines: [{ segments: [{ item: "git_branch", icon: { kind: "auto", value: true } }] }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  session.gitBranch = "main";
  const lines = buildLines(spec, asStatusSession(session), ctx());
  assert.equal(lineText(lines[0]!), " main");
});

test("custom_icon_name_resolves", () => {
  const spec: StatusLineConfig = {
    lines: [{ segments: [{ item: "cwd", icon: { kind: "custom", value: "folder" } }] }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  const text = lineText(buildLines(spec, asStatusSession(session), ctx())[0]!);
  assert.ok(text.startsWith(" "), text);
});

test("item_icon_known_and_unknown", () => {
  assert.equal(itemIcon("git_branch"), "");
  assert.equal(itemIcon("tokens_input"), null);
});

test("cwd_full_vs_cwd_folder", () => {
  const spec: StatusLineConfig = {
    lines: [{ segments: [seg("cwd"), seg("separator"), seg("cwd_full")] }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  session.workingDir = "/var/lib/zerostack-demo/project";
  const lines = buildLines(spec, asStatusSession(session), ctx());
  assert.equal(lineText(lines[0]!), "project /var/lib/zerostack-demo/project");
});

test("always_shows_zero_tokens", () => {
  const hidden: StatusLineConfig = { lines: [{ segments: [seg("tokens_input")] }] };
  const forced: StatusLineConfig = {
    lines: [{ segments: [{ item: "tokens_input", always: true }] }],
  };
  const session = Session.create("openrouter", "m", 1000, "");
  assert.equal(lineText(buildLines(hidden, asStatusSession(session), ctx())[0]!), "");
  assert.equal(lineText(buildLines(forced, asStatusSession(session), ctx())[0]!), "0");
});

test("provider_model_short_message_count", () => {
  const spec: StatusLineConfig = {
    lines: [{ segments: [seg("provider"), seg("separator"), seg("model_short"), seg("separator"), seg("message_count")] }],
  };
  const session = Session.create("openrouter", "deepseek/deepseek-v4-pro", 1000, "");
  session.addMessage(MessageRole.User, "hi");
  const text = lineText(buildLines(spec, asStatusSession(session), ctx())[0]!);
  assert.equal(text, "openrouter deepseek-v4-pro 1");
});

test("reasoning_shows_only_when_enabled", () => {
  const spec: StatusLineConfig = { lines: [{ segments: [seg("reasoning")] }] };
  const session = Session.create("openrouter", "m", 1000, "");
  assert.equal(lineText(buildLines(spec, asStatusSession(session), ctx())[0]!), "");
  session.reasoningEnabled = true;
  assert.equal(lineText(buildLines(spec, asStatusSession(session), ctx())[0]!), "reasoning");
});

function firstFg(spans: StatusSpan[]): unknown {
  for (const s of spans) {
    if (s.kind === "text") return s.fg;
  }
  return undefined;
}

test("context_percentage_is_not_clamped", () => {
  const spec: StatusLineConfig = { lines: [{ segments: [seg("context_percentage")] }] };
  const session = Session.create("openrouter", "m", 1000, "");
  session.setCalibration(1100, 0);
  assert.equal(lineText(buildLines(spec, asStatusSession(session), ctx())[0]!), "110%");
});

test("context_percentage_color_warns_as_it_fills", () => {
  const spec: StatusLineConfig = { lines: [{ segments: [seg("context_percentage")] }] };
  const session = Session.create("openrouter", "m", 1000, "");
  session.setCalibration(500, 0);
  assert.equal(firstFg(buildLines(spec, asStatusSession(session), ctx())[0]!), null);
  session.setCalibration(950, 0);
  assert.equal(firstFg(buildLines(spec, asStatusSession(session), ctx())[0]!), "yellow");
  session.setCalibration(1100, 0);
  assert.equal(firstFg(buildLines(spec, asStatusSession(session), ctx())[0]!), "red");
});

test("session_age_is_short_duration", () => {
  const spec: StatusLineConfig = { lines: [{ segments: [seg("session_age")] }] };
  const session = Session.create("openrouter", "m", 1000, "");
  const text = lineText(buildLines(spec, asStatusSession(session), ctx())[0]!);
  assert.ok(text.endsWith("s") || text.endsWith("m"), `got ${JSON.stringify(text)}`);
});
