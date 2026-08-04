import * as vscode from "vscode";
import type { AuthService, AuthSnapshot } from "./authService";

export class AuthStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  private readonly changeSubscription: vscode.Disposable;

  public constructor(auth: AuthService) {
    this.changeSubscription = auth.onDidChange((snapshot) => this.render(snapshot));
    this.render(auth.snapshot);
    this.item.show();
  }

  public dispose(): void {
    this.changeSubscription.dispose();
    this.item.dispose();
  }

  private render(snapshot: AuthSnapshot): void {
    switch (snapshot.status) {
      case "signed-in":
        this.item.text = `$(account) LeetDock: ${snapshot.user?.username ?? ""}`;
        this.item.tooltip = snapshot.user?.isPremium === true
          ? "LeetDock 会员账号；点击退出登录"
          : "LeetDock 已登录；点击退出登录";
        this.item.command = "leetdock.signOut";
        break;
      case "verifying":
        this.item.text = "$(sync~spin) LeetDock: 正在验证";
        this.item.tooltip = "正在验证 LeetDock 登录状态";
        this.item.command = undefined;
        break;
      case "offline":
        this.item.text = snapshot.user === undefined
          ? "$(warning) LeetDock: 离线"
          : `$(warning) LeetDock: ${snapshot.user.username}`;
        this.item.tooltip = "暂时无法验证登录状态；点击重新登录";
        this.item.command = "leetdock.signIn";
        break;
      case "signed-out":
        this.item.text = "$(account) LeetDock: 登录";
        this.item.tooltip = "点击登录 LeetDock";
        this.item.command = "leetdock.signIn";
        break;
    }
  }
}
