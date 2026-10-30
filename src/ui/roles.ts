import type { BlockStyle } from "./feed.ts";
import {
  COLOR_CYAN,
  COLOR_DARK_GREY,
  COLOR_DARK_MAGENTA,
  COLOR_GREEN,
  COLOR_MAGENTA,
  COLOR_RED,
  COLOR_WHITE,
  COLOR_YELLOW,
  parseColor,
  type Color,
} from "./utils.ts";

/**
 * Configurable semantic role colours.
 *
 * Every feed block has a semantic role (agent, error, tool, permission,
 * ...). The built-in palette below is used for any role without a
 * configured override; overrides come from a theme's or the config's
 * `[colors.roles]` map and are applied/reset whenever a theme is selected,
 * so switching themes drops the previous theme's roles.
 *
 * The palette constants mirror the Rust module's `C_AGENT`, `C_ERROR`,
 * `C_TOOL` and `C_PERM` values; they live here rather than in `mod.ts` so
 * this module and `feed.ts` do not import each other at runtime.
 */
export const C_AGENT: Color = COLOR_WHITE;
export const C_ERROR: Color = COLOR_RED;
export const C_TOOL: Color = COLOR_YELLOW;
export const C_PERM: Color = COLOR_MAGENTA;
export const C_BTW: Color = COLOR_CYAN;
export const C_HANDOFF: Color = COLOR_GREEN;

let roleOverrides: Map<BlockStyle, Color> | null = null;

/** The built-in palette, used for any role without a configured override. */
export function defaultColor(role: BlockStyle): Color {
  switch (role) {
    case "user":
      return COLOR_GREEN;
    case "agent":
      return C_AGENT;
    case "reasoning":
      return COLOR_DARK_MAGENTA;
    case "tool":
      return C_TOOL;
    case "tool_result":
      return COLOR_DARK_GREY;
    case "error":
      return C_ERROR;
    case "system":
      return COLOR_DARK_GREY;
    case "welcome":
      return COLOR_CYAN;
    case "permission":
      return C_PERM;
    case "plain":
      return COLOR_WHITE;
    default:
      return COLOR_WHITE;
  }
}

/** The colour a role renders in: the configured override when one was applied, otherwise the default. */
export function color(role: BlockStyle): Color {
  const override = roleOverrides?.get(role);
  return override ?? defaultColor(role);
}

/** Map a `[colors.roles]` key to its semantic role. Accepts plain names (`tool_result` also as `toolresult`, `tool-result`). */
export function roleFromName(name: string): BlockStyle | null {
  switch (name.trim().toLowerCase()) {
    case "user":
      return "user";
    case "agent":
      return "agent";
    case "reasoning":
      return "reasoning";
    case "tool":
      return "tool";
    case "tool_result":
    case "toolresult":
    case "tool-result":
      return "tool_result";
    case "error":
      return "error";
    case "system":
      return "system";
    case "welcome":
      return "welcome";
    case "permission":
      return "permission";
    case "plain":
      return "plain";
    default:
      return null;
  }
}

/**
 * Apply a `[colors.roles]` map from a theme or the config: reset to the
 * default palette, then apply each known role with a parsable colour.
 * Unknown role names and unparsable colours are skipped so a typo never
 * breaks rendering.
 */
export function applyRoles(roles: Map<string, string> | Record<string, string>): void {
  const overrides = new Map<BlockStyle, Color>();
  const entries =
    roles instanceof Map ? [...roles.entries()] : Object.entries(roles);
  for (const [name, value] of entries) {
    const role = roleFromName(name);
    if (role === null) continue;
    const parsed = parseColor(value);
    if (parsed !== null) overrides.set(role, parsed);
  }
  roleOverrides = overrides;
}

/** Drop all overrides (a theme/config without a `roles` map restores the default palette). */
export function resetRoles(): void {
  roleOverrides = null;
}
