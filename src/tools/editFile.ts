import fs from "fs";
import chalk from "chalk";
import type { Tool } from "./index.js";

export const editFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description: `编辑已有文件，将文件中的一段内容精确替换为新内容。\n\n参数说明：\n- path（必填）：文件的完整路径\n- old_string（必填）：要被替换的原始内容，必须完全匹配\n- new_string（必填）：替换后的新内容\n\n注意：old_string 必须在文件中唯一匹配`,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件的完整路径" },
          old_string: { type: "string", description: "要被替换的原始内容" },
          new_string: { type: "string", description: "替换后的新内容" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  needsPause: true,
  label: (args) => `正在编辑 ${args["path"] ?? ""}`,
  execute: async (args) => {
    const p = args["path"] as string;
    const oldStr = args["old_string"] as string;
    const newStr = args["new_string"] as string;
    const content = fs.readFileSync(p, "utf-8");

    if (!content.includes(oldStr)) {
      return "错误: 未找到要替换的内容";
    }

    const count = content.split(oldStr).length - 1;
    if (count > 1) {
      return "错误: 找到多处匹配，请提供更精确的内容以确保唯一匹配";
    }

    const updated = content.replace(oldStr, newStr);
    fs.writeFileSync(p, updated, "utf-8");

    // 显示 diff（红绿背景）
    for (const line of oldStr.split("\n")) {
      console.log(chalk.bgRed.white(`  - ${line}`));
    }
    for (const line of newStr.split("\n")) {
      console.log(chalk.bgGreen.white(`  + ${line}`));
    }

    return `文件已编辑: ${p}`;
  },
};
