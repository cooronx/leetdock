import * as vscode from "vscode";
import { AuthService } from "./auth/authService";
import { AuthStatusBar } from "./auth/authStatusBar";
import {
  openProblemCommand,
  refreshProblemCommand,
  searchProblemCommand,
} from "./commands/problemCommands";
import { LeetDockTreeProvider } from "./explorer/leetDockTreeProvider";
import { LeetCodeClient } from "./leetcode/client";
import { LeetCodeError, toUserMessage } from "./leetcode/errors";
import type { ProblemDetail } from "./leetcode/types";
import { ProblemCache } from "./problem/problemCache";
import { ProblemService } from "./problem/problemService";
import { CacheStorage } from "./storage/cacheStorage";
import { CredentialStore } from "./storage/credentialStore";
import { ProblemPanelManager } from "./webview/problemPanel";
import { CodeFileService } from "./workspace/codeFileService";
import { LanguageService } from "./workspace/languageService";

export function activate(context: vscode.ExtensionContext): void {
  const credentials = new CredentialStore(context.secrets);
  const cache = new CacheStorage(context.globalState);
  const client = new LeetCodeClient(credentials);
  const auth = new AuthService(context, client, credentials, cache);
  const problemCache = new ProblemCache(cache);
  const problems = new ProblemService(client, problemCache);
  const explorer = new LeetDockTreeProvider(auth, problems);
  const languages = new LanguageService();
  const codeFiles = new CodeFileService(context, languages);
  const panels = new ProblemPanelManager(context.extensionUri, {
    openCode: async (problem, panel) => {
      panel.reveal(panel.viewColumn, false);
      await vscode.commands.executeCommand("leetdock.openCode", problem, panel);
    },
    switchLanguage: async (problem, panel) => {
      panel.reveal(panel.viewColumn, false);
      await vscode.commands.executeCommand("leetdock.switchLanguage", problem, panel);
    },
    refresh: async (problem) => {
      const detail = await withAuthExpiryHandling(auth, () =>
        problems.refreshProblem(problem.titleSlug),
      );
      explorer.refresh();
      return detail;
    },
  });
  const statusBar = new AuthStatusBar(auth);

  context.subscriptions.push(
    auth,
    statusBar,
    panels,
    explorer,
    vscode.window.registerTreeDataProvider("leetdock.explorer", explorer),
    auth.registerUserDataCleanup(async () => {
      panels.closeAll();
      await problemCache.clearUserData();
    }),
    vscode.commands.registerCommand("leetdock.signIn", () =>
      runWithErrorMessage(() => auth.signIn()),
    ),
    vscode.commands.registerCommand("leetdock.signOut", () =>
      runWithErrorMessage(async () => {
        await auth.signOut();
        await vscode.window.showInformationMessage("已退出 LeetCode CN。");
      }),
    ),
    vscode.commands.registerCommand("leetdock.openProblem", (input?: unknown) =>
      runWithErrorMessage(async () => {
        await withAuthExpiryHandling(auth, () =>
          openProblemCommand(problems, panels, input),
        );
        explorer.refresh();
      }),
    ),
    vscode.commands.registerCommand("leetdock.searchProblem", () =>
      runWithErrorMessage(async () => {
        await withAuthExpiryHandling(auth, () =>
          searchProblemCommand(problems, panels),
        );
        explorer.refresh();
      }),
    ),
    vscode.commands.registerCommand("leetdock.refreshProblem", () =>
      runWithErrorMessage(async () => {
        await withAuthExpiryHandling(auth, () => refreshProblemCommand(panels));
        explorer.refresh();
      }),
    ),
    vscode.commands.registerCommand("leetdock.refreshProblemList", () =>
      runWithErrorMessage(async () => {
        await withAuthExpiryHandling(auth, async () => {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Window,
              title: "LeetDock 正在刷新题目列表…",
              cancellable: false,
            },
            () => problems.refreshProblemList(),
          );
        });
        explorer.refresh();
        await vscode.window.showInformationMessage("LeetCode CN 题目列表已刷新。");
      }),
    ),
    vscode.commands.registerCommand("leetdock.clearCache", () =>
      runWithErrorMessage(async () => {
        const confirmed = await vscode.window.showWarningMessage(
          "确定清除 LeetDock 的题目缓存和最近打开记录吗？登录状态、默认语言和代码目录不会改变。",
          { modal: true },
          "清除",
        );
        if (confirmed !== "清除") {
          return;
        }
        await problems.clearCache();
        explorer.refresh();
        await vscode.window.showInformationMessage("LeetDock 缓存已清除。");
      }),
    ),
    vscode.commands.registerCommand("leetdock.openCode", (input?: unknown) =>
      runWithErrorMessage(async () => {
        const problem = commandProblem(input, panels);
        if (problem === undefined) {
          await vscode.window.showInformationMessage(
            "请先打开一道 LeetCode CN 题目。",
          );
          return;
        }
        panels.reveal(problem.titleSlug);
        await codeFiles.open(problem);
      }),
    ),
    vscode.commands.registerCommand("leetdock.switchLanguage", (input?: unknown) =>
      runWithErrorMessage(async () => {
        const problem = commandProblem(input, panels);
        if (problem === undefined) {
          await vscode.window.showInformationMessage(
            "请先打开一道 LeetCode CN 题目。",
          );
          return;
        }
        panels.reveal(problem.titleSlug);
        const language = await languages.pickLanguage(
          languages.getConfiguredLanguage(),
        );
        if (language !== undefined) {
          await codeFiles.open(problem, language);
        }
      }),
    ),
    vscode.window.registerUriHandler({
      handleUri: (uri) =>
        runWithErrorMessage(async () => {
          const user = await auth.handleUri(uri);
          if (user !== undefined) {
            await vscode.window.showInformationMessage(
              `LeetCode CN 登录成功：${user.username}`,
            );
          }
        }),
    }),
  );

  void runWithErrorMessage(() => auth.initialize());
}

export function deactivate(): void {
  // VS Code disposes extension subscriptions during deactivation.
}

async function runWithErrorMessage(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error && !("kind" in error)
      ? error.message
      : toUserMessage(error);
    await vscode.window.showErrorMessage(message);
  }
}

async function withAuthExpiryHandling<T>(
  auth: AuthService,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LeetCodeError && error.kind === "authentication") {
      await auth.signOut();
    }
    throw error;
  }
}

function commandProblem(
  input: unknown,
  panels: ProblemPanelManager,
): ProblemDetail | undefined {
  if (isProblemDetail(input)) {
    return input;
  }
  return panels.getActiveProblem();
}

function isProblemDetail(
  value: unknown,
): value is ProblemDetail {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "frontendId") === "string" &&
    typeof Reflect.get(value, "titleSlug") === "string" &&
    Array.isArray(Reflect.get(value, "codeSnippets"))
  );
}
