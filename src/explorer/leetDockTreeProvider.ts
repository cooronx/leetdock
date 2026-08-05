import * as vscode from "vscode";
import type { AuthService, AuthSnapshot } from "../auth/authService";
import type {
  DailyChallengeService,
  DailyChallengeState,
} from "../daily/dailyChallengeService";
import type { ProblemSummary } from "../leetcode/types";
import type { RecentProblem } from "../problem/problemCache";
import type { ProblemService } from "../problem/problemService";

type DailyViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly state: DailyChallengeState }
  | { readonly kind: "error"; readonly error: unknown };

type LeetDockNode =
  | { readonly kind: "account" }
  | { readonly kind: "daily" }
  | { readonly kind: "daily-problem"; readonly state: DailyChallengeState }
  | { readonly kind: "daily-sign-in" }
  | { readonly kind: "daily-status"; readonly status: "error" | "loading" | "streak" }
  | { readonly kind: "search" }
  | { readonly kind: "recent" }
  | { readonly kind: "problem"; readonly problem: RecentProblem };

export class LeetDockTreeProvider
  implements vscode.TreeDataProvider<LeetDockNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<LeetDockNode | undefined>();
  private readonly authSubscription: vscode.Disposable;
  private dailyView: DailyViewState = { kind: "idle" };
  private dailyLoadSequence = 0;
  private disposed = false;

  public constructor(
    private readonly auth: AuthService,
    private readonly problems: ProblemService,
    private readonly daily: DailyChallengeService,
  ) {
    this.authSubscription = auth.onDidChange(() => {
      this.dailyLoadSequence += 1;
      this.dailyView = { kind: "idle" };
      this.refresh();
    });
  }

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public refresh(): void {
    if (!this.disposed) {
      this.changeEmitter.fire(undefined);
    }
  }

  public async refreshDailyChallenge(force = true): Promise<DailyChallengeState> {
    const sequence = this.dailyLoadSequence + 1;
    this.dailyLoadSequence = sequence;
    this.dailyView = { kind: "loading" };
    this.refresh();
    try {
      const state = await this.daily.load(hasSignedInUser(this.auth.snapshot), force);
      if (sequence === this.dailyLoadSequence) {
        this.dailyView = { kind: "ready", state };
        this.refresh();
      }
      return state;
    } catch (error) {
      if (sequence === this.dailyLoadSequence) {
        this.dailyView = { kind: "error", error };
        this.refresh();
      }
      throw error;
    }
  }

  public markDailyCompleted(titleSlug: string): void {
    if (!this.daily.markCompleted(titleSlug)) {
      return;
    }
    const state = this.daily.snapshot;
    if (state !== undefined) {
      this.dailyView = { kind: "ready", state };
      this.refresh();
    }
  }

  public isDailyChallenge(titleSlug: string): boolean {
    return this.daily.snapshot?.challenge.problem.titleSlug === titleSlug;
  }

  public resetDailyChallenge(): void {
    this.dailyLoadSequence += 1;
    this.dailyView = { kind: "idle" };
    this.refresh();
  }

  public getTreeItem(element: LeetDockNode): vscode.TreeItem {
    switch (element.kind) {
      case "account":
        return accountItem(this.auth.snapshot);
      case "daily":
        return dailyGroupItem(this.dailyView);
      case "daily-problem":
        return dailyProblemItem(element.state);
      case "daily-sign-in":
        return dailySignInItem();
      case "daily-status":
        return dailyStatusItem(element.status);
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
      if (this.dailyView.kind === "idle") {
        void this.refreshDailyChallenge(false).catch(() => undefined);
      }
      return [
        { kind: "account" },
        { kind: "daily" },
        { kind: "search" },
        { kind: "recent" },
      ];
    }
    if (element.kind === "daily") {
      return dailyChildren(this.dailyView);
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
    this.disposed = true;
    this.authSubscription.dispose();
    this.changeEmitter.dispose();
  }
}

function dailyChildren(view: DailyViewState): LeetDockNode[] {
  switch (view.kind) {
    case "idle":
    case "loading":
      return [{ kind: "daily-status", status: "loading" }];
    case "error":
      return [{ kind: "daily-status", status: "error" }];
    case "ready": {
      const children: LeetDockNode[] = [
        { kind: "daily-problem", state: view.state },
      ];
      if (view.state.streakStatus === "signed-out") {
        children.push({ kind: "daily-sign-in" });
      } else if (view.state.streakStatus === "unavailable") {
        children.push({ kind: "daily-status", status: "streak" });
      }
      return children;
    }
  }
}

function dailyGroupItem(view: DailyViewState): vscode.TreeItem {
  const item = new vscode.TreeItem(
    dailyGroupLabel(view),
    vscode.TreeItemCollapsibleState.Expanded,
  );
  item.id = "leetdock.daily";
  item.contextValue = `leetdock.daily.${view.kind}`;

  switch (view.kind) {
    case "idle":
    case "loading":
      item.description = "正在加载";
      item.iconPath = new vscode.ThemeIcon("loading~spin");
      item.tooltip = "正在加载今日每日一题";
      break;
    case "error":
      item.description = "加载失败";
      item.iconPath = new vscode.ThemeIcon(
        "flame",
        new vscode.ThemeColor("list.warningForeground"),
      );
      item.tooltip = "今日挑战加载失败；展开后点击重试";
      break;
    case "ready": {
      const offline = isOffline(view.state);
      item.description = dailyGroupDescription(view.state, offline);
      item.iconPath = new vscode.ThemeIcon(
        "flame",
        new vscode.ThemeColor("leetdock.streakFlame"),
      );
      item.tooltip = dailyGroupTooltip(view.state, offline);
      break;
    }
  }
  return item;
}

function dailyGroupLabel(view: DailyViewState): string {
  if (view.kind === "ready" && view.state.streak !== undefined) {
    return `连续 ${view.state.streak.streakCount} 天`;
  }
  return "今日挑战";
}

function dailyGroupDescription(state: DailyChallengeState, offline: boolean): string {
  const parts: string[] = [];
  if (state.streakStatus === "signed-out") {
    parts.push("登录后查看 streak");
  } else if (state.streakStatus === "unavailable") {
    parts.push("streak 同步失败");
  } else {
    parts.push(state.todayCompleted === true ? "今日已完成" : "今日待完成");
  }
  if (offline) {
    parts.push("离线数据");
  }
  return parts.join(" · ");
}

function dailyGroupTooltip(state: DailyChallengeState, offline: boolean): string {
  const streak = state.streak === undefined
    ? state.streakStatus === "signed-out" ? "登录后查看连续天数" : "连续天数暂不可用"
    : `连续完成 ${state.streak.streakCount} 天`;
  return [
    `每日一题 · ${state.challenge.date}`,
    streak,
    state.todayCompleted === true ? "今日已完成" : "今日尚未完成",
    ...(offline ? ["当前展示同日缓存数据"] : []),
  ].join("\n");
}

function dailyProblemItem(state: DailyChallengeState): vscode.TreeItem {
  const problem = state.challenge.problem;
  const item = new vscode.TreeItem(
    `${problem.frontendId}. ${displayTitle(problem)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.daily.problem.${problem.titleSlug}`;
  item.description = [
    difficultyLabel(problem),
    state.todayCompleted === true ? "已完成" : "待完成",
    ...(isOffline(state) ? ["离线"] : []),
  ].join(" · ");
  item.tooltip = [
    `${state.challenge.date} 每日一题`,
    problem.title,
    `https://leetcode.cn/problems/${problem.titleSlug}/`,
  ].join("\n");
  item.iconPath = new vscode.ThemeIcon(
    state.todayCompleted === true
      ? "pass-filled"
      : problem.paidOnly ? "lock" : "circle-large-outline",
    state.todayCompleted === true
      ? new vscode.ThemeColor("testing.iconPassed")
      : undefined,
  );
  item.command = {
    command: "leetdock.openProblem",
    title: "打开今日题目",
    arguments: [problem.titleSlug],
  };
  item.contextValue = "leetdock.daily.problem";
  return item;
}

function dailySignInItem(): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "登录查看连续天数",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = "leetdock.daily.signIn";
  item.iconPath = new vscode.ThemeIcon("sign-in");
  item.command = { command: "leetdock.signIn", title: "登录" };
  item.contextValue = "leetdock.daily.signIn";
  return item;
}

function dailyStatusItem(status: "error" | "loading" | "streak"): vscode.TreeItem {
  const loading = status === "loading";
  const item = new vscode.TreeItem(
    loading
      ? "正在获取今日题目…"
      : status === "streak" ? "streak 同步失败 · 点击重试" : "加载失败 · 点击重试",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.daily.${status}`;
  item.iconPath = new vscode.ThemeIcon(loading ? "loading~spin" : "refresh");
  if (!loading) {
    item.command = {
      command: "leetdock.refreshDailyChallenge",
      title: "刷新每日挑战",
    };
  }
  item.contextValue = `leetdock.daily.${status}`;
  return item;
}

function hasSignedInUser(snapshot: AuthSnapshot): boolean {
  return snapshot.status !== "signed-out" && snapshot.user?.isSignedIn === true;
}

function isOffline(state: DailyChallengeState): boolean {
  return state.challengeSource === "cache" || state.streakSource === "cache";
}

function accountItem(snapshot: AuthSnapshot): vscode.TreeItem {
  const item = new vscode.TreeItem(accountLabel(snapshot), vscode.TreeItemCollapsibleState.None);
  item.id = "leetdock.account";
  item.iconPath = new vscode.ThemeIcon(accountIcon(snapshot));
  item.contextValue = `leetdock.account.${snapshot.status}`;

  switch (snapshot.status) {
    case "signed-in":
      item.description = snapshot.user?.isPremium === true ? "会员" : "已登录";
      item.tooltip = `LeetDock 用户：${snapshot.user?.username ?? ""}`;
      break;
    case "signed-out":
      item.description = "点击登录";
      item.tooltip = "登录 LeetDock";
      item.command = { command: "leetdock.signIn", title: "登录" };
      break;
    case "offline":
      item.description = "无法验证";
      item.tooltip = "网络不可用；点击重新登录";
      item.command = { command: "leetdock.signIn", title: "重新登录" };
      break;
    case "verifying":
      item.description = "正在验证";
      item.tooltip = "正在验证 LeetDock 登录状态";
      break;
  }
  return item;
}

function accountLabel(snapshot: AuthSnapshot): string {
  if (snapshot.user?.username) {
    return snapshot.user.username;
  }
  return snapshot.status === "signed-out" ? "未登录" : "LeetDock";
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
