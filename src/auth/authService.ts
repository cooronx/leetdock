import * as vscode from "vscode";
import type { LocalAuthenticationState } from "../bridge/protocol";
import type { UserInfo } from "../leetcode/types";
import { CacheStorage } from "../storage/cacheStorage";
import type { AuthenticationBridge } from "./localAuthBridge";

const CURRENT_USER_KEY = "auth.currentUser";

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
    private readonly bridge: AuthenticationBridge,
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

  public initialize(): Promise<void> {
    return this.serialize(() => this.initializeInternal());
  }

  public signIn(): Promise<void> {
    return this.serialize(() => this.bridge.signIn(this.snapshotValue.user?.username));
  }

  public acceptAuthenticatedUser(value: unknown): Promise<void> {
    return this.serialize(() => this.acceptAuthenticatedUserInternal(value));
  }

  public signOut(): Promise<void> {
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
    const cachedUser = await this.cache.get<UserInfo>(CURRENT_USER_KEY);
    this.update({
      status: "verifying",
      ...(isSignedInUser(cachedUser) ? { user: cachedUser } : {}),
    });

    let state: LocalAuthenticationState;
    try {
      state = await this.bridge.getState();
    } catch {
      this.update({
        status: "offline",
        ...(isSignedInUser(cachedUser) ? { user: cachedUser } : {}),
      });
      return;
    }
    await this.applyState(state, cachedUser);
    if (state.status === "signed-out" && state.reason === "expired") {
      await vscode.window.showWarningMessage("LeetDock 登录已过期，请重新登录。");
    }
  }

  private async acceptAuthenticatedUserInternal(value: unknown): Promise<void> {
    if (!isSignedInUser(value)) {
      throw new Error("LeetDock 本地网络组件返回了无效的登录用户。");
    }
    const previousSnapshot = this.snapshotValue;
    this.update({ status: "verifying", ...(previousSnapshot.user === undefined
      ? {}
      : { user: previousSnapshot.user }) });
    try {
      if (previousSnapshot.user?.username !== value.username) {
        await this.runUserDataCleanup();
      }
      await this.cache.set(CURRENT_USER_KEY, value);
      this.update({ status: "signed-in", user: value });
    } catch (error) {
      this.update(previousSnapshot);
      throw error;
    }
  }

  private async signOutInternal(): Promise<void> {
    await this.bridge.signOut();
    await this.clearRemoteAuthentication();
    this.update({ status: "signed-out" });
  }

  private async revalidateAuthenticationInternal(): Promise<AuthenticationValidation> {
    const cachedUser = this.snapshotValue.user ??
      await this.cache.get<UserInfo>(CURRENT_USER_KEY);
    let state: LocalAuthenticationState;
    try {
      state = await this.bridge.getState();
    } catch {
      this.update({
        status: "offline",
        ...(isSignedInUser(cachedUser) ? { user: cachedUser } : {}),
      });
      return "unavailable";
    }
    await this.applyState(state, cachedUser);
    if (state.status === "signed-in") {
      return "valid";
    }
    return state.status === "signed-out" ? "expired" : "unavailable";
  }

  private async applyState(
    state: LocalAuthenticationState,
    cachedUser?: UserInfo,
  ): Promise<void> {
    if (state.status === "signed-in") {
      if (cachedUser?.username !== state.user.username) {
        await this.runUserDataCleanup();
      }
      await this.cache.set(CURRENT_USER_KEY, state.user);
      this.update({ status: "signed-in", user: state.user });
      return;
    }
    if (state.status === "signed-out") {
      await this.clearRemoteAuthentication();
      this.update({ status: "signed-out" });
      return;
    }
    const fallbackUser = state.user ?? cachedUser;
    this.update({
      status: "offline",
      ...(isSignedInUser(fallbackUser) ? { user: fallbackUser } : {}),
    });
  }

  private async clearRemoteAuthentication(): Promise<void> {
    await Promise.all([
      this.cache.delete(CURRENT_USER_KEY),
      this.runUserDataCleanup(),
    ]);
  }

  private async runUserDataCleanup(): Promise<void> {
    await Promise.all([...this.userDataCleanupHandlers].map((handler) => handler()));
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

function isSignedInUser(value: unknown): value is UserInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Reflect.get(value, "isSignedIn") === true &&
    typeof Reflect.get(value, "username") === "string" &&
    Reflect.get(value, "username").trim().length > 0 &&
    typeof Reflect.get(value, "isPremium") === "boolean" &&
    (Reflect.get(value, "avatar") === undefined ||
      typeof Reflect.get(value, "avatar") === "string");
}
