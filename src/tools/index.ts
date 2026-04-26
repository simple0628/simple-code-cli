/**
 * 工具自动注册
 */

import type OpenAI from "openai";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";
import { editFileTool } from "./editFile.js";
import { runCommandTool } from "./runCommand.js";
import { globFilesTool } from "./globFiles.js";
import { grepFilesTool } from "./grepFiles.js";
import { webSearchTool } from "./webSearch.js";
import { webFetchTool } from "./webFetch.js";
import { askUserTool } from "./askUser.js";
import { taskListTool } from "./taskList.js";
import { createSkillTool } from "./createSkill.js";

export interface Tool {
  definition: OpenAI.ChatCompletionTool;
  execute: (args: Record<string, unknown>) => Promise<string>;
  label: (args: Record<string, unknown>) => string;
  needsPause?: boolean;
}

const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  runCommandTool,
  globFilesTool,
  grepFilesTool,
  webSearchTool,
  webFetchTool,
  askUserTool,
  taskListTool,
  createSkillTool,
];

export const definitions = allTools.map((t) => t.definition);

export const toolMap = new Map<string, Tool>();
for (const tool of allTools) {
  const def = tool.definition as unknown as Record<string, unknown>;
  const fn = def["function"] as { name: string } | undefined;
  const name = fn?.name ?? "";
  toolMap.set(name, tool);
}
