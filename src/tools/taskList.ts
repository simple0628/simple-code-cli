import type { Tool } from "./index.js";

interface Task {
  text: string;
  done: boolean;
}

const tasks: Task[] = [];

function formatTasks(): string {
  if (!tasks.length) return "（暂无任务）";
  const doneCount = tasks.filter((t) => t.done).length;
  const lines = [`进度: ${doneCount}/${tasks.length}`, ""];
  tasks.forEach((t, i) => {
    const mark = t.done ? "✅" : "⬜";
    lines.push(`  ${mark} ${i + 1}. ${t.text}`);
  });
  return lines.join("\n");
}

export const taskListTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "task_list",
      description: `管理任务清单，用于把复杂任务拆分成步骤并跟踪进度。\n\n参数说明：\n- action（必填）：create（创建）、done（标记完成）、list（查看）\n- tasks（create时必填）：任务列表\n- index（done时必填）：任务编号，从1开始`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "done", "list"], description: "操作类型" },
          tasks: { type: "array", items: { type: "string" }, description: "任务列表" },
          index: { type: "integer", description: "任务编号" },
        },
        required: ["action"],
      },
    },
  },
  label: (args) => {
    const action = args["action"] as string;
    if (action === "create") return `创建任务清单（${(args["tasks"] as string[])?.length ?? 0}项）`;
    if (action === "done") return `完成任务 #${args["index"] ?? "?"}`;
    return "查看任务清单";
  },
  execute: async (args) => {
    const action = args["action"] as string;

    if (action === "create") {
      const items = args["tasks"] as string[] | undefined;
      if (!items?.length) return "错误: 请提供 tasks 参数";
      tasks.length = 0;
      items.forEach((text) => tasks.push({ text, done: false }));
      return formatTasks();
    }

    if (action === "done") {
      const index = args["index"] as number;
      if (index < 1 || index > tasks.length) return `错误: 编号 ${index} 不存在`;
      tasks[index - 1]!.done = true;
      return formatTasks();
    }

    return formatTasks();
  },
};
