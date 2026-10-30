// Entry point (port of src/main.rs).
// Run: node src/main.ts [OPTIONS] [MESSAGE]...
// Orchestration only: CLI parsing, logging, config load, --print-config,
// --setup, --tutor, session listing, docs versioning, then Startup phases.
// The setup wizard, hooks dispatcher and ACP server live in other slices
// and are loaded dynamically; when absent, the corresponding flag errors
// naming the missing slice instead of silently doing nothing.
import { parseCli, mergeCliMcp } from "./cli.ts";
import { installPanicHook, init as initLogging } from "./logging.ts";
import { load } from "./config/load.ts";
import { printConfig, printSessions } from "./print.ts";
import { showGetStarted, ensureGlobal } from "./docs.ts";
import { Startup } from "./startup.ts";

export async function run(): Promise<void> {
  const cli = parseCli();
  installPanicHook();
  initLogging(cli);

  const [cfg, isFirstStartup] = load();

  try {
    mergeCliMcp(cli, cfg);
  } catch (e) {
    console.error(`error: ${e}`);
    process.exit(1);
  }

  if (cli.printConfig) {
    printConfig(cli, cfg);
    return;
  }

  if (cli.setup) {
    let setupMod: Record<string, unknown>;
    try {
      setupMod = (await import("./setup/mod.ts")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`setup slice not available (./setup/mod.ts): ${e}`);
    }
    const runSetup = setupMod["run"] as
      | ((cfg: unknown) => Promise<{ kind?: string; outcome?: string } | string>)
      | undefined;
    if (!runSetup) throw new Error("setup slice does not export run");
    const outcome = await runSetup(cfg);
    // Real shape: SetupOutcome { kind: "quit" | "launch" | "launchAutoconfigure" }.
    const kind =
      typeof outcome === "string" ? outcome : (outcome.kind ?? outcome.outcome);
    if (kind === "quit") return;
    // LaunchAutoconfigure / Launch both fall through to launch.
  }

  if (cli.tutor) {
    showGetStarted();
    return;
  }

  if (cli.resume && !cli.session) {
    printSessions();
    return;
  }

  const versionChanged = ensureGlobal();
  const isInteractive = !cli.print && !cli.acpEnabled && !cli.loopMode;

  if (!cli.noHooks) {
    try {
      const extras = (await import("./extras/hooks/mod.ts")) as Record<string, unknown>;
      const initDispatcher = extras["initDispatcher"] as
        | ((dispatcher: unknown) => void)
        | undefined;
      const loadDispatcher = extras["loadDispatcherAsync"] as
        | ((noHooks: boolean, interactive: boolean) => Promise<unknown>)
        | undefined;
      if (initDispatcher && loadDispatcher) {
        initDispatcher(await loadDispatcher(cli.noHooks, !isInteractive));
      }
      if (cli.hooksTest) {
        const dryRun = extras["hooksTestDryRun"] as
          | ((tool: string, input: unknown) => Promise<string>)
          | undefined;
        if (dryRun) {
          let toolInput: unknown = {};
          if (cli.hooksTestInput) {
            try {
              toolInput = JSON.parse(cli.hooksTestInput);
            } catch {
              toolInput = null;
            }
          }
          console.log(await dryRun(cli.hooksTest, toolInput));
          return;
        }
      }
    } catch (e) {
      // Hooks are optional: a missing extras slice must not block startup.
      if (e instanceof Error && !e.message.includes("extras slice")) throw e;
    }
  }

  const startup = await Startup.init(cli, cfg, {
    isFirstStartup,
    versionChanged,
    isInteractive,
  });

  if (startup.cli.acpEnabled) {
    let extras: Record<string, unknown>;
    try {
      extras = (await import("./extras/acp/mod.ts")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`extras slice not available for ACP mode (./extras/acp/mod.ts): ${e}`);
    }
    const serve = extras["serve"] as
      | ((options: Record<string, unknown>) => Promise<void>)
      | undefined;
    if (!serve) throw new Error("extras slice does not export serve");
    await serve({
      host: startup.cli.acpHost ?? null,
      port: startup.cli.acpPort ?? null,
      provider: startup.provider,
      model: startup.model,
      apiKeys: startup.cfg.apiKeys ?? null,
      cli: startup.cli,
      cfg: startup.cfg,
    });
    return;
  }

  await startup.initFeatures();
  await startup.resolvePrompts();
  await startup.dispatch();
}

export async function main(): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(
      "This error might derive from an incomplete configuration: " +
        "run `tiny-crow --setup` to configure your providers and models " +
        "interactively, or `tiny-crow --tutor` to see the getting started guide",
    );
    throw e;
  }
}

// Execute only when run directly (not when imported by the test slice).
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/main.ts") || process.argv[1].endsWith("\\main.ts"));
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
