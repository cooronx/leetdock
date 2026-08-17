import * as vscode from "vscode";
import type { UserInfo } from "../leetcode/types";
import {
  executeBridgeCommand,
  LOCAL_AUTH_SIGN_IN_COMMAND,
  LOCAL_AUTH_SIGN_OUT_COMMAND,
  LOCAL_AUTH_STATE_COMMAND,
  type CommandExecutor,
  type LocalAuthenticationState,
} from "../bridge/protocol";

export interface AuthenticationBridge {
  getState(): Promise<LocalAuthenticationState>;
  signIn(previousUsername?: string): Promise<void>;
  signOut(): Promise<void>;
}

export class LocalAuthBridge implements AuthenticationBridge {
  public constructor(
    private readonly execute: CommandExecutor = (command, argument) =>
      vscode.commands.executeCommand(command, argument),
  ) {}

  public async getState(): Promise<LocalAuthenticationState> {
    const state = await executeBridgeCommand<LocalAuthenticationState>(
      this.execute,
      LOCAL_AUTH_STATE_COMMAND,
    );
    if (!isAuthenticationState(state)) {
      throw new Error("LeetDock local authentication returned an invalid state.");
    }
    return state;
  }

  public signIn(previousUsername?: string): Promise<void> {
    return executeBridgeCommand<void>(
      this.execute,
      LOCAL_AUTH_SIGN_IN_COMMAND,
      previousUsername,
    );
  }

  public signOut(): Promise<void> {
    return executeBridgeCommand<void>(this.execute, LOCAL_AUTH_SIGN_OUT_COMMAND);
  }
}

function isAuthenticationState(value: unknown): value is LocalAuthenticationState {
  if (!isRecord(value) || typeof value.status !== "string") {
    return false;
  }
  if (value.status === "signed-out") {
    return true;
  }
  if (value.status === "signed-in") {
    return isUserInfo(value.user) && value.user.isSignedIn;
  }
  return value.status === "offline" &&
    (value.user === undefined || isUserInfo(value.user));
}

function isUserInfo(value: unknown): value is UserInfo {
  return isRecord(value) &&
    typeof value.isSignedIn === "boolean" &&
    typeof value.username === "string" &&
    typeof value.isPremium === "boolean" &&
    (value.avatar === undefined || typeof value.avatar === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
