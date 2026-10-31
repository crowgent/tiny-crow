import { parseCli, mergeCliMcp } from "./cli.ts";
import { installPanicHook, init as initLogging } from "./logging.ts";
import { load } from "./config/load.ts";
import { printConfig, printSessions } from "./print.ts";
import { showGetStarted, ensureGlobal } from "./docs.ts";
import { Startup } from "./startup.ts";
import { runPituiSetupMode } from "./ui/app.ts";

export async function run(): Promise<void> {
  const cli = parseCli();
  installPanicHook();
  initLogging(cli);

  let [cfg, isFirstStartup] = load();

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
    
    const kind =
      typeof outcome === "string" ? outcome : (outcome.kind ?? outcome.outcome);
    if (kind === "quit") return;

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
      
      if (e instanceof Error && !e.message.includes("extras slice")) throw e;
    }
  }

  let setupRounds = 0;
  while (true) {
    let startup: Startup;
    try {
      startup = await Startup.init(cli, cfg, {
        isFirstStartup,
        versionChanged,
        isInteractive,
      });
    } catch (e) {
      if (isInteractive && e instanceof Error && e.message.includes("No API key found") && setupRounds < 3) {
        setupRounds++;
        const ready = await runPituiSetupMode();
        if (!ready) return;
        const reloaded = load();
        cfg = reloaded[0];
        isFirstStartup = reloaded[1];
        mergeCliMcp(cli, cfg);
        continue;
      }
      throw e;
    }

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

    try {
      await startup.initFeatures();
      await startup.resolvePrompts();
      await startup.dispatch();
      return;
    } catch (e) {
      if (isInteractive && e instanceof Error && e.message.includes("No API key found") && setupRounds < 3) {
        setupRounds++;
        const ready = await runPituiSetupMode();
        if (!ready) return;
        const reloaded = load();
        cfg = reloaded[0];
        isFirstStartup = reloaded[1];
        mergeCliMcp(cli, cfg);
        continue;
      }
      throw e;
    }
  }
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

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/main.ts") || process.argv[1].endsWith("\\main.ts"));
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
