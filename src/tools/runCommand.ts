import { spawn } from "child_process";
import readline from "readline";
import chalk from "chalk";
import { isInterrupted } from "../state.js";
import type { Tool } from "./index.js";

const DANGEROUS_PATTERNS = [
  /\brm\b/i, /\brmdir\b/i, /\bdel\b/i, /\brd\b/i,
  /\bformat\b/i, /\bdrop\b/i, /\btruncate\b/i,
  /--force/i, /\s-rf\b/i, /\s\/s\b/i, /\s\/q\b/i,
  /\bsudo\b/i, /\bchmod\b/i, /\bmkfs\b/i, /\bdd\b/i,
  /\bkill\b.*-9/i, /\bkillall\b/i,
];

const TIMEOUT = 30_000; // 30秒

export function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

function askConfirm(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(chalk.bold.red(`  ⚠ 即将执行: ${command}`));
    console.log(chalk.bold.red(`  ⚠ 确认执行吗？按回车继续，输入其他内容取消`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("  ", (answer) => {
      rl.close();
      resolve(answer.trim() === "");
    });
  });
}

export const runCommandTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "run_command",
      description: `在终端执行一条命令并返回输出结果。\n\n参数说明：\n- command（必填）：要执行的完整命令\n\n限制：\n- 命令必须在 30 秒内完成，超时会被终止\n- 不能运行需要用户交互输入的程序`,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的完整命令" },
        },
        required: ["command"],
      },
    },
  },
  label: (args) => `正在执行 ${args["command"] ?? ""}`,
  execute: async (args) => {
    const command = args["command"] as string;

    if (isDangerous(command)) {
      const confirmed = await askConfirm(command);
      if (!confirmed) return "用户取消了操作";
    }

    return new Promise((resolve) => {
      const isWin = process.platform === "win32";
      const shell = isWin ? "cmd.exe" : "/bin/sh";
      const shellArgs = isWin ? ["/c", `chcp 65001 >nul && ${command}`] : ["-c", command];

      const proc = spawn(shell, shellArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString("utf-8"); });
      proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString("utf-8"); });

      const timer = setTimeout(() => {
        proc.kill();
        resolve(`错误: 命令执行超时（30秒）`);
      }, TIMEOUT);

      // 检查 ESC 中断
      const check = setInterval(() => {
        if (isInterrupted()) {
          proc.kill();
          clearTimeout(timer);
          clearInterval(check);
          resolve("已中断：用户按下 ESC");
        }
      }, 500);

      proc.on("close", () => {
        clearTimeout(timer);
        clearInterval(check);
        const output = stdout + stderr;
        resolve(output.trim() || "(无输出)");
      });
    });
  },
};
