import * as vscode from "vscode";
import {
  REMOTE_AUTH_CHANGED_COMMAND,
  type LocalAuthenticationState,
} from "../../src/bridge/protocol";
import { LeetCodeClient } from "../../src/leetcode/client";
import { LeetCodeError, toUserMessage } from "../../src/leetcode/errors";
import type { UserInfo } from "../../src/leetcode/types";
import {
  CredentialStore,
  normalizeLeetCodeCookie,
} from "../../src/storage/credentialStore";

const CURRENT_USER_KEY = "auth.currentUser";
const PENDING_SIGN_IN_KEY = "auth.pendingSignIn";
const SIGN_IN_WINDOW_MS = 5 * 60 * 1_000;
const MAX_CALLBACK_COOKIE_LENGTH = 16 * 1024;
const MAX_CALLBACK_QUERY_LENGTH = 64 * 1024;

interface PendingSignIn {
  readonly createdAt: number;
  readonly previousUsername?: string;
}

export class LocalAuthenticationController {
  private operationTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: LeetCodeClient,
    private readonly credentials: CredentialStore,
  ) {}

  public getState(): Promise<LocalAuthenticationState> {
    return this.serialize(() => this.getStateInternal());
  }

  public signIn(previousUsername?: string): Promise<void> {
    return this.serialize(() => this.signInInternal(previousUsername));
  }

  public signOut(): Promise<void> {
    return this.serialize(() => this.clearAuthentication());
  }

  public handleUri(uri: vscode.Uri): Promise<UserInfo | undefined> {
    return this.serialize(() => this.handleUriInternal(uri));
  }

  private async getStateInternal(): Promise<LocalAuthenticationState> {
    const [cookie, cachedUser] = await Promise.all([
      this.credentials.getCookie(),
      this.context.globalState.get<UserInfo>(CURRENT_USER_KEY),
    ]);
    if (cookie === undefined) {
      await this.context.globalState.update(CURRENT_USER_KEY, undefined);
      return { status: "signed-out", reason: "missing" };
    }

    try {
      const user = await this.client.getCurrentUser();
      if (!isValidSignedInUser(user)) {
        await this.clearAuthentication();
        return { status: "signed-out", reason: "expired" };
      }
      await this.context.globalState.update(CURRENT_USER_KEY, user);
      return { status: "signed-in", user };
    } catch {
      return {
        status: "offline",
        ...(isValidSignedInUser(cachedUser) ? { user: cachedUser } : {}),
      };
    }
  }

  private async signInInternal(previousUsername?: string): Promise<void> {
    const pending: PendingSignIn = {
      createdAt: Date.now(),
      ...(previousUsername === undefined ? {} : { previousUsername }),
    };
    await this.context.globalState.update(PENDING_SIGN_IN_KEY, pending);
    const authorizationUrl = vscode.Uri.parse(
      `https://leetcode.cn/authorize-login/${encodeURIComponent(vscode.env.uriScheme)}/`,
    ).with({ query: `path=${encodeURIComponent(this.context.extension.id)}` });

    let opened = false;
    try {
      opened = await vscode.env.openExternal(authorizationUrl);
    } catch (error) {
      await this.context.globalState.update(PENDING_SIGN_IN_KEY, undefined);
      throw error;
    }
    if (!opened) {
      await this.context.globalState.update(PENDING_SIGN_IN_KEY, undefined);
      throw new Error("无法打开 LeetDock 登录页面。");
    }
  }

  private async handleUriInternal(uri: vscode.Uri): Promise<UserInfo | undefined> {
    validateCallbackUri(uri, this.context.extension.id);
    const cookie = validateAuthenticationCookie(
      readSingleRawQueryParameter(uri.query, "cookie"),
    );
    const pending = this.context.globalState.get<unknown>(PENDING_SIGN_IN_KEY);
    if (!isPendingSignIn(pending)) {
      await this.context.globalState.update(PENDING_SIGN_IN_KEY, undefined);
      throw new Error("登录请求已过期，请重新执行 Sign In。");
    }
    const currentUser = this.context.globalState.get<UserInfo>(CURRENT_USER_KEY);
    if (pending.previousUsername !== currentUser?.username) {
      await this.context.globalState.update(PENDING_SIGN_IN_KEY, undefined);
      throw new Error("登录状态已发生变化，请重新执行 Sign In。");
    }
    await this.context.globalState.update(PENDING_SIGN_IN_KEY, undefined);

    const previousCookie = await this.credentials.getCookie();
    const user = await this.client.verifyCookie(cookie);
    if (!isValidSignedInUser(user)) {
      throw new LeetCodeError("authentication", "LeetDock rejected the callback cookie.");
    }

    const confirmationMessage = pending.previousUsername !== undefined &&
        pending.previousUsername !== user.username
      ? `即将把 LeetDock 账号从 ${pending.previousUsername} 切换为 ${user.username}。是否确认？`
      : `即将登录 LeetDock 账号：${user.username}。是否确认？`;
    const confirmed = await vscode.window.showWarningMessage(
      confirmationMessage,
      { modal: true },
      "确认登录",
    );
    if (confirmed !== "确认登录") {
      return undefined;
    }

    try {
      await this.credentials.storeCookie(cookie);
      await this.context.globalState.update(CURRENT_USER_KEY, user);
    } catch (error) {
      if (previousCookie === undefined) {
        await this.credentials.deleteCookie();
      } else {
        await this.credentials.storeCookie(previousCookie);
      }
      if (currentUser === undefined) {
        await this.context.globalState.update(CURRENT_USER_KEY, undefined);
      } else {
        await this.context.globalState.update(CURRENT_USER_KEY, currentUser);
      }
      throw error;
    }

    await vscode.commands.executeCommand(REMOTE_AUTH_CHANGED_COMMAND, user);
    return user;
  }

  private async clearAuthentication(): Promise<void> {
    await Promise.all([
      this.credentials.deleteCookie(),
      this.context.globalState.update(CURRENT_USER_KEY, undefined),
      this.context.globalState.update(PENDING_SIGN_IN_KEY, undefined),
    ]);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function handleAuthenticationUri(
  controller: LocalAuthenticationController,
  uri: vscode.Uri,
): Promise<void> {
  try {
    const user = await controller.handleUri(uri);
    if (user !== undefined) {
      await vscode.window.showInformationMessage(
        `LeetDock 登录成功：${user.username}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error && !(error instanceof LeetCodeError)
      ? error.message
      : toUserMessage(error);
    await vscode.window.showErrorMessage(message);
  }
}

function validateCallbackUri(uri: vscode.Uri, extensionId: string): void {
  if (
    uri.scheme !== vscode.env.uriScheme ||
    uri.authority !== extensionId ||
    (uri.path !== "" && uri.path !== "/") ||
    uri.fragment !== ""
  ) {
    throw new Error("收到的登录回调地址无效。");
  }
  if (uri.query.length > MAX_CALLBACK_QUERY_LENGTH) {
    throw new Error("登录回调参数过大。");
  }
}

function readSingleRawQueryParameter(query: string, target: string): string {
  let result: string | undefined;
  let matches = 0;
  for (const part of query.split("&")) {
    const separator = part.indexOf("=");
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    const rawValue = separator === -1 ? "" : part.slice(separator + 1);
    let key: string;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      continue;
    }
    if (key !== target) {
      continue;
    }
    matches += 1;
    if (matches > 1) {
      throw new Error(`登录回调包含重复的 ${target} 参数。`);
    }
    try {
      result = decodeURIComponent(rawValue);
    } catch {
      throw new Error("登录回调中的 Cookie 编码无效。");
    }
  }
  if (result === undefined) {
    throw new Error("登录回调中缺少 Cookie。");
  }
  return result;
}

function validateAuthenticationCookie(value: string): string {
  const cookie = normalizeLeetCodeCookie(value);
  if (cookie.length > MAX_CALLBACK_COOKIE_LENGTH) {
    throw new Error("登录回调中的 Cookie 过大。");
  }
  if (!hasCookie(cookie, "LEETCODE_SESSION") || !hasCookie(cookie, "csrftoken")) {
    throw new Error("登录回调中的 Cookie 不完整，请重新登录。");
  }
  return cookie;
}

function hasCookie(cookie: string, name: string): boolean {
  return cookie.split(";").some((part) => {
    const separator = part.indexOf("=");
    return separator > 0 &&
      part.slice(0, separator).trim() === name &&
      part.slice(separator + 1).trim().length > 0;
  });
}

function isPendingSignIn(value: unknown): value is PendingSignIn {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const createdAt = Reflect.get(value, "createdAt");
  const previousUsername = Reflect.get(value, "previousUsername");
  const age = typeof createdAt === "number" ? Date.now() - createdAt : Number.NaN;
  return Number.isFinite(age) &&
    age >= 0 &&
    age <= SIGN_IN_WINDOW_MS &&
    (previousUsername === undefined || typeof previousUsername === "string");
}

function isValidSignedInUser(user: UserInfo | undefined): user is UserInfo {
  return user?.isSignedIn === true && user.username.trim().length > 0;
}
