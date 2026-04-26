#!/usr/bin/env node

/**
 * simple 入口：启动界面、输入处理、主循环
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import OpenAI from "openai";
import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

import { getApiKey, resetConfig, loadSkills, SKILLS_DIR } from "./config.js";
import { buildSystemPrompt, chatRound, saveMemory } from "./chat.js";
import { resetInterrupt, triggerInterrupt, getSignal } from "./state.js";

const VERSION = "0.1.7";

// Markdown 终端渲染
marked.use(markedTerminal() as Parameters<typeof marked.use>[0]);

// ==================== 状态面板 ====================

let panelTimer: ReturnType<typeof setInterval> | null = null;
let panelStartTime = 0;
let panelToolLines: string[] = [];
let tokenCounter = { total: 0, round: 0 };
let lastRenderedLines = 0;
let panelActive = false;

function renderPanel(): void {
  if (!panelActive) return;

  const elapsed = Math.floor((Date.now() - panelStartTime) / 1000);
  const roundK = (tokenCounter.round / 1000).toFixed(1);
  const totalK = (tokenCounter.total / 1000).toFixed(1);

  const lines: string[] = [];
  lines.push(chalk.bold.green(`  思考中... ${elapsed}秒 | 本轮: ${roundK}k | 累计: ${totalK}k | ESC 中断`));

  const maxVisible = 3;
  const total = panelToolLines.length;
  if (total > maxVisible) {
    const hidden = total - maxVisible;
    lines.push(chalk.dim(`  ... 已执行 ${hidden} 个操作`));
    const visible = panelToolLines.slice(-maxVisible);
    visible.forEach((l, i) => {
      // 最后一行（当前任务）高亮显示
      if (i === visible.length - 1) {
        lines.push(chalk.white(`  › ${l}`));
      } else {
        lines.push(chalk.dim(`  › ${l}`));
      }
    });
  } else {
    panelToolLines.forEach((l, i) => {
      if (i === panelToolLines.length - 1 && panelToolLines.length > 0) {
        lines.push(chalk.white(`  › ${l}`));
      } else {
        lines.push(chalk.dim(`  › ${l}`));
      }
    });
  }

  // 先回到面板起始位置
  if (lastRenderedLines > 0) {
    process.stdout.write(`\x1b[${lastRenderedLines}A`);
  }

  // 逐行覆盖写入，清除行尾残留
  for (const line of lines) {
    process.stdout.write(`\r\x1b[2K${line}\n`);
  }

  // 如果新内容比旧内容少，清掉多余的旧行
  for (let i = lines.length; i < lastRenderedLines; i++) {
    process.stdout.write("\x1b[2K\n");
  }
  // 回到最后一行之后
  if (lines.length < lastRenderedLines) {
    const extra = lastRenderedLines - lines.length;
    process.stdout.write(`\x1b[${extra}A`);
  }

  lastRenderedLines = lines.length;
}

function startPanel(): void {
  panelStartTime = Date.now();
  panelToolLines = [];
  lastRenderedLines = 0;
  panelActive = true;
  process.stdout.write("\x1b[?25l"); // 隐藏光标
  renderPanel();
  panelTimer = setInterval(renderPanel, 500);
}

function stopPanel(): void {
  panelActive = false;
  if (panelTimer) {
    clearInterval(panelTimer);
    panelTimer = null;
  }
  // 清掉面板
  if (lastRenderedLines > 0) {
    process.stdout.write(`\x1b[${lastRenderedLines}A`);
    for (let i = 0; i < lastRenderedLines; i++) {
      process.stdout.write("\x1b[2K\n");
    }
    process.stdout.write(`\x1b[${lastRenderedLines}A`);
  }
  lastRenderedLines = 0;
  process.stdout.write("\x1b[?25h"); // 恢复光标
}

function pausePanel(): void {
  panelActive = false;
  if (panelTimer) {
    clearInterval(panelTimer);
    panelTimer = null;
  }
  if (lastRenderedLines > 0) {
    process.stdout.write(`\x1b[${lastRenderedLines}A`);
    for (let i = 0; i < lastRenderedLines; i++) {
      process.stdout.write("\x1b[2K\n");
    }
    process.stdout.write(`\x1b[${lastRenderedLines}A`);
  }
  lastRenderedLines = 0;
  process.stdout.write("\x1b[?25h");
}

function resumePanel(): void {
  if (!panelActive) {
    panelActive = true;
    process.stdout.write("\x1b[?25l");
    renderPanel();
    panelTimer = setInterval(renderPanel, 500);
  }
}

function addToolLine(text: string): void {
  // 去掉换行并截断，防止多行内容破坏面板行数计算
  const clean = text.replace(/\n/g, " ").trim();
  panelToolLines.push(clean.length > 80 ? clean.slice(0, 80) + "..." : clean);
}

// ==================== 工具日志展开/折叠 ====================

let toolLogs: string[] = [];
let logExpanded = false;
let memorySavedFlag = false;
let statsText = ""; // 保存统计行文本，用于重绘
let logRowCount = 0;

function charWidth(code: number): number {
  if ((code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x20000 && code <= 0x2a6df)) {
    return 2;
  }
  return 1;
}

function logPrint(text: string): void {
  console.log(text);
  logRowCount++;
  // 计算文本显示宽度，超过终端宽度的部分算额外行
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const termWidth = process.stdout.columns || 80;
  let w = 0;
  for (const ch of stripped) {
    w += charWidth(ch.codePointAt(0)!);
  }
  logRowCount += Math.floor(w / termWidth);
}

function eraseLog(): void {
  for (let i = 0; i < logRowCount; i++) {
    process.stdout.write("\x1b[A\x1b[2K\r");
  }
  process.stdout.write("\x1b[J");
  logRowCount = 0;
}

function printLogFolded(): void {
  logRowCount = 0;
  logPrint(statsText);
  const prefix = memorySavedFlag ? "记忆已保存，" : "";
  logPrint(chalk.dim(`  ${prefix}${toolLogs.length}个工具操作 — Ctrl+O 展开`));
  logExpanded = false;
}

function printLogExpanded(): void {
  logRowCount = 0;
  logPrint(statsText);
  logPrint(chalk.dim("─── 操作详情 ───"));
  let lineCount = 2;
  const maxLines = 20;
  let truncated = false;
  for (let i = 0; i < toolLogs.length; i++) {
    if (lineCount >= maxLines) { truncated = true; break; }
    const parts = toolLogs[i]!.split("\n");
    const header = parts[0]!;
    const body = parts.slice(1).join("\n").trim();
    logPrint(chalk.dim(`${i + 1}. ${header}`));
    lineCount++;
    if (body) {
      const bodyLines = body.split("\n").slice(0, 10);
      for (const bl of bodyLines) {
        if (lineCount >= maxLines) { truncated = true; break; }
        logPrint(chalk.dim(`   ${bl}`));
        lineCount++;
      }
      if (!truncated && body.split("\n").length > 10) {
        logPrint(chalk.dim(`   ... 共 ${body.split("\n").length} 行`));
        lineCount++;
      }
    }
    if (truncated) break;
  }
  if (truncated) {
    logPrint(chalk.dim("   ... 更多内容省略"));
  }
  logPrint(chalk.dim("────────────────── Ctrl+O 折叠"));
  logExpanded = true;
}

// ==================== 输入处理 ====================

let lastCtrlC = 0;

function createPrompt(): readline.Interface {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // 启用 keypress 事件
  readline.emitKeypressEvents(process.stdin, rl);
  return rl;
}

function askInput(rl: readline.Interface): Promise<string> {
  return new Promise((resolve, reject) => {
    const onKeypress = (_ch: string, key: readline.Key): void => {
      if (key && key.ctrl && key.name === "o") {
        cleanup();
        rl.close();
        resolve("\x0f");
      }
    };

    const cleanup = (): void => {
      process.stdin.removeListener("keypress", onKeypress);
      rl.removeListener("SIGINT", onSigint);
    };

    const onSigint = (): void => {
      const now = Date.now();
      if (now - lastCtrlC < 2000) {
        cleanup();
        rl.close();
        reject(new Error("exit"));
      } else {
        lastCtrlC = now;
        process.stdout.write(chalk.dim("  再按一次 Ctrl+C 退出"));
        setTimeout(() => {
          process.stdout.write("\r\x1b[2K");
          rl.prompt();
        }, 2000);
      }
    };

    process.stdin.on("keypress", onKeypress);
    rl.on("SIGINT", onSigint);

    rl.question(chalk.bold("> "), (answer) => {
      cleanup();
      resolve(answer);
    });
  });
}

// ==================== 主函数 ====================

async function main(): Promise<void> {
  const apiKey = await getApiKey();
  let client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });

  const cwd = process.cwd();
  let systemPrompt = buildSystemPrompt(cwd, process.platform);
  const simpleMdPath = path.join(cwd, "simple.md");

  if (fs.existsSync(simpleMdPath)) {
    systemPrompt += `\n## 项目说明\n${fs.readFileSync(simpleMdPath, "utf-8")}\n`;
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];

  let skills = loadSkills();

  // 启动界面
  const infoLines = [
    `${chalk.bold.white("simple")} ${chalk.dim(`v${VERSION}`)}`,
    chalk.white("一款简单的编码工具"),
    "",
    chalk.dim("模型: deepseek-chat"),
    chalk.dim(`路径: ${cwd}`),
  ];
  if (fs.existsSync(simpleMdPath)) {
    infoLines.push(chalk.dim("已加载 simple.md"));
  }
  infoLines.push(chalk.bold.green("输入 /help 查看帮助"));

  // 计算字符串的终端显示宽度（中文占2格）
  function displayWidth(str: string): number {
    let w = 0;
    for (const ch of str) {
      const code = ch.codePointAt(0)!;
      // CJK 统一表意文字 + 全角字符
      if ((code >= 0x4e00 && code <= 0x9fff) ||
          (code >= 0x3000 && code <= 0x303f) ||
          (code >= 0xff00 && code <= 0xffef) ||
          (code >= 0x3400 && code <= 0x4dbf) ||
          (code >= 0x20000 && code <= 0x2a6df)) {
        w += 2;
      } else {
        w += 1;
      }
    }
    return w;
  }

  // 画边框
  const width = 56;
  const top = chalk.dim("╭" + "─".repeat(width) + "╮");
  const bot = chalk.dim("╰" + "─".repeat(width) + "╯");
  console.log(top);
  for (const line of infoLines) {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
    const pad = width - 2 - displayWidth(stripped);
    console.log(chalk.dim("│") + ` ${line}${" ".repeat(Math.max(0, pad))} ` + chalk.dim("│"));
  }
  console.log(bot);
  console.log();

  // 主循环
  while (true) {
    const rl = createPrompt();
    let userInput: string;
    try {
      userInput = await askInput(rl);
    } catch {
      break;
    }

    rl.close();

    if (!userInput.trim()) continue;
    if (userInput.trim().toLowerCase() === "exit") break;

    const cmd = userInput.trim();

    // Ctrl+O 展开/折叠工具操作详情
    if (cmd === "\x0f") {
      if (toolLogs.length) {
        // 清除 "> " 提示行
        process.stdout.write("\x1b[2K\r");
        // 擦除 log 区域
        eraseLog();
        // 重绘
        if (logExpanded) {
          printLogFolded();
        } else {
          printLogExpanded();
        }
      } else {
        console.log(chalk.dim("  暂无操作记录"));
      }
      continue;
    }

    // /help
    if (cmd === "/help") {
      console.log();
      console.log(chalk.bold.white("命令"));
      console.log(`  ${chalk.bold.green("/help")}    显示此帮助信息`);
      console.log(`  ${chalk.bold.green("/reset")}   重新配置 API Key`);
      console.log(`  ${chalk.bold.green("/clear")}   清空对话历史`);
      if (Object.keys(skills).length) {
        console.log();
        console.log(chalk.bold.white("自定义 Skill"));
        for (const name of Object.keys(skills).sort()) {
          const desc = skills[name]!.split("\n")[0]!.slice(0, 50);
          console.log(`  ${chalk.bold.green(`/${name}`)}    ${desc}`);
        }
      }
      console.log();
      console.log(`  Skill 目录: ${chalk.bold(SKILLS_DIR)}`);
      console.log("  也可以直接让 AI 帮你创建 Skill");
      console.log();
      console.log(chalk.bold.white("快捷键"));
      console.log(`  ${chalk.bold.green("Enter")}        提交输入`);
      console.log(`  ${chalk.bold.green("Ctrl+O")}       展开/折叠工具操作详情`);
      console.log(`  ${chalk.bold.green("ESC")}          中断当前任务`);
      console.log(`  ${chalk.bold.green("Ctrl+C × 2")}   退出程序`);
      console.log();
      continue;
    }

    if (cmd === "/reset") {
      await resetConfig();
      const newKey = (await import("./config.js")).loadConfig().api_key;
      if (newKey) client = new OpenAI({ apiKey: newKey, baseURL: "https://api.deepseek.com" });
      console.log(chalk.dim("已切换 API Key，继续对话"));
      continue;
    }

    if (cmd === "/clear") {
      messages.length = 0;
      messages.push({ role: "system", content: systemPrompt });
      tokenCounter.total = 0;
      toolLogs = [];
      console.log(chalk.dim("对话已清空"));
      continue;
    }

    // 自定义 skill
    if (cmd.startsWith("/")) {
      const parts = cmd.split(/\s+/);
      const skillName = parts[0]!.slice(1);
      const extra = parts.slice(1).join(" ");

      skills = loadSkills();

      if (skills[skillName]) {
        userInput = extra ? `${skills[skillName]}\n\n${extra}` : skills[skillName]!;
        console.log(chalk.dim(`  已加载 skill: ${skillName}`));
      } else {
        console.log(chalk.red(`  未知命令: /${skillName}`));
        console.log(chalk.dim("  输入 /help 查看可用命令"));
        continue;
      }
    }

    // 准备对话
    messages.push({ role: "user", content: userInput });
    tokenCounter.round = 0;
    toolLogs = [];
    logExpanded = false;

    // ESC 中断监听
    resetInterrupt();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onData = (data: Buffer): void => {
      if (data[0] === 0x1b && data.length === 1) {
        triggerInterrupt();
      }
    };
    process.stdin.on("data", onData);

    startPanel();

    const reply = await chatRound(
      client, messages, tokenCounter, toolLogs,
      {
        onToolStart: addToolLine,
        onToolUrl: (url: string) => addToolLine(`  ↳ ${url}`),
        onToolError: (msg: string) => addToolLine(`❌ ${msg}`),
        onPanelPause: pausePanel,
        onPanelResume: resumePanel,
      },
      getSignal(),
    );

    stopPanel();

    // 停止 ESC 监听
    process.stdin.removeListener("data", onData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.stdin.resume();

    if (getSignal().aborted) {
      console.log(chalk.yellow("\n  已中断"));
    }

    // 渲染 Markdown 回复
    if (reply) {
      console.log();
      console.log(marked(reply));
    }

    // 本轮统计（保存文本，由 printLogFolded/printLogExpanded 统一输出）
    const elapsed = Math.floor((Date.now() - panelStartTime) / 1000);
    const roundK = (tokenCounter.round / 1000).toFixed(1);
    const totalK = (tokenCounter.total / 1000).toFixed(1);
    statsText = chalk.dim(`  耗时 ${elapsed}秒 | 本轮 ${roundK}k tokens | 累计 ${totalK}k tokens`);

    // 记忆保存 + 工具操作（合并一行）
    const memorySaved = reply && await saveMemory(client, simpleMdPath, userInput, reply, tokenCounter);
    if (memorySaved && toolLogs.length) {
      process.stdout.write("\x1b[2K\r");
      memorySavedFlag = true;
      printLogFolded();
    } else if (memorySaved) {
      console.log(statsText);
      console.log(chalk.dim("  记忆已保存"));
    } else if (toolLogs.length) {
      process.stdout.write("\x1b[2K\r");
      memorySavedFlag = false;
      printLogFolded();
    } else {
      console.log(statsText);
    }
  }

  process.exit(0);
}

main().catch(console.error);
