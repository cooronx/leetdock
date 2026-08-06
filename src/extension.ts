import * as vscode from "vscode";
import { withAuthExpiryHandling } from "./auth/authExpiry";
import { AuthService } from "./auth/authService";
import { AuthStatusBar } from "./auth/authStatusBar";
import {
  openProblemCommand,
  refreshProblemCommand,
  searchProblemCommand,
} from "./commands/problemCommands";
import { SolutionExecutionService } from "./commands/solutionCommands";
import { DailyChallengeCache } from "./daily/dailyChallengeCache";
import { DailyChallengeService } from "./daily/dailyChallengeService";
import { LeetDockTreeProvider } from "./explorer/leetDockTreeProvider";
import { LeetCodeClient } from "./leetcode/client";
import { toUserMessage } from "./leetcode/errors";
import type { ProblemDetail } from "./leetcode/types";
import { ProblemCache } from "./problem/problemCache";
import { ProblemService } from "./problem/problemService";
import { ProblemListService } from "./problemList/problemListService";
import { CacheStorage } from "./storage/cacheStorage";
import { CredentialStore } from "./storage/credentialStore";
import { ProblemPanelManager } from "./webview/problemPanel";
import { ExecutionPanelManager } from "./webview/executionPanel";
import { CodeFileService } from "./workspace/codeFileService";
import { LanguageService } from "./workspace/languageService";
import { SolutionCodeLensProvider } from "./workspace/solutionCodeLensProvider";

export function activate(context: vscode.ExtensionContext): void {
  const credentials = new CredentialStore(context.secrets);
  const cache = new CacheStorage(context.globalState);
  const client = new LeetCodeClient(credentials);
  const auth = new AuthService(context, client, credentials, cache);
  const problemCache = new ProblemCache(cache);
  const problems = new ProblemService(client, problemCache);
  const dailyCache = new DailyChallengeCache(cache);
  const daily = new DailyChallengeService(client, dailyCache);
  const problemLists = new ProblemListService(client);
  const explorer = new LeetDockTreeProvider(auth, problems, daily, problemLists);
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
  const executionPanels = new ExecutionPanelManager(context.extensionUri);
  const executions = new SolutionExecutionService(
    client,
    auth,
    problems,
    executionPanels,
    async (problem, accepted) => {
      const refreshed = await problems.refreshProblem(problem.titleSlug);
      panels.update(refreshed);
      explorer.refresh();
      if (explorer.isDailyChallenge(problem.titleSlug)) {
        try {
          await explorer.refreshDailyChallenge(true);
        } catch {
          // The accepted submission remains valid if daily metadata cannot refresh.
        }
        if (accepted) {
          explorer.markDailyCompleted(problem.titleSlug);
        }
      }
      if (accepted) {
        try {
          await explorer.refreshLoadedProblemListsAfterAccepted(problem.titleSlug);
        } catch {
          // The accepted submission remains valid if problem-list progress cannot refresh.
        }
      }
    },
  );
  const solutionCodeLens = new SolutionCodeLensProvider(executions);
  const treeView = vscode.window.createTreeView("leetdock.explorer", {
    treeDataProvider: explorer,
  });

  context.subscriptions.push(
    auth,
    statusBar,
    panels,
    executionPanels,
    executions,
    explorer,
    treeView,
    treeView.onDidChangeVisibility(({ visible }) => {
      if (visible) {
        void explorer.refreshDailyChallenge(false).catch(() => undefined);
      }
    }),
    auth.registerUserDataCleanup(async () => {
      panels.closeAll();
      executions.reset();
      problemLists.reset();
      await Promise.all([
        problemCache.clearUserData(),
        daily.clearUserData(),
      ]);
    }),
    vscode.languages.registerCodeLensProvider(
      ["cpp", "rust", "python", "java", "typescript"].map((language) => ({
        language,
      })),
      solutionCodeLens,
    ),
    vscode.commands.registerCommand("leetdock.signIn", () =>
      runWithErrorMessage(() => auth.signIn()),
    ),
    vscode.commands.registerCommand("leetdock.signOut", () =>
      runWithErrorMessage(async () => {
        await auth.signOut();
        await vscode.window.showInformationMessage("已退出 LeetDock。");
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
          const dailyState = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Window,
              title: "LeetDock 正在刷新题目、每日挑战与题单…",
              cancellable: false,
            },
            async () => {
              const [, state] = await Promise.all([
                problems.refreshProblemList(),
                explorer.refreshDailyChallenge(true),
                ...(auth.snapshot.status === "signed-in"
                  ? [explorer.refreshMyProblemLists(true)]
                  : []),
              ]);
              return state;
            },
          );
          if (dailyState.warning !== undefined) {
            throw dailyState.warning;
          }
        });
        explorer.refresh();
        await vscode.window.showInformationMessage(
          auth.snapshot.status === "signed-in"
            ? "LeetDock 题目列表、每日挑战和我的题单已刷新。"
            : "LeetDock 题目列表和每日挑战已刷新。",
        );
      }),
    ),
    vscode.commands.registerCommand("leetdock.refreshDailyChallenge", () =>
      runWithErrorMessage(async () => {
        await withAuthExpiryHandling(auth, async () => {
          const state = await explorer.refreshDailyChallenge(true);
          if (state.warning !== undefined) {
            throw state.warning;
          }
        });
      }),
    ),
    vscode.commands.registerCommand("leetdock.refreshMyProblemLists", () =>
      runWithErrorMessage(async () => {
        if (auth.snapshot.status === "offline") {
          const validation = await auth.revalidateAuthentication();
          if (validation === "expired") {
            return;
          }
          if (validation === "unavailable") {
            throw new Error("仍无法连接力扣，请恢复网络后重试。");
          }
        }
        await withAuthExpiryHandling(auth, async () => {
          await explorer.refreshMyProblemLists(true);
        });
      }),
    ),
    vscode.commands.registerCommand("leetdock.refreshMyProblemList", (slug?: unknown) =>
      runWithErrorMessage(() =>
        withAuthExpiryHandling(auth, async () => {
          if (typeof slug === "string") {
            await explorer.refreshMyProblemList(slug);
          }
        })
      ),
    ),
    vscode.commands.registerCommand("leetdock.loadMoreMyProblemList", (slug?: unknown) =>
      runWithErrorMessage(() =>
        withAuthExpiryHandling(auth, async () => {
          if (typeof slug === "string") {
            await explorer.loadMoreMyProblemList(slug);
          }
        })
      ),
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
        await Promise.all([
          problems.clearCache(),
          daily.clearAll(),
        ]);
        explorer.resetDailyChallenge();
        await vscode.window.showInformationMessage("LeetDock 缓存已清除。");
      }),
    ),
    vscode.commands.registerCommand("leetdock.openCode", (input?: unknown) =>
      runWithErrorMessage(async () => {
        const problem = commandProblem(input, panels);
        if (problem === undefined) {
          await vscode.window.showInformationMessage(
            "请先打开一道 LeetDock 题目。",
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
            "请先打开一道 LeetDock 题目。",
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
    vscode.commands.registerCommand("leetdock.testSolution", (input?: unknown) =>
      runWithErrorMessage(() => executions.test(input)),
    ),
    vscode.commands.registerCommand("leetdock.submitSolution", (input?: unknown) =>
      runWithErrorMessage(() => executions.submit(input)),
    ),
    vscode.commands.registerCommand("leetdock.solutionBusy", () =>
      vscode.window.showInformationMessage(
        "该文件已有判题任务正在运行，请等待当前任务完成。",
      ),
    ),
    vscode.window.registerUriHandler({
      handleUri: (uri) =>
        runWithErrorMessage(async () => {
          const user = await auth.handleUri(uri);
          if (user !== undefined) {
            await vscode.window.showInformationMessage(
              `LeetDock 登录成功：${user.username}`,
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
    typeof Reflect.get(value, "internalId") === "string" &&
    typeof Reflect.get(value, "frontendId") === "string" &&
    typeof Reflect.get(value, "titleSlug") === "string" &&
    Array.isArray(Reflect.get(value, "codeSnippets"))
  );
}
