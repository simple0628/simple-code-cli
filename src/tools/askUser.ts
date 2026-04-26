import readline from "readline";
import chalk from "chalk";
import type { Tool } from "./index.js";

export const askUserTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "ask_user",
      description: `向用户提问，等待用户回答后继续执行。\n\n使用场景：需求不明确需要澄清、有多种方案需要用户选择、操作有风险需要确认。\n\n参数说明：\n- question（必填）：要问用户的问题`,
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "要问用户的问题" },
        },
        required: ["question"],
      },
    },
  },
  needsPause: true,
  label: (args) => {
    const q = (args["question"] as string) || "";
    return `等待用户回答: ${q.length > 40 ? q.slice(0, 40) + "..." : q}`;
  },
  execute: async (args) => {
    const question = args["question"] as string;
    console.log(`\n${chalk.bold.yellow("🤖 AI 提问：")} ${question}`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question("  > ", (answer) => {
        rl.close();
        console.log();
        resolve(answer.trim() || "(用户未输入内容)");
      });
    });
  },
};
