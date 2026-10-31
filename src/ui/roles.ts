import type { BlockStyle } from "./feed.ts";
import {
  parseColor,
  rgbColor,
  type Color,
} from "./utils.ts";

export const C_AGENT: Color = rgbColor(202, 211, 245);
export const C_ERROR: Color = rgbColor(237, 135, 150);
export const C_TOOL: Color = rgbColor(238, 212, 159);
export const C_PERM: Color = rgbColor(245, 189, 230);
export const C_BTW: Color = rgbColor(139, 213, 202);
export const C_HANDOFF: Color = rgbColor(166, 218, 149);

let roleOverrides: Map<BlockStyle, Color> | null = null;

export function defaultColor(role: BlockStyle): Color {
  switch (role) {
    case "user":
      return rgbColor(166, 218, 149);
    case "agent":
      return C_AGENT;
    case "reasoning":
      return rgbColor(198, 160, 246);
    case "tool":
      return C_TOOL;
    case "tool_result":
      return rgbColor(110, 115, 141);
    case "error":
      return C_ERROR;
    case "system":
      return rgbColor(147, 154, 183);
    case "welcome":
      return C_BTW;
    case "permission":
      return C_PERM;
    case "plain":
      return C_AGENT;
    default:
      return C_AGENT;
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
