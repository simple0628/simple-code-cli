/**
 * 配置管理：API Key 的加载、保存、首次引导、Skill 管理
 */

import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import OpenAI from "openai";
import chalk from "chalk";

const CONFIG_DIR = path.join(os.homedir(), ".simple-code");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const SKILLS_DIR = path.join(CONFIG_DIR, "skills");

interface Config {
  api_key?: string;
}

const DISCLAIMER = `
${chalk.bold.white("欢迎使用 simple")}

在开始之前，请仔细阅读以下免责声明：

${chalk.yellow("1. AI 生成内容的局限性")}
   simple 由大语言模型驱动，AI 可能会生成错误的、不完整的、
   或具有误导性的代码和建议。你不应将其输出视为专业建议。

${chalk.yellow("2. 文件操作风险")}
   simple 具有读取、创建、修改和删除文件的能力，也可以执行终端命令。
   这些操作可能导致数据丢失或系统损坏。请确保重要文件已备份。

${chalk.yellow("3. 命令执行风险")}
   虽然危险命令会在执行前要求确认，但 AI 仍可能通过间接方式
   执行你意料之外的操作。你有责任审查 AI 建议的每一条命令。

${chalk.yellow("4. 数据隐私")}
   你的对话内容、文件内容和命令输出会被发送到 DeepSeek API 进行处理。
   请勿输入密码、密钥、个人身份信息等敏感数据。simple 的开发者
   不对第三方 API 的数据处理方式承担责任。

${chalk.yellow("5. 免责条款")}
   simple 按"原样"提供，不附带任何明示或暗示的保证，包括但不限于
   对适销性、特定用途适用性和非侵权性的保证。在任何情况下，
   simple 的开发者均不对因使用或无法使用本工具而产生的任何直接、
   间接、附带、特殊或后果性损害承担责任。

${chalk.yellow("6. 用户责任")}
   使用 simple 即表示你理解并接受上述风险。你有责任审查 AI 的
   所有输出，并对采纳其建议后产生的任何后果自行承担全部责任。

${chalk.dim("按回车键表示你已阅读、理解并同意以上全部内容...")}`;

function ask(question: string, mask = false): Promise<string> {
  if (!mask) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    let buf = "";
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (data: Buffer) => {
      const chunk = data.toString("utf8");
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.removeListener("data", onData);
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(buf.trim());
          return;
        } else if (ch === "\u007f" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (ch === "\u0003") {
          process.exit(0);
        } else {
          buf += ch;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

function waitEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

export function loadConfig(): Config {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Config;
  }
  return {};
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
    await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
    return true;
  } catch {
    return false;
  }
}

async function inputAndVerifyKey(prompt = "  请输入你的 API Key: "): Promise<string> {
  while (true) {
    const apiKey = await ask(prompt, true);
    if (!apiKey) {
      console.log(chalk.red("  API Key 不能为空，请重新输入"));
      continue;
    }
    process.stdout.write(chalk.dim("  正在验证..."));
    if (await testApiKey(apiKey)) {
      process.stdout.write(`\r${chalk.green("  验证通过！  ")}\n`);
      return apiKey;
    } else {
      process.stdout.write(`\r${chalk.red("  验证失败，请检查 API Key 是否正确")}\n`);
    }
  }
}

export async function firstRunSetup(): Promise<string> {
  console.log(DISCLAIMER);
  await waitEnter();

  console.log(chalk.bold.white("配置 DeepSeek API Key"));
  console.log(chalk.dim("你可以在 https://platform.deepseek.com/api_keys 获取 API Key"));
  console.log();

  const apiKey = await inputAndVerifyKey();
  saveConfig({ api_key: apiKey });
  console.log();
  return apiKey;
}

export async function resetConfig(): Promise<void> {
  console.log(chalk.yellow("重新配置 API Key"));
  console.log(chalk.dim("你可以在 https://platform.deepseek.com/api_keys 获取 API Key"));
  console.log();

  const apiKey = await inputAndVerifyKey("  请输入新的 API Key: ");
  saveConfig({ api_key: apiKey });
  console.log();
}

export async function getApiKey(): Promise<string> {
  const config = loadConfig();
  if (config.api_key) return config.api_key;
  return firstRunSetup();
}

export function loadSkills(): Record<string, string> {
  const skills: Record<string, string> = {};
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (!fs.existsSync(SKILLS_DIR)) return skills;
  for (const filename of fs.readdirSync(SKILLS_DIR)) {
    if (filename.endsWith(".md")) {
      const name = filename.slice(0, -3);
      skills[name] = fs.readFileSync(path.join(SKILLS_DIR, filename), "utf-8").trim();
    }
  }
  return skills;
}
