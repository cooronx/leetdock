import * as vscode from "vscode";
import type { AuthService, AuthSnapshot } from "../auth/authService";
import type { ProblemSummary } from "../leetcode/types";
import type { RecentProblem } from "../problem/problemCache";
import type { ProblemService } from "../problem/problemService";

type LeetDockNode =
  | { readonly kind: "account" }
  | { readonly kind: "search" }
  | { readonly kind: "recent" }
  | { readonly kind: "problem"; readonly problem: RecentProblem };

export class LeetDockTreeProvider
  implements vscode.TreeDataProvider<LeetDockNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<LeetDockNode | undefined>();
  private readonly authSubscription: vscode.Disposable;

  public constructor(
    private readonly auth: AuthService,
    private readonly problems: ProblemService,
  ) {
    this.authSubscription = auth.onDidChange(() => this.refresh());
  }

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public getTreeItem(element: LeetDockNode): vscode.TreeItem {
    switch (element.kind) {
      case "account":
        return accountItem(this.auth.snapshot);
      case "search": {
        const item = new vscode.TreeItem("搜索题目", vscode.TreeItemCollapsibleState.None);
        item.id = "leetdock.search";
        item.iconPath = new vscode.ThemeIcon("search");
        item.command = { command: "leetdock.searchProblem", title: "搜索题目" };
        item.contextValue = "leetdock.search";
        return item;
      }
      case "recent": {
        const item = new vscode.TreeItem(
          "最近打开",
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.id = "leetdock.recent";
        item.iconPath = new vscode.ThemeIcon("history");
        item.contextValue = "leetdock.recent";
        return item;
      }
      case "problem":
        return problemItem(element.problem);
    }
  }

  public async getChildren(element?: LeetDockNode): Promise<LeetDockNode[]> {
    if (element === undefined) {
      return [{ kind: "account" }, { kind: "search" }, { kind: "recent" }];
    }
    if (element.kind !== "recent") {
      return [];
    }
    return (await this.problems.getRecent()).map((problem) => ({
      kind: "problem" as const,
      problem,
    }));
  }

  public dispose(): void {
    this.authSubscription.dispose();
    this.changeEmitter.dispose();
  }
}

function accountItem(snapshot: AuthSnapshot): vscode.TreeItem {
  const item = new vscode.TreeItem(accountLabel(snapshot), vscode.TreeItemCollapsibleState.None);
  item.id = "leetdock.account";
  item.iconPath = new vscode.ThemeIcon(accountIcon(snapshot));
  item.contextValue = `leetdock.account.${snapshot.status}`;

  switch (snapshot.status) {
    case "signed-in":
      item.description = snapshot.user?.isPremium === true ? "会员" : "已登录";
      item.tooltip = `LeetCode CN 用户：${snapshot.user?.username ?? ""}`;
      break;
    case "signed-out":
      item.description = "点击登录";
      item.tooltip = "登录 LeetCode 中国站";
      item.command = { command: "leetdock.signIn", title: "登录" };
      break;
    case "offline":
      item.description = "无法验证";
      item.tooltip = "网络不可用；点击重新登录";
      item.command = { command: "leetdock.signIn", title: "重新登录" };
      break;
    case "verifying":
      item.description = "正在验证";
      item.tooltip = "正在验证 LeetCode CN 登录状态";
      break;
  }
  return item;
}

function accountLabel(snapshot: AuthSnapshot): string {
  if (snapshot.user?.username) {
    return snapshot.user.username;
  }
  return snapshot.status === "signed-out" ? "未登录" : "LeetCode CN";
}

function accountIcon(snapshot: AuthSnapshot): string {
  switch (snapshot.status) {
    case "signed-in":
      return "account";
    case "signed-out":
      return "sign-in";
    case "offline":
      return "warning";
    case "verifying":
      return "sync";
  }
}

function problemItem(problem: RecentProblem): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${problem.frontendId}. ${displayTitle(problem)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.problem.${problem.titleSlug}`;
  item.description = [difficultyLabel(problem), statusLabel(problem)]
    .filter((part) => part.length > 0)
    .join(" · ");
  item.tooltip = `${problem.title}\nhttps://leetcode.cn/problems/${problem.titleSlug}/`;
  item.iconPath = new vscode.ThemeIcon(problemIcon(problem));
  item.command = {
    command: "leetdock.openProblem",
    title: "打开题目",
    arguments: [problem.titleSlug],
  };
  item.contextValue = "leetdock.problem";
  return item;
}

function displayTitle(problem: ProblemSummary): string {
  return problem.translatedTitle?.trim() || problem.title;
}

function difficultyLabel(problem: ProblemSummary): string {
  switch (problem.difficulty) {
    case "Easy":
      return "简单";
    case "Medium":
      return "中等";
    case "Hard":
      return "困难";
  }
}

function statusLabel(problem: ProblemSummary): string {
  switch (problem.status) {
    case "AC":
      return "已通过";
    case "TRIED":
      return "尝试过";
    case null:
      return problem.paidOnly ? "会员" : "";
  }
}

function problemIcon(problem: ProblemSummary): string {
  if (problem.status === "AC") {
    return "pass-filled";
  }
  if (problem.status === "TRIED") {
    return "history";
  }
  return problem.paidOnly ? "lock" : "circle-outline";
}
