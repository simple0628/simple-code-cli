import fs from "fs";
import path from "path";
import type { Tool } from "./index.js";

export const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: `读取指定路径的文件内容。如果路径是文件夹则列出目录内容。\n\n参数说明：\n- path（必填）：要读取的文件或文件夹的完整路径\n\n返回值：文件的完整文本内容，或文件夹内的文件列表`,
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "文件或文件夹的完整路径" } },
        required: ["path"],
      },
    },
  },
  label: (args) => `正在读取 ${args["path"] ?? ""}`,
  execute: async (args) => {
    const p = args["path"] as string;
    if (fs.statSync(p).isDirectory()) {
      const items = fs.readdirSync(p);
      return items.length ? items.join("\n") : "(空文件夹)";
    }
    return fs.readFileSync(p, "utf-8");
  },
};
