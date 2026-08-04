import * as vscode from "vscode";
import { LeetCodeClient } from "../leetcode/client";
import { LeetCodeError } from "../leetcode/errors";
import type { UserInfo } from "../leetcode/types";
import { CacheStorage } from "../storage/cacheStorage";
import {
  CredentialStore,
  normalizeLeetCodeCookie,
} from "../storage/credentialStore";

const CURRENT_USER_KEY = "auth.currentUser";
const PENDING_SIGN_IN_KEY = "auth.pendingSignIn";
const SIGN_IN_WINDOW_MS = 5 * 60 * 1_000;
const MAX_CALLBACK_COOKIE_LENGTH = 16 * 1024;
const MAX_CALLBACK_QUERY_LENGTH = 64 * 1024;

interface PendingSignIn {
  readonly createdAt: number;
  readonly previousUsername?: string;
}

export type AuthStatus = "offline" | "signed-in" | "signed-out" | "verifying";

export interface AuthSnapshot {
  readonly status: AuthStatus;
  readonly user?: UserInfo;
}

export type AuthenticationValidation = "expired" | "unavailable" | "valid";

export class AuthService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<AuthSnapshot>();
  private snapshotValue: AuthSnapshot = { status: "verifying" };
  private operationTail: Promise<void> = Promise.resolve();
  private authenticationProbe: Promise<AuthenticationValidation> | undefined;
  private readonly userDataCleanupHandlers = new Set<() => Promise<void>>();

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: LeetCodeClient,
    private readonly credentials: CredentialStore,
    private readonly cache: CacheStorage,
  ) {}

  public readonly onDidChange = this.changeEmitter.event;

  public get snapshot(): AuthSnapshot {
    return this.snapshotValue;
  }

  public registerUserDataCleanup(handler: () => Promise<void>): vscode.Disposable {
    this.userDataCleanupHandlers.add(handler);
    return new vscode.Disposable(() => this.userDataCleanupHandlers.delete(handler));
  }

  public async initialize(): Promise<void> {
    return this.serialize(() => this.initializeInternal());
  }

  public async signIn(): Promise<void> {
    return this.serialize(() => this.signInInternal());
  }

  public async handleUri(uri: vscode.Uri): Promise<UserInfo | undefined> {
    return this.serialize(() => this.handleUriInternal(uri));
  }

  public async signOut(): Promise<void> {
    return this.serialize(() => this.signOutInternal());
  }

  public revalidateAuthentication(): Promise<AuthenticationValidation> {
    const existing = this.authenticationProbe;
    if (existing !== undefined) {
      return existing;
    }

    const probe = this.serialize(() => this.revalidateAuthenticationInternal());
    this.authenticationProbe = probe;
    void probe.then(
      () => this.releaseAuthenticationProbe(probe),
      () => this.releaseAuthenticationProbe(probe),
    );
    return probe;
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }

  private async initializeInternal(): Promise<void> {
    const [cookie, cachedUser] = await Promise.all([
      this.credentials.getCookie(),
      this.cache.get<UserInfo>(CURRENT_USER_KEY),
    ]);

    if (cookie === undefined) {
      await Promise.all([
        this.cache.delete(CURRENT_USER_KEY),
        ...[...this.userDataCleanupHandlers].map((handler) => handler()),
      ]);
      this.update({ status: "signed-out" });
      return;
    }

    this.update({
      status: "verifying",
      ...(cachedUser?.isSignedIn === true ? { user: cachedUser } : {}),
    });

    try {
      const user = await this.client.getCurrentUser();
      if (user.isSignedIn === false) {
        await this.clearAuthentication();
        this.update({ status: "signed-out" });
        await vscode.window.showWarningMessage("LeetCode 登录已过期，请重新登录。");
        return;
      }
      if (user.username.trim().length === 0) {
        throw new LeetCodeError(
          "invalid-response",
          "Signed-in current user response did not include a username.",
        );
      }

      await this.cache.set(CURRENT_USER_KEY, user);
      this.update({ status: "signed-in", user });
    } catch {
      this.update({
        status: "offline",
        ...(cachedUser?.isSignedIn === true ? { user: cachedUser } : {}),
      });
    }
  }

  private async signInInternal(): Promise<void> {
    const pending: PendingSignIn = {
      createdAt: Date.now(),
      ...(this.snapshotValue.user?.username === undefined
        ? {}
        : { previousUsername: this.snapshotValue.user.username }),
    };
    await this.cache.set(PENDING_SIGN_IN_KEY, pending, SIGN_IN_WINDOW_MS);
    const authorizationUrl = vscode.Uri.parse(
      `https://leetcode.cn/authorize-login/${encodeURIComponent(vscode.env.uriScheme)}/`,
    ).with({ query: `path=${encodeURIComponent(this.context.extension.id)}` });

    let opened = false;
    try {
      opened = await vscode.env.openExternal(authorizationUrl);
    } catch (error) {
      await this.cache.delete(PENDING_SIGN_IN_KEY);
      throw error;
    }
    if (!opened) {
      await this.cache.delete(PENDING_SIGN_IN_KEY);
      throw new Error("无法打开 LeetCode 登录页面。");
    }
  }

  private async handleUriInternal(uri: vscode.Uri): Promise<UserInfo | undefined> {
    if (
      uri.scheme !== vscode.env.uriScheme ||
      uri.authority !== this.context.extension.id ||
      (uri.path !== "" && uri.path !== "/") ||
      uri.fragment !== ""
    ) {
      throw new Error("收到的登录回调地址无效。");
    }
    if (uri.query.length > MAX_CALLBACK_QUERY_LENGTH) {
      throw new Error("登录回调参数过大。");
    }

    const cookie = validateAuthenticationCookie(
      readSingleRawQueryParameter(uri.query, "cookie"),
    );
    const pendingValue = await this.cache.get<unknown>(PENDING_SIGN_IN_KEY);
    if (!isPendingSignIn(pendingValue)) {
      await this.cache.delete(PENDING_SIGN_IN_KEY);
      throw new Error("登录请求已过期，请重新执行 Sign In。");
    }
    if (pendingValue.previousUsername !== this.snapshotValue.user?.username) {
      await this.cache.delete(PENDING_SIGN_IN_KEY);
      throw new Error("登录状态已发生变化，请重新执行 Sign In。");
    }
    await this.cache.delete(PENDING_SIGN_IN_KEY);

    const previousCookie = await this.credentials.getCookie();
    const previousSnapshot = this.snapshotValue;
    this.update({
      status: "verifying",
      ...(previousSnapshot.user === undefined ? {} : { user: previousSnapshot.user }),
    });

    let user: UserInfo;
    try {
      user = await this.client.verifyCookie(cookie);
    } catch (error) {
      this.update(previousSnapshot);
      throw error;
    }
    if (user.isSignedIn === false) {
      this.update(previousSnapshot);
      throw new LeetCodeError("authentication", "LeetCode rejected the callback cookie.");
    }
    if (user.username.trim().length === 0) {
      this.update(previousSnapshot);
      throw new LeetCodeError(
        "invalid-response",
        "Signed-in current user response did not include a username.",
      );
    }

    const previousUsername = previousSnapshot.user?.username;
    const confirmationMessage =
      previousUsername !== undefined && previousUsername !== user.username
        ? `即将把 LeetCode CN 账号从 ${previousUsername} 切换为 ${user.username}。是否确认？`
        : `即将登录 LeetCode CN 账号：${user.username}。是否确认？`;
    const confirmed = await vscode.window.showWarningMessage(
      confirmationMessage,
      { modal: true },
      "确认登录",
    );
    if (confirmed !== "确认登录") {
      this.update(previousSnapshot);
      return undefined;
    }

    try {
      if (previousSnapshot.user?.username !== user.username) {
        await Promise.all(
          [...this.userDataCleanupHandlers].map((handler) => handler()),
        );
      }
      await this.credentials.storeCookie(cookie);
      await this.cache.set(CURRENT_USER_KEY, user);
    } catch (error) {
      if (previousCookie === undefined) {
        await this.credentials.deleteCookie();
      } else {
        await this.credentials.storeCookie(previousCookie);
      }
      if (previousSnapshot.user === undefined) {
        await this.cache.delete(CURRENT_USER_KEY);
      } else {
        await this.cache.set(CURRENT_USER_KEY, previousSnapshot.user);
      }
      this.update(previousSnapshot);
      throw error;
    }
    this.update({ status: "signed-in", user });
    return user;
  }

  private async signOutInternal(): Promise<void> {
    await this.clearAuthentication();
    this.update({ status: "signed-out" });
  }

  private async revalidateAuthenticationInternal(): Promise<AuthenticationValidation> {
    const cookie = await this.credentials.getCookie();
    if (cookie === undefined) {
      try {
        await this.clearAuthentication();
        this.update({ status: "signed-out" });
        return "expired";
      } catch {
        this.update({ status: "offline" });
        return "unavailable";
      }
    }

    const cachedUser = this.snapshotValue.user ??
      await this.cache.get<UserInfo>(CURRENT_USER_KEY);
    try {
      const user = await this.client.getCurrentUser();
      if (user.isSignedIn === false) {
        await this.clearAuthentication();
        this.update({ status: "signed-out" });
        return "expired";
      }
      if (user.username.trim().length === 0) {
        throw new LeetCodeError(
          "invalid-response",
          "Signed-in current user response did not include a username.",
        );
      }
      await this.cache.set(CURRENT_USER_KEY, user);
      this.update({ status: "signed-in", user });
      return "valid";
    } catch {
      this.update({
        status: "offline",
        ...(cachedUser?.isSignedIn === true ? { user: cachedUser } : {}),
      });
      return "unavailable";
    }
  }

  private async clearAuthentication(): Promise<void> {
    await Promise.all([
      this.credentials.deleteCookie(),
      this.cache.delete(CURRENT_USER_KEY),
      this.cache.delete(PENDING_SIGN_IN_KEY),
      ...[...this.userDataCleanupHandlers].map((handler) => handler()),
    ]);
  }

  private update(snapshot: AuthSnapshot): void {
    this.snapshotValue = snapshot;
    this.changeEmitter.fire(snapshot);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private releaseAuthenticationProbe(
    probe: Promise<AuthenticationValidation>,
  ): void {
    if (this.authenticationProbe === probe) {
      this.authenticationProbe = undefined;
    }
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
    return (
      separator > 0 &&
      part.slice(0, separator).trim() === name &&
      part.slice(separator + 1).trim().length > 0
    );
  });
}

function isPendingSignIn(value: unknown): value is PendingSignIn {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const createdAt = Reflect.get(value, "createdAt");
  const previousUsername = Reflect.get(value, "previousUsername");
  const age = typeof createdAt === "number" ? Date.now() - createdAt : Number.NaN;
  return (
    Number.isFinite(age) &&
    age >= 0 &&
    age <= SIGN_IN_WINDOW_MS &&
    (previousUsername === undefined || typeof previousUsername === "string")
  );
}
