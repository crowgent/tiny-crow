// Hook handler configuration parsed from settings.json.

export interface HookHandler {
  /** Handler kind; only "command" is supported in v1. */
  type: string;
  command?: string;
  args?: string[];
  /** Per-hook timeout in seconds. */
  timeout?: number;
  /** Async handlers run in the background and their decision is ignored. */
  async?: boolean;
  /** Shell condition: only run the handler when it exits 0. */
  if?: string;
  /** Run at most once per (event, command) pair. */
  once?: boolean;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}

/** Event name -> matcher groups, in declared order. */
export type HooksConfig = Record<string, HookGroup[]>;

/**
 * Parse the JSON value found at the top-level `hooks` key of settings.json.
 * Throws when a handler uses an unsupported type.
 */
export function parseHooksConfig(value: unknown): HooksConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid hooks config: expected an object");
  }
  const config: HooksConfig = {};
  for (const [event, groupsRaw] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(groupsRaw)) {
      throw new Error(`invalid hooks config: event ${JSON.stringify(event)} is not an array`);
    }
    const groups: HookGroup[] = groupsRaw.map((g) => {
      const group = g as Record<string, unknown>;
      const hooksRaw = Array.isArray(group.hooks) ? group.hooks : [];
      const hooks: HookHandler[] = hooksRaw.map((h) => {
        const handler = h as Record<string, unknown>;
        return {
          type: typeof handler.type === "string" ? handler.type : "",
          command: typeof handler.command === "string" ? handler.command : undefined,
          args: Array.isArray(handler.args)
            ? handler.args.filter((a): a is string => typeof a === "string")
            : undefined,
          timeout: typeof handler.timeout === "number" ? handler.timeout : undefined,
          async: handler.async === true,
          if: typeof handler.if === "string" ? handler.if : undefined,
          once: handler.once === true,
        };
      });
      return {
        matcher: typeof group.matcher === "string" ? group.matcher : undefined,
        hooks,
      };
    });
    config[event] = groups;
  }
  for (const [event, groups] of Object.entries(config)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        if (handler.type !== "command") {
          throw new Error(
            `unsupported hook type ${JSON.stringify(handler.type)} for event ${JSON.stringify(event)} (only "command" is supported in v1)`,
          );
        }
      }
    }
  }
  return config;
}
