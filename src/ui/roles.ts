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

export const C_AGENT: Color = COLOR_WHITE;
export const C_ERROR: Color = COLOR_RED;
export const C_TOOL: Color = COLOR_YELLOW;
export const C_PERM: Color = COLOR_MAGENTA;
export const C_BTW: Color = COLOR_CYAN;
export const C_HANDOFF: Color = COLOR_GREEN;

let roleOverrides: Map<BlockStyle, Color> | null = null;

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

export function color(role: BlockStyle): Color {
  const override = roleOverrides?.get(role);
  return override ?? defaultColor(role);
}

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

export function resetRoles(): void {
  roleOverrides = null;
}
