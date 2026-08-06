import * as path from "node:path";
import * as vscode from "vscode";
import { withAuthExpiryHandling } from "../auth/authExpiry";
import { AuthService } from "../auth/authService";
import { LeetCodeClient } from "../leetcode/client";
import { toUserMessage } from "../leetcode/errors";
import type { ProblemDetail } from "../leetcode/types";
import { ProblemService } from "../problem/problemService";
import { ExecutionPanelManager } from "../webview/executionPanel";
import { getLanguageDefinition } from "../workspace/languageService";
import {
  parseSolutionDocument,
  type SolutionMetadata,
} from "../workspace/solutionDocument";

interface PreparedSolution {
  readonly document: vscode.TextDocument;
  readonly metadata: SolutionMetadata;
  readonly problem: ProblemDetail;
}

interface TestChoice extends vscode.QuickPickItem {
  readonly value: "custom" | "default";
}

export class SolutionExecutionService implements vscode.Disposable {
  private readonly busyUris = new Set<string>();
  private readonly busyEmitter = new vscode.EventEmitter<void>();
  private readonly customInputs = new Map<string, string>();

  public constructor(
    private readonly client: LeetCodeClient,
    private readonly auth: AuthService,
    private readonly problems: ProblemService,
    private readonly panels: ExecutionPanelManager,
    private readonly refreshProblemStatus: (
      problem: ProblemDetail,
      accepted: boolean,
    ) => Promise<void>,
  ) {}

  public readonly onDidChangeBusy = this.busyEmitter.event;

  public isBusy(uri: vscode.Uri): boolean {
    return this.busyUris.has(uri.toString());
  }

  public async test(input?: unknown): Promise<void> {
    const uri = activeSolutionUri(input);
    if (uri === undefined) {
      await vscode.window.showInformationMessage("请先打开或选择一个 LeetDock solution 文件。");
      return;
    }

    const metadata = await readMetadata(uri);
    if (metadata === undefined) {
      await vscode.window.showErrorMessage(
        "当前文件不是有效的 LeetDock solution 文件，或文件头元数据已被修改。",
      );
      return;
    }
    const choices: readonly TestChoice[] = [
      {
        label: "$(play) 题目默认样例",
        description: "立即运行 LeetCode 提供的样例",
        value: "default",
      },
      {
        label: "$(edit) 自定义输入",
        description: "在多行编辑器中填写测试用例",
        value: "custom",
      },
    ];
    const selected = await vscode.window.showQuickPick(choices, {
      title: `测试 ${metadata.frontendId}. ${metadata.title}`,
      ignoreFocusOut: true,
    });
    if (selected === undefined) {
      return;
    }

    if (selected.value === "custom") {
      const prepared = await this.prepare(uri, false);
      const initialInput = this.customInputs.get(prepared.metadata.titleSlug) ??
        defaultTestInput(prepared.problem);
      this.panels.showCustomInput(prepared.problem, initialInput, async (customInput) => {
        this.customInputs.set(prepared.metadata.titleSlug, customInput);
        await this.executeTest(uri, customInput);
      });
      return;
    }

    await this.executeTest(uri);
  }

  public async submit(input?: unknown): Promise<void> {
    const uri = activeSolutionUri(input);
    if (uri === undefined) {
      await vscode.window.showInformationMessage("请先打开或选择一个 LeetDock solution 文件。");
      return;
    }
    let completion: { readonly accepted: boolean; readonly problem: ProblemDetail } | undefined;
    await this.runLocked(uri, async () => {
      const prepared = await this.prepare(uri, true);
      this.panels.showPending(prepared.problem, "submit");
      try {
        const definition = getLanguageDefinition(prepared.metadata.language);
        const result = await withAuthExpiryHandling(this.auth, () =>
          this.client.submitSolution(
            prepared.problem,
            definition.judgeLanguageSlug,
            prepared.document.getText(),
          )
        );
        this.panels.showResult(prepared.problem, result);
        completion = { accepted: result.accepted, problem: prepared.problem };
      } catch (error) {
        this.panels.showError(prepared.problem, "submit", error);
        void vscode.window.showErrorMessage(errorMessage(error));
      }
    });
    if (completion !== undefined) {
      showCompletionNotification(completion.accepted, "提交");
      try {
        await this.refreshProblemStatus(completion.problem, completion.accepted);
      } catch {
        void vscode.window.showWarningMessage(
          "提交结果已返回，但题目列表状态暂时无法刷新。",
        );
      }
    }
  }

  public reset(): void {
    this.customInputs.clear();
    this.busyUris.clear();
    this.busyEmitter.fire();
    this.panels.close();
  }

  public dispose(): void {
    this.busyEmitter.dispose();
  }

  private async executeTest(uri: vscode.Uri, requestedInput?: string): Promise<void> {
    let accepted: boolean | undefined;
    await this.runLocked(uri, async () => {
      const prepared = await this.prepare(uri, true);
      const testInput = requestedInput ?? defaultTestInput(prepared.problem);
      this.panels.showPending(prepared.problem, "test");
      try {
        const definition = getLanguageDefinition(prepared.metadata.language);
        const result = await withAuthExpiryHandling(this.auth, () =>
          this.client.testSolution(
            prepared.problem,
            definition.judgeLanguageSlug,
            prepared.document.getText(),
            testInput,
          )
        );
        this.panels.showResult(prepared.problem, result);
        accepted = result.accepted;
      } catch (error) {
        this.panels.showError(prepared.problem, "test", error);
        void vscode.window.showErrorMessage(errorMessage(error));
      }
    });
    if (accepted !== undefined) {
      showCompletionNotification(accepted, "测试");
    }
  }

  private async prepare(
    uri: vscode.Uri,
    save: boolean,
  ): Promise<PreparedSolution> {
    const document = await vscode.workspace.openTextDocument(uri);
    if (save && document.isDirty && !(await document.save())) {
      throw new Error("无法保存 solution 文件，操作已取消。");
    }
    const metadata = parseSolutionDocument(
      document.getText(),
      path.basename(document.uri.fsPath),
    );
    if (metadata === undefined) {
      throw new Error(
        "当前文件不是有效的 LeetDock solution 文件，或文件头元数据已被修改。",
      );
    }
    const problem = await withAuthExpiryHandling(this.auth, () =>
      this.problems.openProblem(metadata.titleSlug)
    );
    return { document, metadata, problem };
  }

  private async runLocked(
    uri: vscode.Uri,
    operation: () => Promise<void>,
  ): Promise<void> {
    const key = uri.toString();
    if (this.busyUris.has(key)) {
      await vscode.window.showInformationMessage(
        "该文件已有判题任务正在运行，请等待当前任务完成。",
      );
      return;
    }
    this.busyUris.add(key);
    this.busyEmitter.fire();
    try {
      await operation();
    } finally {
      this.busyUris.delete(key);
      this.busyEmitter.fire();
    }
  }
}

function activeSolutionUri(input: unknown): vscode.Uri | undefined {
  if (input instanceof vscode.Uri) {
    return input;
  }
  return vscode.window.activeTextEditor?.document.uri;
}

async function readMetadata(uri: vscode.Uri): Promise<SolutionMetadata | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  return parseSolutionDocument(document.getText(), path.basename(document.uri.fsPath));
}

function defaultTestInput(problem: ProblemDetail): string {
  return problem.exampleTestcases?.trim() || problem.sampleTestCase?.trim() || "";
}

function showCompletionNotification(
  accepted: boolean,
  action: "测试" | "提交",
): void {
  if (accepted) {
    void vscode.window.showInformationMessage(`${action}通过。`);
  } else {
    void vscode.window.showWarningMessage(`${action}未通过，请查看运行结果。`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && !("kind" in error)
    ? error.message
    : toUserMessage(error);
}
