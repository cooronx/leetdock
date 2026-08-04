import * as vscode from "vscode";
import { AuthService } from "./auth/authService";
import { AuthStatusBar } from "./auth/authStatusBar";
import { LeetCodeClient } from "./leetcode/client";
import { toUserMessage } from "./leetcode/errors";
import { CacheStorage } from "./storage/cacheStorage";
import { CredentialStore } from "./storage/credentialStore";

export function activate(context: vscode.ExtensionContext): void {
  const credentials = new CredentialStore(context.secrets);
  const cache = new CacheStorage(context.globalState);
  const client = new LeetCodeClient(credentials);
  const auth = new AuthService(context, client, credentials, cache);
  const statusBar = new AuthStatusBar(auth);

  context.subscriptions.push(
    auth,
    statusBar,
    vscode.commands.registerCommand("leetdock.signIn", () =>
      runWithErrorMessage(() => auth.signIn()),
    ),
    vscode.commands.registerCommand("leetdock.signOut", () =>
      runWithErrorMessage(async () => {
        await auth.signOut();
        await vscode.window.showInformationMessage("已退出 LeetCode CN。");
      }),
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
