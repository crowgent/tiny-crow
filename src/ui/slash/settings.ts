import {
  parseSecurityMode,
  writeError,
  writeOk,
  writeResult,
  type SecurityMode,
  type SlashCtx,
} from "./mod.ts";
import { SlashDeferredError } from "./outcome.ts";

export type EditSystem = "similarity" | "hashedit";

let currentEditSystem: EditSystem = "similarity";

export function editSystem(): EditSystem {
  return currentEditSystem;
}

export function setEditSystem(system: EditSystem): void {
  currentEditSystem = system;
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  switch (parts[0]) {
    case "/reasoning":
    case "/thinking":
      await handleReasoning(ctx);
      break;
    case "/mode":
      await handleMode(parts, ctx);
      break;
    case "/toggle":
      await handleToggle(parts, ctx);
      break;
    case "/editsys":
      await handleEditsys(parts, ctx);
      break;
    case "/advisor":
      await handleAdvisor(parts, ctx);
      break;
    case "/mcp":
      await handleMcp(parts, ctx);
      break;
    default:
      break;
  }
}

async function handleReasoning(ctx: SlashCtx): Promise<void> {
  ctx.reasoningEnabled = !ctx.reasoningEnabled;
  ctx.showReasoning = ctx.reasoningEnabled;
  await ctx.rebuildAgent();
  writeOk(ctx.renderer, `reasoning: ${ctx.reasoningEnabled ? "on" : "off"}`);
}

async function handleAdvisor(parts: string[], ctx: SlashCtx): Promise<void> {
  const advisor = ctx.advisor;
  if (advisor === undefined) {
    writeError(ctx.renderer, "Advisor support not enabled");
    return;
  }
  const current = advisor.config();
  if (parts.length < 2) {
    writeOk(ctx.renderer, "advisor:");
    writeResult(ctx.renderer, `  enabled: ${current.enabled ? "yes" : "no"}`);
    writeResult(ctx.renderer, `  mode: ${current.humanHandoff ? "human handoff" : "model"}`);
    writeResult(ctx.renderer, `  model: ${current.advisorModel}`);
    writeResult(
      ctx.renderer,
      `  max uses: ${current.maxUses !== undefined ? String(current.maxUses) : "unlimited"}`,
    );
    writeResult(ctx.renderer, "");
    writeResult(ctx.renderer, `  context limit: ${current.kilobytesLimit} KB`);
    writeResult(ctx.renderer, "");
    writeResult(ctx.renderer, "  /advisor on|off");
    writeResult(ctx.renderer, "  /advisor handoff [on|off]");
    writeResult(ctx.renderer, "  /advisor model <name>");
    writeResult(ctx.renderer, "  /advisor max-uses <n>");
    writeResult(ctx.renderer, "  /advisor context-limit <kilobytes>");
    return;
  }
  switch (parts[1]) {
    case "on": {
      const cfg = { ...current, enabled: true };
      advisor.initConfig(cfg);
      await ctx.rebuildAgent();
      writeOk(ctx.renderer, "advisor: on");
      break;
    }
    case "off": {
      const cfg = { ...current, enabled: false };
      advisor.initConfig(cfg);
      await ctx.rebuildAgent();
      writeOk(ctx.renderer, "advisor: off");
      break;
    }
    case "handoff": {
      let newState: boolean;
      if (parts[2] === undefined || parts[2] === "on") newState = true;
      else if (parts[2] === "off") newState = false;
      else {
        writeError(ctx.renderer, `invalid: '${parts[2]}', use on or off`);
        return;
      }
      const cfg = { ...current, humanHandoff: newState };
      if (newState && current.handoffTx === undefined) {
        writeError(
          ctx.renderer,
          "Human handoff requires a TUI channel (start with --advisor-human-handoff)",
        );
        return;
      }
      advisor.initConfig(cfg);
      await ctx.rebuildAgent();
      writeOk(ctx.renderer, `advisor handoff: ${newState ? "on" : "off"}`);
      break;
    }
    case "model": {
      if (parts[2] !== undefined) {
        const cfg = { ...current, advisorModel: parts[2] };
        advisor.initConfig(cfg);
        await ctx.rebuildAgent();
        writeOk(ctx.renderer, `advisor model: ${parts[2]}`);
      } else {
        writeError(ctx.renderer, "usage: /advisor model <name>");
      }
      break;
    }
    case "max-uses": {
      const n = parts[2] !== undefined ? Number(parts[2]) : Number.NaN;
      if (Number.isInteger(n) && n >= 0) {
        const cfg = { ...current, maxUses: n === 0 ? undefined : n };
        const label = cfg.maxUses !== undefined ? String(cfg.maxUses) : "unlimited";
        advisor.initConfig(cfg);
        writeOk(ctx.renderer, `advisor max uses: ${label}`);
      } else {
        writeError(ctx.renderer, "usage: /advisor max-uses <number|0=unlimited>");
      }
      break;
    }
    case "context-limit": {
      const n = parts[2] !== undefined ? Number(parts[2]) : Number.NaN;
      if (Number.isInteger(n) && n >= 0) {
        const cfg = { ...current, kilobytesLimit: n };
        advisor.initConfig(cfg);
        writeOk(
          ctx.renderer,
          `advisor context limit: ${n} KB (${Math.floor((n * 1024) / 2)} chars head / ${Math.floor((n * 1024) / 2)} chars tail)`,
        );
      } else {
        writeError(ctx.renderer, "usage: /advisor context-limit <kilobytes>");
      }
      break;
    }
    default:
      writeError(
        ctx.renderer,
        `unknown: '${parts[1]}' (on|off|handoff|model|max-uses|context-limit)`,
      );
      break;
  }
}

async function handleMode(parts: string[], ctx: SlashCtx): Promise<void> {
  const currentMode: SecurityMode | string =
    ctx.permission?.mode() ?? "standard";
  if (parts.length < 2) {
    writeOk(ctx.renderer, "security mode:");
    writeResult(ctx.renderer, `  current: ${currentMode}`);
    writeResult(ctx.renderer, "");
    writeResult(ctx.renderer, "  /mode standard      allow within CWD, ask for external");
    writeResult(ctx.renderer, "  /mode restrictive   ask for all operations");
    writeResult(ctx.renderer, "  /mode readonly      allow reads, deny everything else");
    writeResult(ctx.renderer, "  /mode guarded       allow reads, ask for everything else");
    writeResult(ctx.renderer, "  /mode yolo          allow all, ask for destructive bash");
    return;
  }
  const mode = parseSecurityMode(parts[1]);
  if (mode === undefined) {
    writeError(ctx.renderer, `unknown mode: ${parts[1]}`);
    return;
  }
  await setMode(ctx, mode, parts[1]);
}

async function setMode(ctx: SlashCtx, mode: SecurityMode, label: string): Promise<void> {
  if (ctx.permission !== undefined) {
    ctx.permission.setMode(mode);
    writeOk(ctx.renderer, `security mode: ${label}`);
  } else {
    writeError(ctx.renderer, "permission system not active");
  }
}

async function handleToggle(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length < 2) {
    writeOk(ctx.renderer, "usage: /toggle <feature> [on|off]");
    writeOk(ctx.renderer, "features:");
    writeResult(ctx.renderer, `  todo  ${ctx.todoToolsEnabled ? "on" : "off"}`);
    return;
  }
  let newState: boolean;
  if (parts[2] === "on") newState = true;
  else if (parts[2] === "off") newState = false;
  else if (parts[2] === undefined) newState = !ctx.todoToolsEnabled;
  else {
    writeError(ctx.renderer, `invalid: '${parts[2]}', use on or off`);
    return;
  }
  if (newState === ctx.todoToolsEnabled) {
    writeOk(ctx.renderer, `todo tools already ${newState ? "on" : "off"}`);
  } else {
    ctx.todoToolsEnabled = newState;
    await ctx.rebuildAgent();
    writeOk(ctx.renderer, `todo tools: ${ctx.todoToolsEnabled ? "on" : "off"}`);
  }
}

async function handleEditsys(parts: string[], ctx: SlashCtx): Promise<void> {
  const current = ctx.editSystem !== undefined
    ? ctx.editSystem.current()
    : editSystem();
  if (parts.length < 2) {
    writeOk(ctx.renderer, `edit system: ${current}`);
    writeResult(ctx.renderer, "  /editsys similarity   SEARCH/REPLACE with fuzzy matching");
    writeResult(ctx.renderer, "  /editsys hashedit     tag-based (CRC-32 line hashes)");
    return;
  }
  if (parts[1] === "similarity" || parts[1] === "hashedit") {
    if (ctx.editSystem !== undefined) {
      ctx.editSystem.set(parts[1] as "similarity" | "hashedit");
    }
    else setEditSystem(parts[1]);
    writeOk(
      ctx.renderer,
      parts[1] === "similarity"
        ? "edit system: similarity (SEARCH/REPLACE)"
        : "edit system: hashedit (tag-based)",
    );
  } else {
    writeError(ctx.renderer, `unknown: '${parts[1]}' (similarity|hashedit)`);
  }
}

async function handleMcp(parts: string[], ctx: SlashCtx): Promise<void> {
  if (parts.length >= 2 && parts[1] === "login") {
    await handleMcpLogin(parts[2]?.trim(), ctx);
    return;
  }
  if (parts.length >= 2 && parts[1] === "logout") {
    await handleMcpLogout(parts[2]?.trim(), ctx);
    return;
  }
  const mgr = ctx.mcpManager;
  if (mgr === undefined) {
    writeOk(ctx.renderer, "no MCP servers configured");
    return;
  }
  if (parts.length > 1) {
    const name = parts[1].trim();
    const handle = await mgr.getHandle(name);
    if (handle !== undefined) {
      try {
        const tools = await handle.listTools();
        if (tools.length === 0) {
          writeOk(ctx.renderer, `server '${name}' has no tools`);
        } else {
          writeOk(ctx.renderer, `tools on '${name}':`);
          for (const tool of tools) {
            writeResult(ctx.renderer, `  ${tool.name}  ${tool.description ?? ""}`);
          }
        }
      } catch (e) {
        writeError(
          ctx.renderer,
          `error listing tools on '${name}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else if (isOauthServer(ctx, name)) {
      writeError(ctx.renderer, `server '${name}' is not connected (run /mcp login ${name})`);
    } else if (serverIsConfigured(ctx, name)) {
      writeError(ctx.renderer, `server '${name}' is not connected`);
    } else {
      writeError(ctx.renderer, `unknown MCP server: '${name}'`);
    }
    return;
  }
  const servers = ctx.cfg.mcpServers;
  if (servers === undefined || Object.keys(servers).length === 0) {
    writeOk(ctx.renderer, "no MCP servers configured");
    return;
  }
  writeOk(ctx.renderer, "MCP servers:");
  for (const name of Object.keys(servers).sort()) {
    const handle = await mgr.getHandle(name);
    if (handle !== undefined) {
      let label: string;
      try {
        const tools = await handle.listTools();
        label = `  + ${name} (${tools.length} tools)`;
      } catch {
        label = `  + ${name} (connected)`;
      }
      ctx.renderer.writeLine(label, "green");
    } else {
      const oauth = isOauthServer(ctx, name);
      const label = oauth
        ? `  - ${name} (unauthenticated, run /mcp login ${name})`
        : `  - ${name} (not connected)`;
      ctx.renderer.writeLine(label, "red");
    }
  }
}

function serverIsConfigured(ctx: SlashCtx, name: string): boolean {
  return ctx.cfg.mcpServers?.[name] !== undefined;
}

function isOauthServer(ctx: SlashCtx, name: string): boolean {
  const server = ctx.cfg.mcpServers?.[name];
  return server !== undefined && !server.isCommand && server.oauthSettings !== undefined;
}

function resolveOauthServer(
  ctx: SlashCtx,
  name: string,
): [string, unknown] {
  const servers = ctx.cfg.mcpServers;
  if (servers === undefined) throw new Error("no MCP servers configured");
  const server = servers[name];
  if (server === undefined) throw new Error(`unknown MCP server: '${name}'`);
  if (server.isCommand) {
    throw new Error(`server '${name}' is command-based; OAuth applies to URL servers`);
  }
  if (server.oauthSettings === undefined || server.url === undefined) {
    throw new Error(`server '${name}' does not have OAuth enabled`);
  }
  return [server.url, server.oauthSettings];
}

async function handleMcpLogin(name: string | undefined, ctx: SlashCtx): Promise<void> {
  if (name === undefined || name === "") {
    writeError(ctx.renderer, "usage: /mcp login <server>");
    return;
  }
  try {
    resolveOauthServer(ctx, name);
  } catch (e) {
    writeError(ctx.renderer, e instanceof Error ? e.message : String(e));
    return;
  }

  throw new SlashDeferredError({ kind: "deferMcpLogin", server: name });
}

async function handleMcpLogout(name: string | undefined, ctx: SlashCtx): Promise<void> {
  if (name === undefined || name === "") {
    writeError(ctx.renderer, "usage: /mcp logout <server>");
    return;
  }
  if (ctx.mcpLogout === undefined) {
    writeError(ctx.renderer, "MCP logout not available (token store not wired)");
    return;
  }
  try {
    const removed = ctx.mcpLogout(name);
    if (removed) {
      writeOk(ctx.renderer, `removed stored OAuth token for '${name}' (effective next start)`);
    } else {
      writeOk(ctx.renderer, `no stored OAuth token for '${name}'`);
    }
  } catch (e) {
    writeError(ctx.renderer, `logout failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
