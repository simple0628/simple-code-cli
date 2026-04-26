import type { Tool } from "./index.js";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const REMOVE_TAGS = ["script", "style", "nav", "header", "footer", "iframe", "noscript", "aside"];
const MAX_LENGTH = 8000;

export const webFetchTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "web_fetch",
      description: `阅读指定网页的正文内容。用于读取搜索结果中的具体页面、技术文档等。\n\n参数说明：\n- url（必填）：要阅读的网页完整地址\n\n返回值：网页的正文文本内容`,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要阅读的网页URL" },
        },
        required: ["url"],
      },
    },
  },
  label: (args) => {
    const url = (args["url"] as string) || "";
    return `正在阅读 ${url.length > 60 ? url.slice(0, 60) + "..." : url}`;
  },
  execute: async (args) => {
    const url = args["url"] as string;
    try {
      const resp = await fetch(url, { headers: HEADERS });
      const html = await resp.text();
      const { load } = await import("cheerio");
      const $ = load(html);

      for (const tag of REMOVE_TAGS) {
        $(tag).remove();
      }

      const main = $("article").first().length ? $("article").first()
        : $("main").first().length ? $("main").first()
        : $("body").first();

      let text = main.text().replace(/\n\s*\n/g, "\n").trim();

      if (text.length > MAX_LENGTH) {
        text = text.slice(0, MAX_LENGTH) + `\n\n... (内容已截断，共 ${text.length} 字符)`;
      }

      return text || "页面内容为空";
    } catch (e) {
      return `请求失败: ${e}`;
    }
  },
};
