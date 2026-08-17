import * as vscode from "vscode";
import {
  bridgeFailure,
  bridgeSuccess,
  LOCAL_AUTH_SIGN_IN_COMMAND,
  LOCAL_AUTH_SIGN_OUT_COMMAND,
  LOCAL_AUTH_STATE_COMMAND,
  LOCAL_NETWORK_COMMAND,
} from "../../src/bridge/protocol";
import { LeetCodeClient } from "../../src/leetcode/client";
import { CredentialStore } from "../../src/storage/credentialStore";
import {
  handleAuthenticationUri,
  LocalAuthenticationController,
} from "./authController";
import { dispatchNetworkRequest } from "./networkDispatcher";

export function activate(context: vscode.ExtensionContext): void {
  const credentials = new CredentialStore(context.secrets);
  const client = new LeetCodeClient(credentials);
  const authentication = new LocalAuthenticationController(
    context,
    client,
    credentials,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(LOCAL_NETWORK_COMMAND, (request: unknown) =>
      bridgeOperation(() => dispatchNetworkRequest(client, request))),
    vscode.commands.registerCommand(LOCAL_AUTH_STATE_COMMAND, () =>
      bridgeOperation(() => authentication.getState())),
    vscode.commands.registerCommand(
      LOCAL_AUTH_SIGN_IN_COMMAND,
      (previousUsername?: unknown) =>
        bridgeOperation(() => authentication.signIn(asOptionalString(previousUsername))),
    ),
    vscode.commands.registerCommand(LOCAL_AUTH_SIGN_OUT_COMMAND, () =>
      bridgeOperation(() => authentication.signOut())),
    vscode.window.registerUriHandler({
      handleUri: (uri) => handleAuthenticationUri(authentication, uri),
    }),
  );
}

export function deactivate(): void {
  // VS Code disposes extension subscriptions during deactivation.
}

async function bridgeOperation<T>(operation: () => Promise<T>) {
  try {
    return bridgeSuccess(await operation());
  } catch (error) {
    return bridgeFailure(error);
  }
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("LeetDock sign-in expected a username.");
  }
  return value;
}
