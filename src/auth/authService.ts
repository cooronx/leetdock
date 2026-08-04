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
const SIGN_IN_WINDOW_MS = 15 * 60 * 1_000;

export type AuthStatus = "offline" | "signed-in" | "signed-out" | "verifying";

export interface AuthSnapshot {
  readonly status: AuthStatus;
  readonly user?: UserInfo;
}

export class AuthService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<AuthSnapshot>();
  private snapshotValue: AuthSnapshot = { status: "verifying" };
  private operationTail: Promise<void> = Promise.resolve();

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

  public async initialize(): Promise<void> {
    return this.serialize(() => this.initializeInternal());
  }

  public async signIn(): Promise<void> {
    return this.serialize(() => this.signInInternal());
  }

  public async handleUri(uri: vscode.Uri): Promise<UserInfo> {
    return this.serialize(() => this.handleUriInternal(uri));
  }

  public async signOut(): Promise<void> {
    return this.serialize(() => this.signOutInternal());
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
      await this.cache.delete(CURRENT_USER_KEY);
      this.update({ status: "signed-out" });
      return;
    }

    this.update({
      status: "verifying",
      ...(cachedUser?.isSignedIn === true ? { user: cachedUser } : {}),
    });

    try {
      const user = await this.client.getCurrentUser();
      if (!user.isSignedIn || user.username.length === 0) {
        await this.clearAuthentication();
        this.update({ status: "signed-out" });
        await vscode.window.showWarningMessage("LeetCode 登录已过期，请重新登录。");
        return;
      }

      await this.cache.set(CURRENT_USER_KEY, user);
      this.update({ status: "signed-in", user });
    } catch (error) {
      if (error instanceof LeetCodeError && error.kind === "authentication") {
        await this.clearAuthentication();
        this.update({ status: "signed-out" });
        await vscode.window.showWarningMessage("LeetCode 登录已过期，请重新登录。");
        return;
      }

      this.update({
        status: "offline",
        ...(cachedUser?.isSignedIn === true ? { user: cachedUser } : {}),
      });
    }
  }

  private async signInInternal(): Promise<void> {
    await this.cache.set(PENDING_SIGN_IN_KEY, true, SIGN_IN_WINDOW_MS);
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

  private async handleUriInternal(uri: vscode.Uri): Promise<UserInfo> {
    if (uri.scheme !== vscode.env.uriScheme || uri.authority !== this.context.extension.id) {
      throw new Error("收到的登录回调地址无效。");
    }

    const pending = await this.cache.get<boolean>(PENDING_SIGN_IN_KEY);
    if (pending !== true) {
      throw new Error("登录请求已过期，请重新执行 Sign In。");
    }
    await this.cache.delete(PENDING_SIGN_IN_KEY);

    const cookie = normalizeLeetCodeCookie(readRawQueryParameter(uri.query, "cookie"));
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
    if (!user.isSignedIn || user.username.length === 0) {
      this.update(previousSnapshot);
      throw new LeetCodeError("authentication", "LeetCode rejected the callback cookie.");
    }

    await this.credentials.storeCookie(cookie);
    await this.cache.set(CURRENT_USER_KEY, user);
    this.update({ status: "signed-in", user });
    return user;
  }

  private async signOutInternal(): Promise<void> {
    await this.clearAuthentication();
    this.update({ status: "signed-out" });
  }

  private async clearAuthentication(): Promise<void> {
    await Promise.all([
      this.credentials.deleteCookie(),
      this.cache.delete(CURRENT_USER_KEY),
      this.cache.delete(PENDING_SIGN_IN_KEY),
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

}

function readRawQueryParameter(query: string, target: string): string {
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
    try {
      return decodeURIComponent(rawValue);
    } catch {
      throw new Error("登录回调中的 Cookie 编码无效。");
    }
  }
  throw new Error("登录回调中缺少 Cookie。");
}
