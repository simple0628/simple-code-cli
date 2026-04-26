import fs from "fs";
import path from "path";
import os from "os";
import type { Tool } from "./index.js";

const SKILLS_DIR = path.join(os.homedir(), ".simple-code", "skills");

export const createSkillTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "create_skill",
      description: `创建一个自定义 Skill（快捷命令）。用户之后可以通过 /名称 来快速触发。\n\n参数说明：\n- name（必填）：Skill 名称\n- content（必填）：Skill 的提示词内容`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill 名称" },
          content: { type: "string", description: "Skill 的提示词内容" },
        },
        required: ["name", "content"],
      },
    },
  },
  label: (args) => `创建 Skill: ${args["name"] ?? ""}`,
  execute: async (args) => {
    const name = args["name"] as string;
    const content = args["content"] as string;
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SKILLS_DIR, `${name}.md`), content, "utf-8");
    return `Skill '${name}' 已创建，输入 /${name} 即可使用`;
  },
};
