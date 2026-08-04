import { randomBytes } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import * as vscode from "vscode";
import type { Difficulty, ProblemDetail, ProblemStatus } from "../leetcode/types";

const LEETCODE_ORIGIN = "https://leetcode.cn";

const ALLOWED_CONTENT_TAGS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
] as const;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_CONTENT_TAGS],
  allowedAttributes: {
    a: ["href", "title"],
    blockquote: ["cite"],
    col: ["span"],
    colgroup: ["span"],
    img: ["src", "alt", "title", "width", "height"],
    li: ["value"],
    ol: ["start", "reversed"],
    q: ["cite"],
    td: ["colspan", "rowspan", "headers"],
    th: ["colspan", "rowspan", "headers", "scope"],
  },
  allowedSchemes: ["https"],
  allowedSchemesByTag: {
    a: ["https"],
    blockquote: ["https"],
    img: ["https"],
    q: ["https"],
  },
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: false,
  nestingLimit: 50,
  nonTextTags: ["script", "style", "textarea", "option", "noscript"],
  parseStyleAttributes: false,
  transformTags: {
    a: (tagName, attributes) => ({
      tagName,
      attribs: replaceUrlAttribute(attributes, "href"),
    }),
    blockquote: (tagName, attributes) => ({
      tagName,
      attribs: replaceUrlAttribute(attributes, "cite"),
    }),
    img: (tagName, attributes) => ({
      tagName,
      attribs: replaceUrlAttribute(attributes, "src"),
    }),
    q: (tagName, attributes) => ({
      tagName,
      attribs: replaceUrlAttribute(attributes, "cite"),
    }),
  },
};

/** Messages emitted by media/problem.js for a ProblemPanel to handle. */
export type ProblemWebviewMessage =
  | { readonly command: "openCode" }
  | { readonly command: "switchLanguage" }
  | { readonly command: "refresh" }
  | { readonly command: "openBrowser" }
  | { readonly command: "openExternal"; readonly href: string };

/**
 * Renders a complete, CSP-locked problem document for a VS Code Webview.
 *
 * The caller must include the extension root in the Webview's localResourceRoots
 * so the media and bundled KaTeX files referenced here can be loaded.
 */
export function renderProblemHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  problem: ProblemDetail,
): string {
  const nonce = randomBytes(16).toString("hex");
  const resources = getResourceUris(webview, extensionUri);
  const translatedContent = problem.translatedContent?.trim();
  const hasTranslation = translatedContent !== undefined && translatedContent.length > 0;
  const displayedContent = hasTranslation ? translatedContent : problem.content;
  const primaryTitle = nonEmpty(problem.translatedTitle) ?? problem.title;
  const secondaryTitle =
    primaryTitle === problem.title ? undefined : nonEmpty(problem.title);
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `img-src ${webview.cspSource} https://leetcode.cn https://*.leetcode.cn https://leetcode-cn.com https://*.leetcode-cn.com`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    "style-src-attr 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="${hasTranslation ? "zh-CN" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(`${problem.frontendId}. ${primaryTitle}`)}</title>
  <link rel="stylesheet" href="${escapeHtmlAttribute(resources.katexCss)}">
  <link rel="stylesheet" href="${escapeHtmlAttribute(resources.problemCss)}">
</head>
<body>
  <main class="problem-shell">
    <header class="problem-header">
      <div class="problem-heading">
        <p class="problem-kicker">LeetDock · ${escapeHtml(problem.frontendId)}</p>
        <h1>${escapeHtml(primaryTitle)}</h1>
        ${secondaryTitle === undefined ? "" : `<p class="original-title" lang="en">${escapeHtml(secondaryTitle)}</p>`}
      </div>
      <div class="problem-meta" aria-label="题目信息">
        ${renderDifficulty(problem.difficulty)}
        ${renderStatus(problem.status)}
        ${problem.paidOnly ? '<span class="meta-badge premium">会员题</span>' : ""}
      </div>
      ${renderTags(problem)}
    </header>

    ${problem.paidOnly ? renderPremiumNotice() : ""}

    <section class="problem-content" lang="${hasTranslation ? "zh-CN" : "en"}" aria-label="${hasTranslation ? "中文题目" : "English problem"}">
      ${sanitizeProblemContent(displayedContent)}
    </section>

    ${renderHints(problem.hints)}

    <nav class="action-bar" aria-label="题目操作">
      <button class="action-button primary" type="button" data-command="openCode">打开代码</button>
      <button class="action-button" type="button" data-command="switchLanguage">切换语言</button>
      <button class="action-button" type="button" data-command="refresh">刷新</button>
      <button class="action-button" type="button" data-command="openBrowser">在浏览器中打开</button>
    </nav>
  </main>

  <script nonce="${nonce}" src="${escapeHtmlAttribute(resources.katexJs)}"></script>
  <script nonce="${nonce}" src="${escapeHtmlAttribute(resources.katexAutoRenderJs)}"></script>
  <script nonce="${nonce}" src="${escapeHtmlAttribute(resources.problemJs)}"></script>
</body>
</html>`;
}

/** Sanitizes one LeetCode-owned HTML fragment before it enters the Webview. */
export function sanitizeProblemContent(content: string): string {
  return sanitizeHtml(content, SANITIZE_OPTIONS);
}

interface ResourceUris {
  readonly problemCss: string;
  readonly problemJs: string;
  readonly katexCss: string;
  readonly katexJs: string;
  readonly katexAutoRenderJs: string;
}

function getResourceUris(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): ResourceUris {
  const resourceUri = (...segments: readonly string[]): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments)).toString();

  return {
    problemCss: resourceUri("media", "problem.css"),
    problemJs: resourceUri("media", "problem.js"),
    katexCss: resourceUri("node_modules", "katex", "dist", "katex.min.css"),
    katexJs: resourceUri("node_modules", "katex", "dist", "katex.min.js"),
    katexAutoRenderJs: resourceUri(
      "node_modules",
      "katex",
      "dist",
      "contrib",
      "auto-render.min.js",
    ),
  };
}

function renderDifficulty(difficulty: Difficulty): string {
  const labels: Readonly<Record<Difficulty, string>> = {
    Easy: "简单",
    Medium: "中等",
    Hard: "困难",
  };
  return `<span class="meta-badge difficulty ${difficulty.toLowerCase()}">${labels[difficulty]}</span>`;
}

function renderStatus(status: ProblemStatus): string {
  if (status === "AC") {
    return '<span class="meta-badge status accepted">已通过</span>';
  }
  if (status === "TRIED") {
    return '<span class="meta-badge status tried">尝试过</span>';
  }
  return '<span class="meta-badge status untouched">未开始</span>';
}

function renderTags(problem: ProblemDetail): string {
  if (problem.tags.length === 0) {
    return "";
  }

  const tags = problem.tags
    .map((tag) => {
      const label = nonEmpty(tag.translatedName) ?? tag.name;
      return `<span class="topic-tag">${escapeHtml(label)}</span>`;
    })
    .join("");
  return `<div class="topic-tags" aria-label="题目标签">${tags}</div>`;
}

function renderPremiumNotice(): string {
  return `<aside class="premium-notice" role="note">
    <strong>会员专享题目</strong>
    <span>查看完整题目或提交代码可能需要 LeetDock 会员权限。</span>
  </aside>`;
}

function renderHints(hints: readonly string[]): string {
  if (hints.length === 0) {
    return "";
  }

  const items = hints
    .map(
      (hint, index) => `<details class="hint-item">
        <summary>提示 ${index + 1}</summary>
        <div class="hint-content">${sanitizeProblemContent(hint)}</div>
      </details>`,
    )
    .join("");

  return `<section class="hints" aria-labelledby="hints-title">
    <h2 id="hints-title">提示</h2>
    ${items}
  </section>`;
}

function replaceUrlAttribute(
  attributes: sanitizeHtml.Attributes,
  attributeName: "cite" | "href" | "src",
): sanitizeHtml.Attributes {
  const normalizedUrl = normalizeHttpsUrl(attributes[attributeName]);
  const sanitizedAttributes = { ...attributes };
  if (normalizedUrl === undefined) {
    delete sanitizedAttributes[attributeName];
  } else {
    sanitizedAttributes[attributeName] = normalizedUrl;
  }
  return sanitizedAttributes;
}

function normalizeHttpsUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const candidate = value.trim();
  if (candidate.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(candidate, `${LEETCODE_ORIGIN}/`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.protocol = "https:";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
