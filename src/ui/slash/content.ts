import {
  applyPromptMode,
  cliResolveModel,
  cliResolveProvider,
  writeError,
  writeOk,
  writeResult,
  type PromptModeOutcome,
  type SlashCtx,
} from "./mod.ts";

export type { PromptModeOutcome };

export function parseColor(s: string): string | undefined {
  const v = s.trim().toLowerCase();
  if (v === "") return undefined;
  const names = new Set([
    "reset", "black", "dark_grey", "darkgrey", "dark_gray", "darkgray",
    "red", "dark_red", "darkred", "green", "dark_green", "darkgreen",
    "yellow", "dark_yellow", "darkyellow", "blue", "dark_blue", "darkblue",
    "magenta", "dark_magenta", "darkmagenta", "cyan", "dark_cyan", "darkcyan",
    "white", "grey", "gray", "dark_grey",
  ]);
  if (names.has(v)) return v;
  if (/^#[0-9a-f]{6}$/.test(v) || /^#[0-9a-f]{3}$/.test(v)) return v;
  return undefined;
}

export async function handle(parts: string[], ctx: SlashCtx): Promise<void> {
  switch (parts[0]) {
    case "/prompt":
      await handlePrompt(parts, ctx);
      break;
    case "/theme":
      await handleTheme(parts, ctx);
      break;
    case "/regen-prompts":
      await handleRegenPrompts(ctx);
      break;
    case "/regen-themes":
      await handleRegenThemes(ctx);
      break;
    default:
      break;
  }
}

async function handlePrompt(parts: string[], ctx: SlashCtx): Promise<void> {
  const sorted = [...ctx.context.prompts.keys()].sort();
  if (parts.length < 2) {
    if (sorted.length === 0) {
      writeOk(ctx.renderer, "no prompts available");
    } else {
      const current = ctx.context.currentPromptName ?? "(none)";
      writeOk(ctx.renderer, `available prompts (current: ${current}):`);
      for (const name of sorted) {
        writeResult(ctx.renderer, `  ${name}`);
      }
      writeResult(ctx.renderer, "usage: /prompt <name>  |  /prompt default");
    }
  } else if (parts[1] === "default") {
    if (ctx.context.currentPrompt === undefined) {
      writeOk(ctx.renderer, "no active prompt to clear");
    } else {
      ctx.context.currentPrompt = undefined;
      ctx.context.currentPromptName = undefined;
      ctx.session.prompt = undefined;
      const defaultModel = cliResolveModel(ctx.cli, ctx.cfg);
      const defaultProvider = cliResolveProvider(ctx.cli, ctx.cfg);
      if (defaultModel !== undefined) ctx.session.model = defaultModel;
      if (defaultProvider !== undefined) {
        const providerChanged = defaultProvider !== ctx.session.provider;
        if (providerChanged) {
          try {
            await ctx.rebuildAgentWithClient(defaultProvider, ctx.reasoningEnabled);
            ctx.session.provider = defaultProvider;
          } catch (e) {
            writeError(
              ctx.renderer,
              `failed to revert provider: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          await ctx.rebuildAgent();
        }
      } else {
        await ctx.rebuildAgent();
      }
      writeOk(ctx.renderer, "prompt cleared (back to default)");
    }
  } else {
    const name = parts[1].trim();
    if (ctx.context.prompts.has(name)) {
      const outcome = applyPromptMode(
        name,
        ctx.context,
        ctx.session,
        ctx.permission,
        ctx.promptSource,
      );
      if (outcome.kind === "restoredUserMode") {
        if (ctx.permission !== undefined) {
          writeOk(ctx.renderer, `restored user mode: ${ctx.permission.mode()}`);
        }
      } else if (outcome.kind === "applied") {
        writeOk(ctx.renderer, `security mode: ${outcome.mode} (from prompt)`);
      }
      const modelSwitched = await ctx.switchToPromptModel(name);
      if (!modelSwitched) await ctx.rebuildAgent();
      writeOk(ctx.renderer, `active prompt: ${name}`);
    } else {
      writeError(ctx.renderer, `unknown prompt: '${name}'`);
      if (sorted.length > 0) {
        writeOk(ctx.renderer, "available prompts:");
        for (const p of sorted) {
          writeResult(ctx.renderer, `  ${p}`);
        }
      }
    }
  }
}

async function handleTheme(parts: string[], ctx: SlashCtx): Promise<void> {
  const sorted = [...ctx.context.themes.keys()].sort();
  if (parts.length < 2) {
    if (sorted.length === 0) {
      writeOk(ctx.renderer, "no themes available");
    } else {
      const current = ctx.context.currentThemeName ?? "(none)";
      writeOk(ctx.renderer, `available themes (current: ${current}):`);
      for (const name of sorted) {
        writeResult(ctx.renderer, `  ${name}`);
      }
      writeResult(ctx.renderer, "usage: /theme <name>  |  /theme default");
    }
  } else if (parts[1] === "default") {
    if (ctx.context.currentThemeName === undefined) {
      writeOk(ctx.renderer, "no active theme to clear");
    } else {
      ctx.context.currentThemeName = undefined;
      try {
        if (ctx.saveThemeName !== undefined) ctx.saveThemeName(undefined);
        else ctx.sessionStore?.saveThemeName(undefined);
      } catch (e) {
        writeError(
          ctx.renderer,
          `warning: theme choice not saved: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (ctx.cfg.colors !== undefined) {
        const chatBg = ctx.cfg.colors.chatBackground !== undefined
          ? parseColor(ctx.cfg.colors.chatBackground)
          : undefined;
        const inputBg = ctx.cfg.colors.inputBackground !== undefined
          ? parseColor(ctx.cfg.colors.inputBackground)
          : undefined;
        const statusBg = ctx.cfg.colors.statusBackground !== undefined
          ? parseColor(ctx.cfg.colors.statusBackground)
          : undefined;
        ctx.renderer.setBackgroundColors(chatBg, inputBg, statusBg);
      }
      writeOk(ctx.renderer, "theme cleared (using config colors)");
    }
  } else {
    const name = parts[1].trim();
    const content = ctx.context.themes.get(name);
    if (content !== undefined) {
      ctx.context.currentThemeName = name;
      try {
        if (ctx.saveThemeName !== undefined) ctx.saveThemeName(name);
        else ctx.sessionStore?.saveThemeName(name);
      } catch (e) {
        writeError(
          ctx.renderer,
          `warning: theme choice not saved: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (ctx.applyTheme !== undefined) ctx.applyTheme(content, ctx.renderer);
      writeOk(ctx.renderer, `active theme: ${name}`);
    } else {
      writeError(ctx.renderer, `unknown theme: '${name}'`);
      if (sorted.length > 0) {
        writeOk(ctx.renderer, "available themes:");
        for (const t of sorted) {
          writeResult(ctx.renderer, `  ${t}`);
        }
      }
    }
  }
}

async function handleRegenPrompts(ctx: SlashCtx): Promise<void> {
  try {
    if (ctx.regenPrompts !== undefined) ctx.regenPrompts();
    else throw new Error("prompt regeneration not wired");
    if (ctx.loadPrompts !== undefined) {
      ctx.context.prompts = ctx.loadPrompts(ctx.context.extraPromptsDirs);
    }
    writeOk(ctx.renderer, "default prompts regenerated");
  } catch (e) {
    writeError(
      ctx.renderer,
      `failed to regenerate prompts: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function handleRegenThemes(ctx: SlashCtx): Promise<void> {
  try {
    if (ctx.regenThemes !== undefined) ctx.regenThemes();
    else throw new Error("theme regeneration not wired");
    if (ctx.loadThemes !== undefined) {
      ctx.context.themes = ctx.loadThemes();
    }
    writeOk(ctx.renderer, "default themes regenerated");
  } catch (e) {
    writeError(
      ctx.renderer,
      `failed to regenerate themes: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
