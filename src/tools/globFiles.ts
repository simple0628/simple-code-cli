import { globSync } from "glob";
import type { Tool } from "./index.js";

export const globFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "glob_files",
      description: `按文件名模式搜索文件。\n\n参数说明：\n- pattern（必填）：glob 模式，例如 "**/*.py" 或 "src/**/*.ts"\n- path（选填）：搜索起始目录，默认当前工作目录`,
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式" },
          path: { type: "string", description: "搜索起始目录" },
        },
        required: ["pattern"],
      },
    },
  },
  label: (args) => `正在搜索文件 ${args["pattern"] ?? ""}`,
  execute: async (args) => {
    const pattern = args["pattern"] as string;
    const cwd = (args["path"] as string) || process.cwd();
    const files = globSync(pattern, { cwd, nodir: true, posix: true });
    return files.length ? files.join("\n") : "未找到匹配的文件";
  },
};
