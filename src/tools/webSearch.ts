import type { Tool } from "./index.js";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

interface SearchResult {
  title: string;
  href: string;
  snippet: string;
}

async function searchBaidu(keyword: string): Promise<SearchResult[]> {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`;
  const resp = await fetch(url, { headers: HEADERS });
  const html = await resp.text();
  const { load } = await import("cheerio");
  const $ = load(html);
  const results: SearchResult[] = [];
  $(".result.c-container").slice(0, 5).each((_, el) => {
    const titleTag = $(el).find("h3 a");
    const snippetTag = $(el).find(".c-abstract, .content-right_2s-H4");
    if (titleTag.length) {
      results.push({
        title: titleTag.text().trim(),
        href: titleTag.attr("href") || "",
        snippet: snippetTag.text().trim(),
      });
    }
  });
  return results;
}

async function searchSogou(keyword: string): Promise<SearchResult[]> {
  const url = `https://www.sogou.com/web?query=${encodeURIComponent(keyword)}`;
  const resp = await fetch(url, { headers: HEADERS });
  const html = await resp.text();
  const { load } = await import("cheerio");
  const $ = load(html);
  const results: SearchResult[] = [];
  $(".vrwrap, .rb").slice(0, 5).each((_, el) => {
    const titleTag = $(el).find("h3 a, a").first();
    const snippetTag = $(el).find(".str-text-info, .space-txt");
    if (titleTag.length) {
      results.push({
        title: titleTag.text().trim(),
        href: titleTag.attr("href") || "",
        snippet: snippetTag.text().trim(),
      });
    }
  });
  return results;
}

async function search360(keyword: string): Promise<SearchResult[]> {
  const url = `https://www.so.com/s?q=${encodeURIComponent(keyword)}`;
  const resp = await fetch(url, { headers: HEADERS });
  const html = await resp.text();
  const { load } = await import("cheerio");
  const $ = load(html);
  const results: SearchResult[] = [];
  $("li.res-list").slice(0, 5).each((_, el) => {
    const titleTag = $(el).find("h3 a");
    const snippetTag = $(el).find(".res-desc");
    if (titleTag.length) {
      results.push({
        title: titleTag.text().trim(),
        href: titleTag.attr("href") || "",
        snippet: snippetTag.text().trim(),
      });
    }
  });
  return results;
}

const ENGINES = [
  { name: "百度", fn: searchBaidu },
  { name: "搜狗", fn: searchSogou },
  { name: "360", fn: search360 },
];

export const webSearchTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "web_search",
      description: `联网搜索，通过国内搜索引擎查询信息，返回相关网页的标题、链接和摘要。\n\n参数说明：\n- keyword（必填）：搜索关键词`,
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "搜索关键词" },
        },
        required: ["keyword"],
      },
    },
  },
  label: (args) => `正在搜索 "${args["keyword"] ?? ""}"`,
  execute: async (args) => {
    const keyword = args["keyword"] as string;

    for (const engine of ENGINES) {
      try {
        const results = await engine.fn(keyword);
        if (results.length) {
          const lines = [`[来源: ${engine.name}]\n`];
          results.forEach((r, i) => {
            lines.push(`${i + 1}. ${r.title}\n   ${r.href}\n   ${r.snippet}`);
          });
          return lines.join("\n\n");
        }
      } catch { /* try next engine */ }
    }

    return `所有搜索引擎均未找到关于 "${keyword}" 的结果`;
  },
};
