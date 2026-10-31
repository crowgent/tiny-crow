import type {
  AskSenderLike,
  PermCheckLike,
  Tool,
} from "./mod.ts";
import {
  checkPerm,
} from "./mod.ts";

export interface TodoItem {
  content: string;
  status: string;
  priority: string;
}

export interface TodoWriteArgs {
  todos: TodoItem[];
}

export const TODO_LIST: TodoItem[] = [];

export function getTodoList(): TodoItem[] {
  return TODO_LIST;
}

export class WriteTodoList implements Tool<TodoWriteArgs, string> {
  static readonly NAME = "todo_write";
  readonly name = "todo_write";
  permission: PermCheckLike | undefined | null;
  askTx: AskSenderLike | undefined | null;

  constructor(permission?: PermCheckLike | null, askTx?: AskSenderLike | null) {
    this.permission = permission ?? null;
    this.askTx = askTx ?? null;
  }

  description(): string {
    return "Create or update a structured task list to track progress in the current coding session. Use this for complex multi-step tasks. Replaces any existing todo list.";
  }

  parameters(): Record<string, unknown> {
    return {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "Task description" },
              status: { type: "string", description: "pending, in_progress, completed, or cancelled" },
              priority: { type: "string", description: "high, medium, or low" },
            },
            required: ["content", "status", "priority"],
          },
          description: "Full list of tasks to track",
        },
      },
      required: ["todos"],
    };
  }

  async call(args: TodoWriteArgs): Promise<string> {
    const coaching = await checkPerm(this.permission, this.askTx, "todo_write", "");
    TODO_LIST.splice(0, TODO_LIST.length, ...args.todos);
    if (TODO_LIST.length === 0) {
      const msg = "Todo list cleared.";
      return coaching ? `${coaching}\n\n${msg}` : msg;
    }
    const total = TODO_LIST.length;
    const completed = TODO_LIST.filter((t) => t.status === "completed").length;
    const inProgress = TODO_LIST.filter((t) => t.status === "in_progress").length;
    const pending = TODO_LIST.filter((t) => t.status === "pending").length;
    const cancelled = TODO_LIST.filter((t) => t.status === "cancelled").length;
    let result = `Todo list (${total} items, ${completed} done):\n`;
    for (const item of TODO_LIST) {
      const icon =
        item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[>]" : item.status === "cancelled" ? "[-]" : "[ ]";
      result += `  ${icon} [${item.priority}] ${item.content}\n`;
    }
    result += `\nSummary: ${pending} pending, ${inProgress} in progress, ${completed} completed, ${cancelled} cancelled`;
    return coaching ? `${coaching}\n\n${result}` : result;
  }
}
