/**
 * 流式对话处理：API 调用、工具调度、记忆保存
 */

import fs from "fs";
import type OpenAI from "openai";
import { definitions, toolMap } from "./tools/index.js";
import { isDangerous } from "./tools/runCommand.js";

export function buildSystemPrompt(cwd: string, platform: string): string {
  return `你是 simple，一个终端编码助手。

## 基本信息
- 当前日期: ${new Date().toLocaleDateString("zh-CN")}
- 当前工作目录: ${cwd}
- 用户操作系统: ${platform}

## 工作原则
- 启动后第一件事：收到用户第一条消息时，先用 read_file 读取当前工作目录下的 simple.md 文件（如果存在），了解项目背景和历史记忆，再回复用户
- 当前工作目录优先：所有操作默认在当前工作目录下进行。读文件、搜索、执行命令都应该从当前目录开始，不要去访问其他无关路径
- 先理解再行动：修改代码前，先用搜索工具了解项目结构，再用读文件查看相关代码
- 最小改动：只改需要改的地方，用 edit_file 而不是 write_file 来修改现有文件
- 回复简洁：不要废话，直接给结果
- 复杂任务先列计划：当任务涉及多个步骤时，先输出一个编号计划清单，然后按顺序执行

## 工具使用优先级
1. 面对一个不熟悉的项目，先用 glob_files 了解文件结构
2. 需要找代码时，用 grep_files 搜索关键词，不要逐个读文件
3. 修改已有文件用 edit_file，创建新文件用 write_file
4. 写完代码后主动用 run_command 运行验证
5. 当用户需求不明确时，必须使用 ask_user 工具向用户提问，不要用普通文字回复来提问
6. 使用 web_search 搜索后，回复末尾必须列出所有参考来源的完整网址
7. 自定义 Skill 存放在 ~/.simple-code/skills/ 目录下，每个 .md 文件就是一个 skill。用户可以通过 create_skill 工具创建新 skill，也可以用 read_file 读取该目录查看已有的 skill
`;
}

interface TokenCounter {
  total: number;
  round: number;
}

interface ChatCallbacks {
  onToolStart: (tip: string) => void;
  onToolUrl: (url: string) => void;
  onToolError: (msg: string) => void;
  onPanelPause: () => void;
  onPanelResume: () => void;
}

export async function chatRound(
  client: OpenAI,
  messages: OpenAI.ChatCompletionMessageParam[],
  tokenCounter: TokenCounter,
  toolLogs: string[],
  callbacks: ChatCallbacks,
  abortSignal?: AbortSignal,
): Promise<string> {

  while (true) {
    if (abortSignal?.aborted) return "";

    let stream;
    try {
      stream = await client.chat.completions.create({
        model: "deepseek-chat",
        messages,
        tools: definitions,
        stream: true,
        stream_options: { include_usage: true },
      }, abortSignal ? { signal: abortSignal } : undefined);
    } catch (e) {
      if (abortSignal?.aborted) return "";
      throw e;
    }

    let reply = "";
    const toolCallsData: Record<number, { id: string; name: string; arguments: string }> = {};

    try {
      for await (const chunk of stream) {
        if (abortSignal?.aborted) break;

        if (chunk.usage) {
          tokenCounter.total += chunk.usage.total_tokens;
          tokenCounter.round += chunk.usage.total_tokens;
        }

        if (!chunk.choices?.length) continue;
        const delta = chunk.choices[0]!.delta;

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallsData[idx]) {
              toolCallsData[idx] = { id: "", name: "", arguments: "" };
            }
            if (tc.id) toolCallsData[idx]!.id = tc.id;
            if (tc.function?.name) toolCallsData[idx]!.name = tc.function.name;
            if (tc.function?.arguments) toolCallsData[idx]!.arguments += tc.function.arguments;
          }
        }

        if (delta.content) reply += delta.content;
      }
    } catch (e) {
      if (abortSignal?.aborted) return reply;
      throw e;
    }

    if (abortSignal?.aborted) return reply;

    // AI 先说话再调工具
    if (reply && Object.keys(toolCallsData).length > 0) {
      let short = reply.trim().replace(/\n/g, " ");
      if (short.length > 50) short = short.slice(0, 50) + "...";
      callbacks.onToolStart(short);
    }

    // 处理工具调用
    if (Object.keys(toolCallsData).length > 0) {
      const toolCalls = Object.values(toolCallsData).map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));
      const msgIndexBeforeTools = messages.length;
      messages.push({ role: "assistant", content: reply || null, tool_calls: toolCalls });

      for (const tc of Object.values(toolCallsData)) {
        if (abortSignal?.aborted) break;

        const tool = toolMap.get(tc.name);
        if (!tool) continue;

        const args = JSON.parse(tc.arguments) as Record<string, unknown>;
        const tip = tool.label(args);
        callbacks.onToolStart(tip);

        const needsPause = tool.needsPause ||
          (tc.name === "run_command" && isDangerous(args["command"] as string));
        if (needsPause) callbacks.onPanelPause();

        let result: string;
        try {
          result = await tool.execute(args);
          toolLogs.push(`[${tip}]\n${result.slice(0, 500)}`);

          if (tc.name === "web_search" && result.includes("http")) {
            let urlCount = 0;
            for (const line of result.split("\n")) {
              if (line.trim().startsWith("http")) {
                callbacks.onToolUrl(line.trim().slice(0, 80));
                urlCount++;
                if (urlCount >= 2) break;
              }
            }
          }
        } catch (e) {
          result = `错误: ${e}`;
          callbacks.onToolError(result);
        }

        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        if (needsPause) callbacks.onPanelResume();
      }

      // 中断时清理不完整的 tool_calls + partial tool results
      if (abortSignal?.aborted) {
        messages.splice(msgIndexBeforeTools);
        return reply;
      }
      continue;
    }

    // 最终文字回复
    if (reply) {
      messages.push({ role: "assistant", content: reply });
    }
    return reply;
  }
}

export async function saveMemory(
  client: OpenAI,
  simpleMdPath: string,
  userInput: string,
  reply: string,
  tokenCounter: TokenCounter,
): Promise<boolean> {
  try {
    const resp = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "用一句简短的中文总结这轮对话做了什么，只输出这一句话，不要任何多余内容。" },
        { role: "user", content: `用户说: ${userInput}\nAI回复: ${reply.slice(0, 200)}` },
      ],
    });
    if (resp.usage) {
      tokenCounter.total += resp.usage.total_tokens;
      tokenCounter.round += resp.usage.total_tokens;
    }
    const line = resp.choices[0]?.message.content?.trim();
    if (line) {
      fs.appendFileSync(simpleMdPath, `- ${line}\n`, "utf-8");
    }
    return true;
  } catch {
    return false;
  }
}
