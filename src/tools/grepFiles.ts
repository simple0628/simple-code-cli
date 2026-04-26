import fs from "fs";
import path from "path";
import { globSync } from "glob";
import type { Tool } from "./index.js";

export const grepFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "grep_files",
      description: `在文件内容中搜索关键词，返回匹配的文件和行。\n\n参数说明：\n- keyword（必填）：搜索关键词\n- pattern（选填）：文件名 glob 模式，默认 "**/*"\n- path（选填）：搜索起始目录，默认当前工作目录`,
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "搜索关键词" },
          pattern: { type: "string", description: "文件名 glob 模式" },
          path: { type: "string", description: "搜索起始目录" },
        },
        required: ["keyword"],
      },
    },
  },
  label: (args) => `正在搜索 "${args["keyword"] ?? ""}"`,
  execute: async (args) => {
    const keyword = args["keyword"] as string;
    const filePattern = (args["pattern"] as string) || "**/*";
    const cwd = (args["path"] as string) || process.cwd();
    const files = globSync(filePattern, { cwd, nodir: true, posix: true });

    const results: string[] = [];
    for (const file of files.slice(0, 100)) {
      try {
        const fullPath = path.join(cwd, file);
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes(keyword)) {
            results.push(`${file}:${i + 1}: ${lines[i]!.trim()}`);
          }
        }
      } catch { /* skip binary/unreadable files */ }
    }

    return results.length ? results.slice(0, 50).join("\n") : `未找到包含 "${keyword}" 的内容`;
  },
};
