import fs from "fs";
import path from "path";
import chalk from "chalk";
import type { Tool } from "./index.js";

const LANG_MAP: Record<string, string> = {
  py: "python", js: "javascript", ts: "typescript",
  html: "html", css: "css", json: "json", md: "markdown",
};

export const writeFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description: `创建新文件或覆盖已有文件。仅用于创建新文件，修改已有文件请用 edit_file。\n\n参数说明：\n- path（必填）：文件的完整路径\n- content（必填）：要写入的完整文件内容\n\n注意：会自动创建不存在的父目录`,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件的完整路径" },
          content: { type: "string", description: "要写入的完整文件内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  needsPause: true,
  label: (args) => `正在写入 ${args["path"] ?? ""}`,
  execute: async (args) => {
    const p = args["path"] as string;
    const content = args["content"] as string;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf-8");

    // 显示写入内容（带行号）
    const lines = content.split("\n");
    const pad = String(lines.length).length;
    lines.forEach((line, i) => {
      const num = chalk.dim(String(i + 1).padStart(pad));
      console.log(`  ${num} │ ${line}`);
    });

    return `文件已写入: ${p}`;
  },
};
