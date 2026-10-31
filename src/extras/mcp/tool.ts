import { McpClientHandle, McpServiceError, type McpContentBlock, type McpToolDefinition } from "./client.ts";

export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

function toolErr(message: string): ToolExecutionError {
  return new ToolExecutionError(message);
}

export type ToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

export type ToolOutput =
  | { kind: "text"; text: string }
  | { kind: "content"; blocks: ToolResultBlock[] };

export function textOutput(text: string): ToolOutput {
  return { kind: "text", text };
}

export function contentOutput(blocks: ToolResultBlock[]): ToolOutput {
  return { kind: "content", blocks };
}

export interface ToolContext {
  [key: string]: unknown;
}

export type PermCheckLike =
  | ((tool: string, inputKey: string) => Promise<"allowed" | { coaching: string } | { denied: string }>)
  | { check: (tool: string, inputKey: string) => Promise<"allowed" | { coaching: string } | { denied: string }> };

export type AskSenderLike = (request: { tool: string; input: string }) => Promise<"allowOnce" | "allowAlways" | "deny">;

export async function checkPermLocal(
  permission: PermCheckLike | undefined | null,
  _askTx: AskSenderLike | undefined | null,
  tool: string,
  inputKey: string,
): Promise<string | null> {
  if (!permission) return null;
  const result =
    typeof permission === "function" ? await permission(tool, inputKey) : await permission.check(tool, inputKey);
  if (result === "allowed") return null;
  if ("coaching" in result) return result.coaching;
  throw new Error(`Permission denied: ${result.denied}`);
}

export interface HandleRef {
  getHandle(): McpClientHandle;
  reconnect(): Promise<McpClientHandle>;
}

export interface DynamicTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (args: Record<string, unknown>, context?: ToolContext) => Promise<ToolOutput>;
}

export function callErrorMessage(serverName: string, toolName: string, e: Error): string {
  if (e instanceof McpServiceError && e.kind === "timeout") {
    return `MCP tool '${toolName}' on server '${serverName}' timed out after ${Math.round((e.timeoutMs ?? 0) / 1000)}s`;
  }
  return `MCP tool error: ${e.message}`;
}

export function renderResult(texts: string[], images: Array<[string, string]>): ToolOutput {
  if (images.length === 0) {
    return textOutput(texts.join("\n"));
  }
  const blocks: ToolResultBlock[] = [];
  const response = texts.join("\n\n");
  if (response.length > 0) blocks.push({ type: "text", text: response });
  for (const [mimeType, data] of images) {
    if (mimeType.startsWith("image/")) {
      blocks.push({ type: "image", mimeType, data });
    } else {
      blocks.push({ type: "text", text: `[unsupported image mime type ${mimeType} dropped]` });
    }
  }
  return contentOutput(blocks);
}

export function blocksToParts(result: { content: McpContentBlock[] }): {
  texts: string[];
  images: Array<[string, string]>;
} {
  const texts: string[] = [];
  const images: Array<[string, string]> = [];
  for (const item of result.content) {
    if (item.type === "text") {
      texts.push(item.text);
    } else if (item.type === "image") {
      images.push([item.mimeType, item.data]);
    } else if (item.type === "resource") {
      if (item.text != null) {
        texts.push(item.text);
      } else if (item.blob != null) {
        if (item.mimeType && item.mimeType.startsWith("image/")) {
          images.push([item.mimeType, item.blob]);
        } else {
          texts.push(item.blob);
        }
      }
    }
  }
  return { texts, images };
}

export function mcpDynamicTool(
  serverName: string,
  definition: McpToolDefinition,
  handleRef: HandleRef,
  permission?: PermCheckLike | null,
  askTx?: AskSenderLike | null,
): DynamicTool {
  const toolName = definition.name;
  const description = definition.description ?? "";
  const parameters = definition.inputSchema;
  return {
    name: toolName,
    description,
    parameters,
    call: async (args: Record<string, unknown>): Promise<ToolOutput> => {
      const permKey = `mcp_tool:${serverName}:${toolName}`;
      let coaching: string | null;
      try {
        coaching = await checkPermLocal(permission ?? null, askTx ?? null, "mcp_tool", permKey);
      } catch (e) {
        throw toolErr(e instanceof Error ? e.message : String(e));
      }

      const callOnce = async (handle: McpClientHandle) => handle.callTool(toolName, args);
      let result: Awaited<ReturnType<typeof callOnce>>;
      try {
        result = await callOnce(handleRef.getHandle());
      } catch (e) {

        if (e instanceof McpServiceError && e.kind === "transportClosed") {
          let fresh: McpClientHandle;
          try {
            fresh = await handleRef.reconnect();
          } catch (reconnectError) {
            throw toolErr(
              `MCP server '${serverName}' transport closed and reconnect failed: ${reconnectError instanceof Error ? reconnectError.message : String(reconnectError)}`,
            );
          }
          try {
            result = await callOnce(fresh);
          } catch (retryError) {
            throw toolErr(callErrorMessage(serverName, toolName, retryError instanceof Error ? retryError : new Error(String(retryError))));
          }
        } else {
          throw toolErr(callErrorMessage(serverName, toolName, e instanceof Error ? e : new Error(String(e))));
        }
      }

      if (result.isError) {
        const errorMsg = result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        throw toolErr(errorMsg.length > 0 ? errorMsg : "MCP tool returned an error");
      }

      const { texts, images } = blocksToParts(result);
      if (coaching) texts.unshift(coaching);
      return renderResult(texts, images);
    },
  };
}
