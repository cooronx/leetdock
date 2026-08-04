import * as vscode from "vscode";
import { LeetCodeError, toUserMessage } from "../leetcode/errors";
import type { ProblemDetail } from "../leetcode/types";
import { renderProblemHtml } from "./problemRenderer";

export interface ProblemPanelActions {
  readonly openCode: (
    problem: ProblemDetail,
    panel: vscode.WebviewPanel,
  ) => Promise<void>;
  readonly switchLanguage: (
    problem: ProblemDetail,
    panel: vscode.WebviewPanel,
  ) => Promise<void>;
  readonly refresh: (problem: ProblemDetail) => Promise<ProblemDetail>;
}

interface PanelEntry {
  problem: ProblemDetail;
  readonly panel: vscode.WebviewPanel;
  readonly subscriptions: vscode.Disposable[];
}

interface WebviewMessage {
  readonly command: string;
  readonly href?: string;
}

export class ProblemPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, PanelEntry>();
  private activeSlug: string | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly actions: ProblemPanelActions,
  ) {}

  public open(problem: ProblemDetail): vscode.WebviewPanel {
    const existing = this.panels.get(problem.titleSlug);
    if (existing !== undefined) {
      existing.problem = problem;
      this.render(existing);
      existing.panel.reveal(undefined, false);
      this.activeSlug = problem.titleSlug;
      return existing.panel;
    }

    const panel = vscode.window.createWebviewPanel(
      "leetdock.problem",
      panelTitle(problem),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "media"),
          vscode.Uri.joinPath(this.extensionUri, "node_modules", "katex", "dist"),
        ],
      },
    );
    const entry: PanelEntry = { problem, panel, subscriptions: [] };
    this.panels.set(problem.titleSlug, entry);
    this.activeSlug = problem.titleSlug;
    this.render(entry);

    entry.subscriptions.push(
      panel.onDidDispose(() => this.remove(problem.titleSlug)),
      panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
          this.activeSlug = entry.problem.titleSlug;
        }
      }),
      panel.webview.onDidReceiveMessage((message: unknown) =>
        this.handleMessage(entry, message),
      ),
    );
    return panel;
  }

  public getActiveProblem(): ProblemDetail | undefined {
    return this.activeSlug === undefined
      ? undefined
      : this.panels.get(this.activeSlug)?.problem;
  }

  public getProblem(titleSlug: string): ProblemDetail | undefined {
    return this.panels.get(titleSlug)?.problem;
  }

  public async refresh(titleSlug: string): Promise<ProblemDetail> {
    const entry = this.panels.get(titleSlug);
    if (entry === undefined) {
      throw new LeetCodeError("not-found", "Problem panel is not open.");
    }
    const refreshed = await this.actions.refresh(entry.problem);
    entry.problem = refreshed;
    this.render(entry);
    return refreshed;
  }

  public dispose(): void {
    for (const entry of [...this.panels.values()]) {
      entry.panel.dispose();
    }
    this.panels.clear();
    this.activeSlug = undefined;
  }

  private render(entry: PanelEntry): void {
    entry.panel.title = panelTitle(entry.problem);
    entry.panel.webview.html = renderProblemHtml(
      entry.panel.webview,
      this.extensionUri,
      entry.problem,
    );
  }

  private async handleMessage(entry: PanelEntry, message: unknown): Promise<void> {
    if (!isWebviewMessage(message)) {
      return;
    }

    try {
      switch (message.command) {
        case "openCode":
          await this.actions.openCode(entry.problem, entry.panel);
          break;
        case "switchLanguage":
          await this.actions.switchLanguage(entry.problem, entry.panel);
          break;
        case "refresh": {
          const refreshed = await this.actions.refresh(entry.problem);
          entry.problem = refreshed;
          this.render(entry);
          break;
        }
        case "openBrowser":
          await openExternal(
            `https://leetcode.cn/problems/${encodeURIComponent(entry.problem.titleSlug)}/`,
          );
          break;
        case "openExternal":
          if (message.href !== undefined) {
            await openExternal(message.href);
          }
          break;
      }
    } catch (error) {
      const messageText = error instanceof LeetCodeError
        ? toUserMessage(error)
        : error instanceof Error
          ? error.message
          : "LeetDock 遇到了未预期的错误。";
      await vscode.window.showErrorMessage(messageText);
    }
  }

  private remove(titleSlug: string): void {
    const entry = this.panels.get(titleSlug);
    if (entry === undefined) {
      return;
    }
    this.panels.delete(titleSlug);
    for (const subscription of entry.subscriptions) {
      subscription.dispose();
    }
    if (this.activeSlug === titleSlug) {
      this.activeSlug = undefined;
    }
  }
}

function panelTitle(problem: ProblemDetail): string {
  return `${problem.frontendId}. ${problem.translatedTitle?.trim() || problem.title}`;
}

function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const command = Reflect.get(value, "command");
  const href = Reflect.get(value, "href");
  return (
    typeof command === "string" &&
    (href === undefined || typeof href === "string")
  );
}

async function openExternal(value: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(value, "https://leetcode.cn/");
  } catch {
    throw new Error("无法打开无效链接。");
  }
  if (url.protocol !== "https:") {
    throw new Error("已阻止不安全的外部链接。");
  }
  const opened = await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
  if (!opened) {
    throw new Error("无法在浏览器中打开链接。");
  }
}
