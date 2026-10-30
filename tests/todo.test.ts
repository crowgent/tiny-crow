import test from "node:test";
import assert from "node:assert/strict";
import { TODO_LIST, WriteTodoList } from "../src/agent/tools/todo.ts";

function resetTodoList(): void {
  TODO_LIST.length = 0;
}

test("definition_name", () => {
  assert.equal(WriteTodoList.NAME, "todo_write");
});

test("definition_description_non_empty", () => {
  const tool = new WriteTodoList();
  assert.ok(tool.description().length > 0);
});

test("definition_parameters_has_required_fields", () => {
  const tool = new WriteTodoList();
  const params = tool.parameters() as Record<string, unknown>;
  assert.ok("properties" in params);
  const props = params["properties"] as Record<string, unknown>;
  assert.ok("todos" in props);
});

test("call_with_empty_todos", async () => {
  resetTodoList();
  const tool = new WriteTodoList();
  const output = await tool.call({ todos: [] });
  assert.ok(output.includes("cleared"), `got: ${output}`);
});

test("call_formats_todo_items_with_icons", async () => {
  resetTodoList();
  const tool = new WriteTodoList();
  const output = await tool.call({
    todos: [
      { content: "High priority task", status: "high", priority: "high" },
      { content: "Completed task", status: "completed", priority: "medium" },
      { content: "In progress task", status: "in_progress", priority: "medium" },
      { content: "Cancelled task", status: "cancelled", priority: "low" },
      { content: "Low priority task", status: "low", priority: "low" },
    ],
  });
  assert.ok(output.includes("[x]"));
  assert.ok(output.includes("[>]"));
  assert.ok(output.includes("[-]"));
  assert.ok(output.includes("[ ]"));
  assert.ok(output.includes("High priority task"));
  assert.ok(output.includes("Completed task"));
  assert.ok(output.includes("In progress task"));
  assert.ok(output.includes("Cancelled task"));
  assert.ok(output.includes("Low priority task"));
  assert.ok(output.includes("5 items"));
});

test("call_updates_global_todo_list", async () => {
  resetTodoList();
  const tool = new WriteTodoList();
  await tool.call({
    todos: [
      { content: "Task 1", status: "pending", priority: "high" },
      { content: "Task 2", status: "pending", priority: "medium" },
    ],
  });
  assert.equal(TODO_LIST.length, 2);
  assert.equal(TODO_LIST[0]!.content, "Task 1");
  assert.equal(TODO_LIST[1]!.content, "Task 2");
});

test("call_overwrites_previous_list", async () => {
  resetTodoList();
  const tool = new WriteTodoList();
  await tool.call({ todos: [{ content: "First", status: "pending", priority: "high" }] });
  await tool.call({ todos: [{ content: "Second", status: "completed", priority: "low" }] });
  assert.equal(TODO_LIST.length, 1);
  assert.equal(TODO_LIST[0]!.content, "Second");
});
