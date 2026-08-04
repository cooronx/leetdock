import * as vscode from "vscode";
import { AuthService } from "./auth/authService";
import { AuthStatusBar } from "./auth/authStatusBar";
import {
  openProblemCommand,
  refreshProblemCommand,
  searchProblemCommand,
} from "./commands/problemCommands";
import { LeetCodeClient } from "./leetcode/client";
import { LeetCodeError, toUserMessage } from "./leetcode/errors";
import { ProblemCache } from "./problem/problemCache";
import { ProblemService } from "./problem/problemService";
import { CacheStorage } from "./storage/cacheStorage";
import { CredentialStore } from "./storage/credentialStore";
import { ProblemPanelManager } from "./webview/problemPanel";

export function activate(context: vscode.ExtensionContext): void {
  const credentials = new CredentialStore(context.secrets);
  const cache = new CacheStorage(context.globalState);
  const client = new LeetCodeClient(credentials);
  const auth = new AuthService(context, client, credentials, cache);
  const problemCache = new ProblemCache(cache);
  const problems = new ProblemService(client, problemCache);
  const panels = new ProblemPanelManager(context.extensionUri, {
    openCode: async (problem, panel) => {
      panel.reveal(panel.viewColumn, false);
      await vscode.commands.executeCommand("leetdock.openCode", problem, panel);
    },
    switchLanguage: async (problem, panel) => {
      panel.reveal(panel.viewColumn, false);
      await vscode.commands.executeCommand("leetdock.switchLanguage", problem, panel);
    },
    refresh: (problem) =>
      withAuthExpiryHandling(auth, () => problems.refreshProblem(problem.titleSlug)),
  });
  const statusBar = new AuthStatusBar(auth);

  context.subscriptions.push(
    auth,
    statusBar,
    panels,
    auth.registerUserDataCleanup(() => problemCache.clearUserData()),
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
      runWithErrorMessage(() =>
        withAuthExpiryHandling(auth, () => openProblemCommand(problems, panels, input)),
      ),
    ),
    vscode.commands.registerCommand("leetdock.searchProblem", () =>
      runWithErrorMessage(() =>
        withAuthExpiryHandling(auth, () => searchProblemCommand(problems, panels)),
      ),
    ),
    vscode.commands.registerCommand("leetdock.refreshProblem", () =>
      runWithErrorMessage(() =>
        withAuthExpiryHandling(auth, () => refreshProblemCommand(panels)),
      ),
    ),
    vscode.window.registerUriHandler({
      handleUri: (uri) =>
        runWithErrorMessage(async () => {
          const user = await auth.handleUri(uri);
          await vscode.window.showInformationMessage(
            `LeetCode CN 登录成功：${user.username}`,
          );
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
