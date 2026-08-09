import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { JudgeAction, JudgeResult, ProblemDetail } from "../leetcode/types";

interface ExecutionResources {
  readonly css: string;
  readonly js: string;
}

export type ExecutionProblemIdentity = Pick<
  ProblemDetail,
  "frontendId" | "title" | "translatedTitle"
>;

export function renderExecutionInputHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  problem: ExecutionProblemIdentity,
  input: string,
  action: "test" | "debug" = "test",
): string {
  const debugging = action === "debug";
  const actionTitle = debugging ? "自定义调试" : "自定义测试";
  return documentShell(
    webview,
    extensionUri,
    `${problem.frontendId}. ${displayTitle(problem)} · ${actionTitle}`,
    `<main class="execution-shell">
      ${heading(problem, actionTitle, debugging ? "编辑一组输入后启动本地调试" : "编辑测试用例后运行")}
      <section class="card">
        <label for="test-input">${debugging ? "调试输入" : "测试输入"}</label>
        <textarea id="test-input" spellcheck="false" autofocus>${escapeHtml(input)}</textarea>
        <p class="hint">每个参数一行，请使用严格的 LeetCode JSON 格式。</p>
        <button id="run-custom" class="primary" type="button" data-pending-label="${debugging ? "启动中…" : "运行中…"}">${debugging ? "启动调试" : "运行测试"}</button>
      </section>
    </main>`,
  );
}

export function renderExecutionPendingHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  problem: ProblemDetail,
  action: JudgeAction,
): string {
  const label = action === "test" ? "测试" : "提交";
  return documentShell(
    webview,
    extensionUri,
    `${problem.frontendId}. ${displayTitle(problem)} · ${label}`,
    `<main class="execution-shell">
      ${heading(problem, label, "正在等待 LeetCode 判题")}
      <section class="status-card pending" role="status">
        <span class="spinner" aria-hidden="true"></span>
        <div><strong>运行中…</strong><p>代码已经发送，请稍候。</p></div>
      </section>
    </main>`,
  );
}

export function renderExecutionResultHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  problem: ProblemDetail,
  result: JudgeResult,
): string {
  const label = result.action === "test" ? "测试结果" : "提交结果";
  const details = [
    result.runtime === undefined ? "" : metric("运行时间", result.runtime),
    result.memory === undefined ? "" : metric("内存", result.memory),
    result.totalCorrect === undefined || result.totalTestcases === undefined
      ? ""
      : metric("通过用例", `${result.totalCorrect} / ${result.totalTestcases}`),
    result.runtimePercentile === undefined
      ? ""
      : metric("时间击败", `${formatPercent(result.runtimePercentile)}%`),
    result.memoryPercentile === undefined
      ? ""
      : metric("内存击败", `${formatPercent(result.memoryPercentile)}%`),
  ].join("");

  const outputs = [
    outputSection("编译错误", result.compileError, "error-output"),
    outputSection("运行错误", result.runtimeError, "error-output"),
    outputSection("测试输入", result.input),
    outputSection("实际输出", result.actualOutput),
    outputSection("预期输出", result.expectedOutput),
    outputSection("标准输出", result.standardOutput),
  ].join("");

  return documentShell(
    webview,
    extensionUri,
    `${problem.frontendId}. ${displayTitle(problem)} · ${label}`,
    `<main class="execution-shell">
      ${heading(problem, label, `任务 ${escapeHtml(result.taskId)}`)}
      <section class="status-card ${result.accepted ? "success" : "failure"}" role="status">
        <span class="status-icon" aria-hidden="true">${result.accepted ? "✓" : "×"}</span>
        <div><strong>${escapeHtml(result.statusMessage)}</strong><p>${result.accepted ? "已通过" : "未通过"}</p></div>
      </section>
      ${details.length === 0 ? "" : `<section class="metrics">${details}</section>`}
      ${outputs}
    </main>`,
  );
}

export function renderExecutionErrorHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  problem: ProblemDetail,
  action: JudgeAction,
  message: string,
): string {
  const label = action === "test" ? "测试失败" : "提交失败";
  return documentShell(
    webview,
    extensionUri,
    `${problem.frontendId}. ${displayTitle(problem)} · ${label}`,
    `<main class="execution-shell">
      ${heading(problem, label, "请求未完成")}
      <section class="status-card failure" role="alert">
        <span class="status-icon" aria-hidden="true">×</span>
        <div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(message)}</p></div>
      </section>
    </main>`,
  );
}

function documentShell(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  title: string,
  body: string,
): string {
  const nonce = randomBytes(16).toString("hex");
  const resources = resourceUris(webview, extensionUri);
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${escapeAttribute(resources.css)}">
</head>
<body>${body}<script nonce="${nonce}" src="${escapeAttribute(resources.js)}"></script></body>
</html>`;
}

function heading(
  problem: ExecutionProblemIdentity,
  title: string,
  subtitle: string,
): string {
  return `<header>
    <p class="kicker">LeetDock · ${escapeHtml(problem.frontendId)}</p>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(displayTitle(problem))} · ${escapeHtml(subtitle)}</p>
  </header>`;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function outputSection(title: string, value: string | undefined, className = ""): string {
  if (value === undefined) {
    return "";
  }
  return `<section class="card output ${className}"><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(value)}</pre></section>`;
}

function formatPercent(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function resourceUris(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): ExecutionResources {
  const resource = (file: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", file)).toString();
  return { css: resource("execution.css"), js: resource("execution.js") };
}

function displayTitle(problem: ExecutionProblemIdentity): string {
  return problem.translatedTitle?.trim() || problem.title;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
