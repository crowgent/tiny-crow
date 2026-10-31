import test from "node:test";
import assert from "node:assert/strict";
import { centerText, crowBannerLines, centeredBanner } from "../src/pitui/banner.ts";
import { slashCandidates, pickerWindow, SLASH_COMMANDS, PROVIDER_NAMES, slashDescription } from "../src/pitui/slash.ts";
import { setupReadyFromConfig, providerKeyState } from "../src/pitui/adapter.ts";
import { windowPanelRows, maskedDisplay, PanelView, MaskedView, splitKeys } from "../src/pitui/panel.ts";

test("pitui_banner_has_big_crow_art", () => {
  const lines = crowBannerLines();
  assert.equal(lines.length, 8);
  assert.ok(lines[0]!.includes("█"));
  assert.ok(lines.join("\n").includes("tiny crow"));
});

test("pitui_center_text_pads_and_passes_through", () => {
  assert.equal(centerText("hi", 10), "    hi");
  assert.equal(centerText("long text here", 5), "long text here");
});

test("pitui_centered_banner_width", () => {
  const lines = centeredBanner(80);
  assert.equal(lines.length, 8);
  for (const line of lines) assert.ok(line.length <= 80);
});

test("pitui_slash_candidates_filter", () => {
  assert.ok(slashCandidates("").length > 40);
  assert.deepEqual(slashCandidates("qu"), ["quit", "queue"]);
  assert.ok(slashCandidates("pro").includes("provider"));
  assert.ok(slashCandidates("pro").includes("prompt"));
});

test("pitui_picker_window_empty_and_short", () => {
  assert.deepEqual(pickerWindow([], 0, 8), { rows: [], selected: 0 });
  const short = pickerWindow(["model", "quit", "help"], 2, 8);
  assert.deepEqual(short.rows, ["  /model", "  /quit", "  /help"]);
  assert.equal(short.selected, 2);
});

test("pitui_picker_window_first_page_has_below_indicator", () => {
  const win = pickerWindow(SLASH_COMMANDS, 0, 8);
  assert.equal(win.rows.length, 9);
  assert.equal(win.rows[0], "  /provider");
  assert.equal(win.rows[7], "  /theme");
  assert.equal(win.rows[8], `  ↓ ${SLASH_COMMANDS.length - 8} more below`);
  assert.equal(win.selected, 0);
});

test("pitui_picker_window_follows_selection_down", () => {
  const win = pickerWindow(SLASH_COMMANDS, 10, 8);
  assert.equal(win.rows[0], "  ↑ 3 more above");
  assert.equal(win.rows[8], "  /reasoning");
  assert.equal(win.rows[9], `  ↓ ${SLASH_COMMANDS.length - 11} more below`);
  assert.equal(win.selected, 8);
});

test("pitui_picker_window_last_page_has_no_below_indicator", () => {
  const last = SLASH_COMMANDS.length - 1;
  const win = pickerWindow(SLASH_COMMANDS, last, 8);
  assert.equal(win.rows[0], `  ↑ ${SLASH_COMMANDS.length - 8} more above`);
  assert.equal(win.rows[win.rows.length - 1], "  /queue");
  assert.equal(win.selected, win.rows.length - 1);
  assert.ok(!win.rows.some((row) => row.includes("more below")));
});

test("pitui_provider_names_and_descriptions", () => {
  assert.equal(PROVIDER_NAMES.length, 7);
  assert.ok(PROVIDER_NAMES.includes("openrouter"));
  assert.ok(PROVIDER_NAMES.includes("ollama"));
  assert.equal(slashDescription("provider"), "show or switch provider");
  assert.equal(slashDescription("quit"), "leave the TUI");
  assert.equal(slashDescription("nosuchcommand"), "");
});

test("pitui_panel_window_follows_selection", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ label: `item${i}` }));
  const first = windowPanelRows(items, 0, 8);
  assert.equal(first.rows[0], "  item0");
  assert.equal(first.rows[8], "  ↓ 12 more below");
  assert.equal(first.selected, 0);
  const deep = windowPanelRows(items, 15, 8);
  assert.equal(deep.rows[0], "  ↑ 8 more above");
  assert.equal(deep.rows[8], "  item15");
  assert.equal(deep.rows[9], "  ↓ 4 more below");
  assert.equal(deep.selected, 8);
  const empty = windowPanelRows([], 0, 8);
  assert.deepEqual(empty.rows, ["  (none)"]);
});

test("pitui_setup_ready_from_config", () => {
  const saved = process.env["OPENROUTER_API_KEY"];
  delete process.env["OPENROUTER_API_KEY"];
  try {
    assert.equal(setupReadyFromConfig({ provider: "ollama", apiKeys: {} }), true);
    assert.equal(setupReadyFromConfig({ provider: "opencode-zen", apiKeys: {} }), true);
    assert.equal(setupReadyFromConfig({ provider: "openrouter", apiKeys: {} }), false);
    assert.equal(setupReadyFromConfig({ provider: "openrouter", apiKeys: { openrouter: "dummy" } }), true);
    assert.equal(setupReadyFromConfig({ provider: null, apiKeys: {} }), false);
    process.env["OPENROUTER_API_KEY"] = "dummy";
    assert.equal(setupReadyFromConfig({ provider: "openrouter", apiKeys: {} }), true);
  } finally {
    if (saved === undefined) delete process.env["OPENROUTER_API_KEY"];
    else process.env["OPENROUTER_API_KEY"] = saved;
  }
});

test("pitui_provider_key_state", () => {
  assert.equal(providerKeyState({}, "ollama"), "no key needed");
  assert.equal(providerKeyState({}, "openai"), "needs key");
  assert.equal(providerKeyState({ openai: "x" }, "openai"), "key saved");
});

test("pitui_slash_command_list_complete", () => {
  for (const name of ["provider", "model", "models", "models-add", "model-subagent", "models-subagent", "prompt", "theme", "regen-prompts", "regen-themes", "sessions", "help", "quit", "btw", "queue"]) {
    assert.ok(SLASH_COMMANDS.includes(name), name);
    assert.notEqual(slashDescription(name), "", name);
  }
});

test("pitui_masked_entry_shows_bullets_only", () => {
  const secret = "sk-test-secret-value-12345";
  const view = new MaskedView("API key", "Enter save | Esc cancel");
  let done: string | null = "unset";
  view.onDone = (value) => {
    done = value;
  };
  for (const ch of secret) view.handleInput(ch);
  const rendered = view.render(80).join("\n");
  assert.ok(!rendered.includes(secret));
  assert.ok(!rendered.includes("sk-test"));
  assert.equal(rendered.includes(maskedDisplay(secret.length)), true);
  assert.equal(maskedDisplay(0), "");
  assert.equal(maskedDisplay(3), "•••");
  view.handleInput("\r");
  assert.equal(done, secret);
});

test("pitui_masked_entry_backspace_and_cancel", () => {
  const view = new MaskedView("API key", "Enter save | Esc cancel");
  let done: string | null = "unset";
  view.onDone = (value) => {
    done = value;
  };
  view.handleInput("a");
  view.handleInput("b");
  view.handleInput("\x7f");
  assert.equal(view.chars.join(""), "a");
  view.handleInput("\x1b");
  assert.equal(done, null);
});

test("pitui_masked_entry_empty_enter_cancels", () => {
  const view = new MaskedView("API key", "Enter save | Esc cancel");
  let done: string | null = "unset";
  view.onDone = (value) => {
    done = value;
  };
  view.handleInput("\r");
  assert.equal(done, null);
});

test("pitui_panel_view_filter_and_select", () => {
  const view = new PanelView("provider", "provider | Esc back", [
    { label: "openrouter", detail: "needs key" },
    { label: "ollama", detail: "no key needed" },
    { label: "openai", detail: "needs key" },
  ]);
  let selected: number | null = -1;
  view.onSelect = (index) => {
    selected = index;
  };
  view.handleInput("o");
  view.handleInput("l");
  assert.deepEqual(view.visible().map(({ item }) => item.label), ["ollama"]);
  view.handleInput("\r");
  assert.equal(selected, 1);
});

test("pitui_split_keys_and_chunked_input", () => {
  assert.deepEqual(splitKeys("ab\r"), ["a", "b", "\r"]);
  assert.deepEqual(splitKeys("\x1b[Bx"), ["\x1b[B", "x"]);
  assert.deepEqual(splitKeys("\x1b"), ["\x1b"]);
  const view = new MaskedView("API key", "Enter save | Esc cancel");
  let done: string | null = "unset";
  view.onDone = (value) => {
    done = value;
  };
  view.handleInput("abc\r");
  assert.equal(done, "abc");
  assert.equal(view.render(80).join("\n").includes("abc"), false);
  const panel = new PanelView("provider", "Esc back", [
    { label: "openrouter" },
    { label: "ollama" },
  ]);
  let selected: number | null = -1;
  panel.onSelect = (index) => {
    selected = index;
  };
  panel.handleInput("ol\r");
  assert.equal(selected, 1);
});

test("pitui_panel_view_arrows_and_escape", () => {
  const view = new PanelView("commands", "commands | Esc back", [
    { label: "/provider" },
    { label: "/model" },
    { label: "/help" },
  ]);
  let selected: number | null = -1;
  view.onSelect = (index) => {
    selected = index;
  };
  view.handleInput("\x1b[B");
  view.handleInput("\r");
  assert.equal(selected, 1);
  const escView = new PanelView("commands", "commands | Esc back", [{ label: "/help" }]);
  let escSelected: number | null = -1;
  escView.onSelect = (index) => {
    escSelected = index;
  };
  escView.handleInput("\x1b");
  assert.equal(escSelected, null);
});
