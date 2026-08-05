import * as vscode from "vscode";
import { toUserMessage } from "../leetcode/errors";
import type { JudgeAction, JudgeResult, ProblemDetail } from "../leetcode/types";
import {
  renderExecutionErrorHtml,
  renderExecutionInputHtml,
  renderExecutionPendingHtml,
  renderExecutionResultHtml,
} from "./executionRenderer";

interface CustomInputMessage {
  readonly command: "runCustom";
  readonly input: string;
}

interface PanelContext {
  problem: ProblemDetail;
  action: JudgeAction;
  runCustom?: (input: string) => Promise<void>;
}

export class ExecutionPanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private context: PanelContext | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public showCustomInput(
    problem: ProblemDetail,
    input: string,
    runCustom: (input: string) => Promise<void>,
  ): void {
    const panel = this.getOrCreatePanel();
    this.context = { problem, action: "test", runCustom };
    panel.title = `测试 · ${problem.frontendId}`;
    panel.webview.html = renderExecutionInputHtml(
      panel.webview,
      this.extensionUri,
      problem,
      input,
    );
    panel.reveal(vscode.ViewColumn.Beside, false);
  }

  public showPending(problem: ProblemDetail, action: JudgeAction): void {
    const panel = this.getOrCreatePanel();
    this.context = { problem, action };
    panel.title = `${action === "test" ? "测试" : "提交"} · ${problem.frontendId}`;
    panel.webview.html = renderExecutionPendingHtml(
      panel.webview,
      this.extensionUri,
      problem,
      action,
    );
    panel.reveal(vscode.ViewColumn.Beside, false);
  }

  public showResult(problem: ProblemDetail, result: JudgeResult): void {
    const panel = this.getOrCreatePanel();
    this.context = { problem, action: result.action };
    panel.title = `${result.action === "test" ? "测试" : "提交"} · ${problem.frontendId}`;
    panel.webview.html = renderExecutionResultHtml(
      panel.webview,
      this.extensionUri,
      problem,
      result,
    );
  }

  public showError(problem: ProblemDetail, action: JudgeAction, error: unknown): void {
    const panel = this.getOrCreatePanel();
    const message = error instanceof Error && !("kind" in error)
      ? error.message
      : toUserMessage(error);
    this.context = { problem, action };
    panel.title = `${action === "test" ? "测试" : "提交"}失败 · ${problem.frontendId}`;
    panel.webview.html = renderExecutionErrorHtml(
      panel.webview,
      this.extensionUri,
      problem,
      action,
      message,
    );
  }

  public close(): void {
    this.panel?.dispose();
  }

  public dispose(): void {
    this.close();
  }

  private getOrCreatePanel(): vscode.WebviewPanel {
    if (this.panel !== undefined) {
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      "leetdock.executionResult",
      "LeetDock 运行结果",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      },
    );
    this.panel = panel;
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.context = undefined;
    });
    panel.webview.onDidReceiveMessage((message: unknown) =>
      this.handleMessage(message),
    );
    return panel;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isCustomInputMessage(message) || this.context?.runCustom === undefined) {
      return;
    }
    const input = message.input.trim();
    if (input.length === 0) {
      await vscode.window.showWarningMessage("测试用例不能为空。");
      return;
    }
    const runCustom = this.context.runCustom;
    this.context.runCustom = undefined;
    try {
      await runCustom(input);
    } catch (error) {
      const context = this.context;
      if (context !== undefined) {
        this.showError(context.problem, context.action, error);
      }
      const message = error instanceof Error && !("kind" in error)
        ? error.message
        : toUserMessage(error);
      await vscode.window.showErrorMessage(message);
    }
  }
}

function isCustomInputMessage(value: unknown): value is CustomInputMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.get(value, "command") === "runCustom" &&
    typeof Reflect.get(value, "input") === "string"
  );
}
