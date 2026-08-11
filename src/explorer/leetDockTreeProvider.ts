import * as vscode from "vscode";
import type { AuthService, AuthSnapshot } from "../auth/authService";
import {
  CompanyService,
  displayCompanyName,
  type CompanyDetailState,
} from "../company/companyService";
import type {
  DailyChallengeService,
  DailyChallengeState,
} from "../daily/dailyChallengeService";
import {
  DIFFICULTIES,
  type DifficultyDetailState,
  DifficultyService,
} from "../difficulty/difficultyService";
import type {
  CompanyQuestion,
  CompanySummary,
  Difficulty,
  ProblemListQuestion,
  ProblemListSummary,
  ProblemSummary,
  ProblemTag,
} from "../leetcode/types";
import type {
  ProblemListDetailState,
  ProblemListService,
} from "../problemList/problemListService";
import {
  displayTagName,
  type TagDetailState,
  TagService,
} from "../tag/tagService";

type DailyViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly state: DailyChallengeState }
  | { readonly kind: "error"; readonly error: unknown };

type ProblemListsViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly lists: readonly ProblemListSummary[] }
  | { readonly kind: "error"; readonly error: unknown };

type ProblemListDetailViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: unknown };

type CompaniesViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly companies: readonly CompanySummary[] }
  | { readonly kind: "error"; readonly error: unknown };

type CompanyDetailViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: unknown };

type TagsViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly tags: readonly ProblemTag[] }
  | { readonly kind: "error"; readonly error: unknown };

type TagDetailViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: unknown };

type DifficultyDetailViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: unknown };

export type LeetDockNode =
  | { readonly kind: "account" }
  | { readonly kind: "daily" }
  | { readonly kind: "daily-problem"; readonly state: DailyChallengeState }
  | { readonly kind: "daily-sign-in" }
  | { readonly kind: "daily-status"; readonly status: "error" | "loading" | "streak" }
  | { readonly kind: "my-lists" }
  | {
    readonly kind: "my-lists-status";
    readonly status: "empty" | "error" | "loading" | "sign-in";
  }
  | {
    readonly kind: "problem-list";
    readonly summary: ProblemListSummary;
    readonly detail?: ProblemListDetailState;
  }
  | {
    readonly kind: "problem-list-status";
    readonly summary: ProblemListSummary;
    readonly status: "empty" | "error" | "loading";
  }
  | {
    readonly kind: "problem-list-problem";
    readonly listSlug: string;
    readonly problem: ProblemListQuestion;
  }
  | { readonly kind: "problem-list-more"; readonly summary: ProblemListSummary }
  | { readonly kind: "library" }
  | { readonly kind: "difficulties" }
  | {
    readonly kind: "difficulty";
    readonly difficulty: Difficulty;
    readonly detail?: DifficultyDetailState;
  }
  | {
    readonly kind: "difficulty-status";
    readonly difficulty: Difficulty;
    readonly status: "empty" | "error" | "loading";
  }
  | {
    readonly kind: "difficulty-problem";
    readonly difficulty: Difficulty;
    readonly problem: ProblemSummary;
  }
  | { readonly kind: "difficulty-more"; readonly difficulty: Difficulty }
  | { readonly kind: "tags" }
  | { readonly kind: "tag-search" }
  | {
    readonly kind: "tags-status";
    readonly status: "empty" | "error" | "loading";
  }
  | {
    readonly kind: "tag";
    readonly summary: ProblemTag;
    readonly detail?: TagDetailState;
  }
  | {
    readonly kind: "tag-status";
    readonly summary: ProblemTag;
    readonly status: "empty" | "error" | "loading";
  }
  | {
    readonly kind: "tag-problem";
    readonly tagSlug: string;
    readonly problem: ProblemSummary;
  }
  | { readonly kind: "tag-more"; readonly summary: ProblemTag }
  | { readonly kind: "companies" }
  | { readonly kind: "company-search" }
  | {
    readonly kind: "companies-status";
    readonly status: "empty" | "error" | "loading" | "premium" | "sign-in";
  }
  | {
    readonly kind: "company";
    readonly summary: CompanySummary;
    readonly detail?: CompanyDetailState;
  }
  | {
    readonly kind: "company-status";
    readonly summary: CompanySummary;
    readonly status: "empty" | "error" | "loading";
  }
  | {
    readonly kind: "company-problem";
    readonly companySlug: string;
    readonly problem: CompanyQuestion;
  }
  | { readonly kind: "company-more"; readonly summary: CompanySummary }
  | { readonly kind: "search" };

export class LeetDockTreeProvider
  implements vscode.TreeDataProvider<LeetDockNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<LeetDockNode | undefined>();
  private readonly authSubscription: vscode.Disposable;
  private dailyView: DailyViewState = { kind: "idle" };
  private dailyLoadSequence = 0;
  private problemListsView: ProblemListsViewState = { kind: "idle" };
  private problemListsLoadSequence = 0;
  private readonly problemListDetailViews = new Map<string, ProblemListDetailViewState>();
  private readonly loadingMoreProblemLists = new Set<string>();
  private companiesView: CompaniesViewState = { kind: "idle" };
  private companiesLoadSequence = 0;
  private readonly companyDetailViews = new Map<string, CompanyDetailViewState>();
  private readonly loadingMoreCompanies = new Set<string>();
  private tagsView: TagsViewState = { kind: "idle" };
  private tagsLoadSequence = 0;
  private readonly tagDetailViews = new Map<string, TagDetailViewState>();
  private readonly loadingMoreTags = new Set<string>();
  private difficultyGeneration = 0;
  private readonly difficultyDetailViews = new Map<
    Difficulty,
    DifficultyDetailViewState
  >();
  private readonly loadingMoreDifficulties = new Set<Difficulty>();
  private disposed = false;

  public constructor(
    private readonly auth: AuthService,
    private readonly daily: DailyChallengeService,
    private readonly problemLists: ProblemListService,
    private readonly companies: CompanyService,
    private readonly tags: TagService,
    private readonly difficulties: DifficultyService,
  ) {
    this.authSubscription = auth.onDidChange(() => {
      this.dailyLoadSequence += 1;
      this.dailyView = { kind: "idle" };
      this.resetMyProblemLists(false);
      this.resetCompanies(false);
      this.resetTags(false);
      this.resetDifficulties(false);
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

  public async refreshMyProblemLists(
    force = true,
  ): Promise<readonly ProblemListSummary[] | undefined> {
    if (!hasOnlineSignedInUser(this.auth.snapshot)) {
      this.resetMyProblemLists();
      return undefined;
    }
    if (force) {
      this.problemLists.reset();
      this.problemListDetailViews.clear();
      this.loadingMoreProblemLists.clear();
    }
    const sequence = this.problemListsLoadSequence + 1;
    this.problemListsLoadSequence = sequence;
    this.problemListsView = { kind: "loading" };
    this.refresh();
    try {
      const lists = await this.problemLists.loadCatalog();
      if (sequence === this.problemListsLoadSequence) {
        this.problemListsView = { kind: "ready", lists };
        this.refresh();
      }
      return lists;
    } catch (error) {
      if (sequence === this.problemListsLoadSequence) {
        this.problemListsView = { kind: "error", error };
        this.refresh();
      }
      throw error;
    }
  }

  public async refreshMyProblemList(slug: string): Promise<void> {
    const summary = this.problemListsView.kind === "ready"
      ? this.problemListsView.lists.find((list) => list.slug === slug)
      : undefined;
    if (summary === undefined || !hasOnlineSignedInUser(this.auth.snapshot)) {
      return;
    }
    this.problemListDetailViews.set(slug, { kind: "loading" });
    this.refresh();
    try {
      await this.problemLists.loadDetail(summary);
      this.problemListDetailViews.delete(slug);
      this.refresh();
    } catch (error) {
      this.problemListDetailViews.set(slug, { kind: "error", error });
      this.refresh();
      throw error;
    }
  }

  public async loadMoreMyProblemList(slug: string): Promise<void> {
    if (this.loadingMoreProblemLists.has(slug)) {
      return;
    }
    this.loadingMoreProblemLists.add(slug);
    this.refresh();
    try {
      await this.problemLists.loadMore(slug);
    } finally {
      this.loadingMoreProblemLists.delete(slug);
      this.refresh();
    }
  }

  public async refreshLoadedProblemListsAfterAccepted(titleSlug: string): Promise<void> {
    if (!hasOnlineSignedInUser(this.auth.snapshot)) {
      return;
    }
    try {
      await this.problemLists.refreshLoadedAfterAccepted(titleSlug);
    } finally {
      this.refresh();
    }
  }

  public resetMyProblemLists(refresh = true): void {
    this.problemListsLoadSequence += 1;
    this.problemLists.reset();
    this.problemListsView = { kind: "idle" };
    this.problemListDetailViews.clear();
    this.loadingMoreProblemLists.clear();
    if (refresh) {
      this.refresh();
    }
  }

  public async refreshCompanies(
    force = true,
  ): Promise<readonly CompanySummary[] | undefined> {
    if (!hasOnlinePremiumUser(this.auth.snapshot)) {
      this.resetCompanies();
      return undefined;
    }
    if (force) {
      this.companies.reset();
      this.companyDetailViews.clear();
      this.loadingMoreCompanies.clear();
    }
    const sequence = this.companiesLoadSequence + 1;
    this.companiesLoadSequence = sequence;
    this.companiesView = { kind: "loading" };
    this.refresh();
    try {
      const companies = await this.companies.loadCatalog();
      if (sequence === this.companiesLoadSequence) {
        this.companiesView = { kind: "ready", companies };
        this.refresh();
      }
      return companies;
    } catch (error) {
      if (sequence === this.companiesLoadSequence) {
        this.companiesView = { kind: "error", error };
        this.refresh();
      }
      throw error;
    }
  }

  public async refreshCompany(slug: string): Promise<void> {
    const summary = this.companySummary(slug);
    if (summary === undefined || !hasOnlinePremiumUser(this.auth.snapshot)) {
      return;
    }
    this.companyDetailViews.set(slug, { kind: "loading" });
    this.refresh();
    try {
      await this.companies.loadDetail(summary);
      this.companyDetailViews.delete(slug);
      this.refresh();
    } catch (error) {
      this.companyDetailViews.set(slug, { kind: "error", error });
      this.refresh();
      throw error;
    }
  }

  public async loadMoreCompany(slug: string): Promise<void> {
    if (this.loadingMoreCompanies.has(slug)) {
      return;
    }
    this.loadingMoreCompanies.add(slug);
    this.refresh();
    try {
      await this.companies.loadMore(slug);
    } finally {
      this.loadingMoreCompanies.delete(slug);
      this.refresh();
    }
  }

  public markCompanyProblemAccepted(titleSlug: string): void {
    if (this.companies.markAccepted(titleSlug)) {
      this.refresh();
    }
  }

  public resetCompanies(refresh = true): void {
    this.companiesLoadSequence += 1;
    this.companies.reset();
    this.companiesView = { kind: "idle" };
    this.companyDetailViews.clear();
    this.loadingMoreCompanies.clear();
    if (refresh) {
      this.refresh();
    }
  }

  public async refreshTags(
    force = true,
  ): Promise<readonly ProblemTag[] | undefined> {
    if (force) {
      this.tags.reset();
      this.tagDetailViews.clear();
      this.loadingMoreTags.clear();
    }
    const sequence = this.tagsLoadSequence + 1;
    this.tagsLoadSequence = sequence;
    this.tagsView = { kind: "loading" };
    this.refresh();
    try {
      const tags = await this.tags.loadCatalog();
      if (sequence === this.tagsLoadSequence) {
        this.tagsView = { kind: "ready", tags };
        this.refresh();
      }
      return tags;
    } catch (error) {
      if (sequence === this.tagsLoadSequence) {
        this.tagsView = { kind: "error", error };
        this.refresh();
      }
      throw error;
    }
  }

  public async refreshTag(slug: string): Promise<void> {
    const summary = this.tagSummary(slug);
    if (summary === undefined) {
      return;
    }
    this.tagDetailViews.set(slug, { kind: "loading" });
    this.refresh();
    try {
      await this.tags.loadDetail(summary);
      this.tagDetailViews.delete(slug);
      this.refresh();
    } catch (error) {
      this.tagDetailViews.set(slug, { kind: "error", error });
      this.refresh();
      throw error;
    }
  }

  public async loadMoreTag(slug: string): Promise<void> {
    if (this.loadingMoreTags.has(slug)) {
      return;
    }
    this.loadingMoreTags.add(slug);
    this.refresh();
    try {
      await this.tags.loadMore(slug);
    } finally {
      this.loadingMoreTags.delete(slug);
      this.refresh();
    }
  }

  public markTagProblemAccepted(titleSlug: string): void {
    if (this.tags.markAccepted(titleSlug)) {
      this.refresh();
    }
  }

  public resetTags(refresh = true): void {
    this.tagsLoadSequence += 1;
    this.tags.reset();
    this.tagsView = { kind: "idle" };
    this.tagDetailViews.clear();
    this.loadingMoreTags.clear();
    if (refresh) {
      this.refresh();
    }
  }

  public async refreshDifficulty(difficulty: Difficulty): Promise<void> {
    const generation = this.difficultyGeneration;
    this.difficultyDetailViews.set(difficulty, { kind: "loading" });
    this.refresh();
    try {
      await this.difficulties.loadDetail(difficulty);
      if (generation === this.difficultyGeneration) {
        this.difficultyDetailViews.delete(difficulty);
        this.refresh();
      }
    } catch (error) {
      if (generation === this.difficultyGeneration) {
        this.difficultyDetailViews.set(difficulty, { kind: "error", error });
        this.refresh();
      }
      throw error;
    }
  }

  public async loadMoreDifficulty(difficulty: Difficulty): Promise<void> {
    if (this.loadingMoreDifficulties.has(difficulty)) {
      return;
    }
    this.loadingMoreDifficulties.add(difficulty);
    this.refresh();
    try {
      await this.difficulties.loadMore(difficulty);
    } finally {
      this.loadingMoreDifficulties.delete(difficulty);
      this.refresh();
    }
  }

  public markDifficultyProblemAccepted(titleSlug: string): void {
    if (this.difficulties.markAccepted(titleSlug)) {
      this.refresh();
    }
  }

  public resetDifficulties(refresh = true): void {
    this.difficultyGeneration += 1;
    this.difficulties.reset();
    this.difficultyDetailViews.clear();
    this.loadingMoreDifficulties.clear();
    if (refresh) {
      this.refresh();
    }
  }

  public async pickTag(): Promise<LeetDockNode | undefined> {
    const tags = this.tagsView.kind === "ready"
      ? this.tagsView.tags
      : await this.refreshTags(false);
    if (tags === undefined) {
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(
      tags.map((tag) => ({
        label: displayTagName(tag),
        description: tag.translatedName === undefined ? tag.slug : tag.name,
        detail: tag.slug,
        tag,
      })),
      {
        placeHolder: "搜索标签名称",
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    return selected === undefined
      ? undefined
      : { kind: "tag", summary: selected.tag };
  }

  public async pickCompany(): Promise<LeetDockNode | undefined> {
    const companies = this.companiesView.kind === "ready"
      ? this.companiesView.companies
      : await this.refreshCompanies(false);
    if (companies === undefined) {
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(
      companies.map((company) => ({
        label: displayCompanyName(company),
        description: company.translatedName === undefined ? company.slug : company.name,
        detail: company.slug,
        company,
      })),
      {
        placeHolder: "搜索公司名称",
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    return selected === undefined
      ? undefined
      : { kind: "company", summary: selected.company };
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
      case "my-lists":
        return myProblemListsGroupItem(this.problemListsView, this.auth.snapshot);
      case "my-lists-status":
        return myProblemListsStatusItem(element.status);
      case "problem-list":
        return problemListItem(element.summary, element.detail);
      case "problem-list-status":
        return problemListStatusItem(element.summary, element.status);
      case "problem-list-problem":
        return problemListProblemItem(element.listSlug, element.problem);
      case "problem-list-more":
        return problemListMoreItem(
          element.summary,
          this.loadingMoreProblemLists.has(element.summary.slug),
        );
      case "library":
        return libraryItem();
      case "difficulties":
        return difficultiesItem();
      case "difficulty":
        return difficultyItem(element.difficulty, element.detail);
      case "difficulty-status":
        return difficultyStatusItem(element.difficulty, element.status);
      case "difficulty-problem":
        return difficultyProblemItem(element.difficulty, element.problem);
      case "difficulty-more":
        return difficultyMoreItem(
          element.difficulty,
          this.loadingMoreDifficulties.has(element.difficulty),
        );
      case "tags":
        return tagsItem(this.tagsView);
      case "tag-search":
        return tagSearchItem();
      case "tags-status":
        return tagsStatusItem(element.status);
      case "tag":
        return tagItem(element.summary, element.detail);
      case "tag-status":
        return tagStatusItem(element.summary, element.status);
      case "tag-problem":
        return tagProblemItem(element.tagSlug, element.problem);
      case "tag-more":
        return tagMoreItem(
          element.summary,
          this.loadingMoreTags.has(element.summary.slug),
        );
      case "companies":
        return companiesItem(this.companiesView, this.auth.snapshot);
      case "company-search":
        return companySearchItem();
      case "companies-status":
        return companiesStatusItem(element.status);
      case "company":
        return companyItem(element.summary, element.detail);
      case "company-status":
        return companyStatusItem(element.summary, element.status);
      case "company-problem":
        return companyProblemItem(element.companySlug, element.problem);
      case "company-more":
        return companyMoreItem(
          element.summary,
          this.loadingMoreCompanies.has(element.summary.slug),
        );
      case "search": {
        const item = new vscode.TreeItem("搜索题目", vscode.TreeItemCollapsibleState.None);
        item.id = "leetdock.search";
        item.iconPath = new vscode.ThemeIcon("search");
        item.command = { command: "leetdock.searchProblem", title: "搜索题目" };
        item.contextValue = "leetdock.search";
        return item;
      }
    }
  }

  public async getChildren(element?: LeetDockNode): Promise<LeetDockNode[]> {
    if (element === undefined) {
      if (this.dailyView.kind === "idle") {
        void this.refreshDailyChallenge(false).catch(() => undefined);
      }
      return [
        { kind: "search" },
        { kind: "daily" },
        { kind: "library" },
        { kind: "my-lists" },
        { kind: "account" },
      ];
    }
    if (element.kind === "daily") {
      return dailyChildren(this.dailyView);
    }
    if (element.kind === "my-lists") {
      return this.myProblemListsChildren();
    }
    if (element.kind === "problem-list") {
      return this.problemListChildren(element.summary);
    }
    if (element.kind === "library") {
      return [{ kind: "difficulties" }, { kind: "tags" }, { kind: "companies" }];
    }
    if (element.kind === "difficulties") {
      return DIFFICULTIES.map((difficulty) => ({
        kind: "difficulty" as const,
        difficulty,
        detail: this.difficulties.getDetailSnapshot(difficulty),
      }));
    }
    if (element.kind === "difficulty") {
      return this.difficultyChildren(element.difficulty);
    }
    if (element.kind === "tags") {
      return this.tagsChildren();
    }
    if (element.kind === "tag") {
      return this.tagChildren(element.summary);
    }
    if (element.kind === "companies") {
      return this.companiesChildren();
    }
    if (element.kind === "company") {
      return this.companyChildren(element.summary);
    }
    return [];
  }

  public getParent(element: LeetDockNode): LeetDockNode | undefined {
    switch (element.kind) {
      case "difficulties":
      case "tags":
      case "companies":
        return { kind: "library" };
      case "difficulty":
        return { kind: "difficulties" };
      case "difficulty-status":
      case "difficulty-problem":
      case "difficulty-more":
        return { kind: "difficulty", difficulty: element.difficulty };
      case "tag-search":
      case "tags-status":
      case "tag":
        return { kind: "tags" };
      case "tag-status":
      case "tag-problem":
      case "tag-more": {
        const slug = element.kind === "tag-problem"
          ? element.tagSlug
          : element.summary.slug;
        const summary = this.tagSummary(slug);
        return summary === undefined ? undefined : { kind: "tag", summary };
      }
      case "company-search":
      case "companies-status":
      case "company":
        return { kind: "companies" };
      case "company-status":
      case "company-problem":
      case "company-more": {
        const slug = element.kind === "company-problem"
          ? element.companySlug
          : element.summary.slug;
        const summary = this.companySummary(slug);
        return summary === undefined ? undefined : { kind: "company", summary };
      }
      default:
        return undefined;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.authSubscription.dispose();
    this.changeEmitter.dispose();
  }

  private myProblemListsChildren(): LeetDockNode[] {
    const snapshot = this.auth.snapshot;
    if (snapshot.status === "signed-out") {
      return [{ kind: "my-lists-status", status: "sign-in" }];
    }
    if (snapshot.status === "verifying") {
      return [{ kind: "my-lists-status", status: "loading" }];
    }
    if (snapshot.status === "offline") {
      return [{ kind: "my-lists-status", status: "error" }];
    }
    if (this.problemListsView.kind === "idle") {
      void this.refreshMyProblemLists(false).catch(() => undefined);
      return [{ kind: "my-lists-status", status: "loading" }];
    }
    switch (this.problemListsView.kind) {
      case "loading":
        return [{ kind: "my-lists-status", status: "loading" }];
      case "error":
        return [{ kind: "my-lists-status", status: "error" }];
      case "ready":
        if (this.problemListsView.lists.length === 0) {
          return [{ kind: "my-lists-status", status: "empty" }];
        }
        return this.problemListsView.lists.map((summary) => ({
          kind: "problem-list" as const,
          summary,
          detail: this.problemLists.getDetailSnapshot(summary.slug),
        }));
    }
  }

  private difficultyChildren(difficulty: Difficulty): LeetDockNode[] {
    const view = this.difficultyDetailViews.get(difficulty);
    const detail = this.difficulties.getDetailSnapshot(difficulty);
    if (view?.kind === "error") {
      return [{ kind: "difficulty-status", difficulty, status: "error" }];
    }
    if (detail === undefined) {
      if (view?.kind !== "loading") {
        void this.refreshDifficulty(difficulty).catch(() => undefined);
      }
      return [{ kind: "difficulty-status", difficulty, status: "loading" }];
    }
    const children: LeetDockNode[] = detail.questions.map((problem) => ({
      kind: "difficulty-problem" as const,
      difficulty,
      problem,
    }));
    if (children.length === 0) {
      children.push({ kind: "difficulty-status", difficulty, status: "empty" });
    }
    if (detail.hasMore) {
      children.push({ kind: "difficulty-more", difficulty });
    }
    return children;
  }

  private problemListChildren(summary: ProblemListSummary): LeetDockNode[] {
    if (!hasOnlineSignedInUser(this.auth.snapshot)) {
      return [];
    }
    const view = this.problemListDetailViews.get(summary.slug);
    const detail = this.problemLists.getDetailSnapshot(summary.slug);
    if (view?.kind === "error") {
      return [{ kind: "problem-list-status", summary, status: "error" }];
    }
    if (detail === undefined) {
      if (view?.kind !== "loading") {
        void this.refreshMyProblemList(summary.slug).catch(() => undefined);
      }
      return [{ kind: "problem-list-status", summary, status: "loading" }];
    }
    const children: LeetDockNode[] = detail.questions.map((problem) => ({
      kind: "problem-list-problem" as const,
      listSlug: summary.slug,
      problem,
    }));
    if (children.length === 0) {
      children.push({ kind: "problem-list-status", summary, status: "empty" });
    }
    if (detail.hasMore) {
      children.push({ kind: "problem-list-more", summary });
    }
    return children;
  }

  private companiesChildren(): LeetDockNode[] {
    const snapshot = this.auth.snapshot;
    if (snapshot.status === "signed-out") {
      return [{ kind: "companies-status", status: "sign-in" }];
    }
    if (snapshot.status === "verifying") {
      return [{ kind: "companies-status", status: "loading" }];
    }
    if (snapshot.status === "offline") {
      return [{ kind: "companies-status", status: "error" }];
    }
    if (snapshot.user?.isPremium !== true) {
      return [{ kind: "companies-status", status: "premium" }];
    }
    if (this.companiesView.kind === "idle") {
      void this.refreshCompanies(false).catch(() => undefined);
      return [{ kind: "companies-status", status: "loading" }];
    }
    switch (this.companiesView.kind) {
      case "loading":
        return [{ kind: "companies-status", status: "loading" }];
      case "error":
        return [{ kind: "companies-status", status: "error" }];
      case "ready":
        if (this.companiesView.companies.length === 0) {
          return [{ kind: "companies-status", status: "empty" }];
        }
        return [
          { kind: "company-search" },
          ...this.companiesView.companies.map((summary) => ({
            kind: "company" as const,
            summary,
            detail: this.companies.getDetailSnapshot(summary.slug),
          })),
        ];
    }
  }

  private tagsChildren(): LeetDockNode[] {
    if (this.tagsView.kind === "idle") {
      void this.refreshTags(false).catch(() => undefined);
      return [{ kind: "tags-status", status: "loading" }];
    }
    switch (this.tagsView.kind) {
      case "loading":
        return [{ kind: "tags-status", status: "loading" }];
      case "error":
        return [{ kind: "tags-status", status: "error" }];
      case "ready":
        if (this.tagsView.tags.length === 0) {
          return [{ kind: "tags-status", status: "empty" }];
        }
        return [
          { kind: "tag-search" },
          ...this.tagsView.tags.map((summary) => ({
            kind: "tag" as const,
            summary,
            detail: this.tags.getDetailSnapshot(summary.slug),
          })),
        ];
    }
  }

  private tagChildren(summary: ProblemTag): LeetDockNode[] {
    const view = this.tagDetailViews.get(summary.slug);
    const detail = this.tags.getDetailSnapshot(summary.slug);
    if (view?.kind === "error") {
      return [{ kind: "tag-status", summary, status: "error" }];
    }
    if (detail === undefined) {
      if (view?.kind !== "loading") {
        void this.refreshTag(summary.slug).catch(() => undefined);
      }
      return [{ kind: "tag-status", summary, status: "loading" }];
    }
    const children: LeetDockNode[] = detail.questions.map((problem) => ({
      kind: "tag-problem" as const,
      tagSlug: summary.slug,
      problem,
    }));
    if (children.length === 0) {
      children.push({ kind: "tag-status", summary, status: "empty" });
    }
    if (detail.hasMore) {
      children.push({ kind: "tag-more", summary });
    }
    return children;
  }

  private companyChildren(summary: CompanySummary): LeetDockNode[] {
    if (!hasOnlinePremiumUser(this.auth.snapshot)) {
      return [];
    }
    const view = this.companyDetailViews.get(summary.slug);
    const detail = this.companies.getDetailSnapshot(summary.slug);
    if (view?.kind === "error") {
      return [{ kind: "company-status", summary, status: "error" }];
    }
    if (detail === undefined) {
      if (view?.kind !== "loading") {
        void this.refreshCompany(summary.slug).catch(() => undefined);
      }
      return [{ kind: "company-status", summary, status: "loading" }];
    }
    const children: LeetDockNode[] = detail.questions.map((problem) => ({
      kind: "company-problem" as const,
      companySlug: summary.slug,
      problem,
    }));
    if (children.length === 0) {
      children.push({ kind: "company-status", summary, status: "empty" });
    }
    if (detail.hasMore) {
      children.push({ kind: "company-more", summary });
    }
    return children;
  }

  private companySummary(slug: string): CompanySummary | undefined {
    return this.companiesView.kind === "ready"
      ? this.companiesView.companies.find((company) => company.slug === slug)
      : undefined;
  }

  private tagSummary(slug: string): ProblemTag | undefined {
    return this.tagsView.kind === "ready"
      ? this.tagsView.tags.find((tag) => tag.slug === slug)
      : undefined;
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
      item.iconPath = new vscode.ThemeIcon("flame");
      item.tooltip = "今日挑战加载失败；展开后点击重试";
      break;
    case "ready": {
      const offline = isOffline(view.state);
      item.description = dailyGroupDescription(view.state, offline);
      item.iconPath = new vscode.ThemeIcon("flame");
      item.tooltip = dailyGroupTooltip(view.state, offline);
      break;
    }
  }
  return item;
}

function dailyGroupLabel(view: DailyViewState): string {
  if (view.kind === "ready" && view.state.streak !== undefined) {
    return `每日一题 （已连续${view.state.streak.streakCount}天）`;
  }
  return "每日一题";
}

function dailyGroupDescription(
  state: DailyChallengeState,
  offline: boolean,
): string | undefined {
  const parts: string[] = [];
  if (state.streakStatus === "signed-out") {
    parts.push("登录后查看连续天数");
  } else if (state.streakStatus === "unavailable") {
    parts.push("连续天数同步失败");
  } else {
    parts.push(state.todayCompleted === true ? "今日已完成" : "今日待完成");
  }
  if (offline) {
    parts.push("离线数据");
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
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

function myProblemListsGroupItem(
  view: ProblemListsViewState,
  auth: AuthSnapshot,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "我的题单",
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = "leetdock.myProblemLists";
  item.iconPath = new vscode.ThemeIcon("list-tree");
  item.contextValue = `leetdock.myProblemLists.${view.kind}`;
  if (auth.status === "signed-out") {
    item.description = "登录后查看";
    item.tooltip = "登录后读取力扣账号中的普通题单";
  } else if (auth.status === "verifying") {
    item.description = "正在验证";
  } else if (auth.status === "offline" || view.kind === "error") {
    item.description = "加载失败";
    item.tooltip = "无法获取我的题单；展开后点击重试";
  } else if (view.kind === "loading") {
    item.description = "正在加载";
  } else if (view.kind === "ready") {
    item.description = `${view.lists.length} 个`;
    item.tooltip = `力扣普通题单 · ${view.lists.length} 个`;
  }
  return item;
}

function myProblemListsStatusItem(
  status: "empty" | "error" | "loading" | "sign-in",
): vscode.TreeItem {
  const label = status === "sign-in"
    ? "登录查看我的题单"
    : status === "loading"
    ? "正在获取我的题单…"
    : status === "empty"
    ? "暂无普通题单"
    : "加载失败 · 点击重试";
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.id = `leetdock.myProblemLists.${status}`;
  item.iconPath = new vscode.ThemeIcon(
    status === "sign-in"
      ? "sign-in"
      : status === "loading"
      ? "loading~spin"
      : status === "empty"
      ? "info"
      : "refresh",
  );
  if (status === "sign-in") {
    item.command = { command: "leetdock.signIn", title: "登录" };
  } else if (status === "error") {
    item.command = {
      command: "leetdock.refreshMyProblemLists",
      title: "刷新我的题单",
    };
  }
  item.contextValue = `leetdock.myProblemLists.${status}`;
  return item;
}

function problemListItem(
  summary: ProblemListSummary,
  detail: ProblemListDetailState | undefined,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    summary.name,
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = `leetdock.myProblemList.${summary.slug}`;
  const source = summary.source === "created" ? "创建" : "收藏";
  item.description = detail === undefined
    ? source
    : `${detail.progress.accepted}/${detail.total} · ${source}`;
  item.tooltip = detail === undefined
    ? `${summary.name}\n${source}的普通题单`
    : [
      summary.name,
      `本轮完成 ${detail.progress.accepted}/${detail.total}`,
      `尝试过 ${detail.progress.failed} · 未开始 ${detail.progress.untouched}`,
      `${source}的普通题单`,
    ].join("\n");
  item.iconPath = new vscode.ThemeIcon(
    summary.source === "created" ? "list-unordered" : "star-full",
  );
  item.contextValue = `leetdock.myProblemList.${summary.source}`;
  return item;
}

function problemListStatusItem(
  summary: ProblemListSummary,
  status: "empty" | "error" | "loading",
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    status === "loading"
      ? "正在加载题目与进度…"
      : status === "empty"
      ? "题单中暂无题目"
      : "加载失败 · 点击重试",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.myProblemList.${summary.slug}.${status}`;
  item.iconPath = new vscode.ThemeIcon(
    status === "loading" ? "loading~spin" : status === "empty" ? "info" : "refresh",
  );
  if (status === "error") {
    item.command = {
      command: "leetdock.refreshMyProblemList",
      title: "刷新题单",
      arguments: [summary.slug],
    };
  }
  item.contextValue = `leetdock.myProblemList.${status}`;
  return item;
}

function problemListProblemItem(
  listSlug: string,
  problem: ProblemListQuestion,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${problem.frontendId}. ${displayTitle(problem)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.myProblemList.${listSlug}.problem.${problem.titleSlug}`;
  item.description = [difficultyLabel(problem), problemListStatusLabel(problem)]
    .filter((part) => part.length > 0)
    .join(" · ");
  item.tooltip = `${problem.title}\nhttps://leetcode.cn/problems/${problem.titleSlug}/`;
  item.iconPath = new vscode.ThemeIcon(
    problem.previouslySolved && problem.status === null ? "history" : problemIcon(problem),
  );
  item.command = {
    command: "leetdock.openProblem",
    title: "打开题单中的题目",
    arguments: [problem.titleSlug],
  };
  item.contextValue = "leetdock.myProblemList.problem";
  return item;
}

function problemListMoreItem(
  summary: ProblemListSummary,
  loading: boolean,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    loading ? "正在加载更多…" : "加载更多…",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.myProblemList.${summary.slug}.more`;
  item.iconPath = new vscode.ThemeIcon(loading ? "loading~spin" : "more");
  if (!loading) {
    item.command = {
      command: "leetdock.loadMoreMyProblemList",
      title: "加载更多题目",
      arguments: [summary.slug],
    };
  }
  item.contextValue = "leetdock.myProblemList.more";
  return item;
}

function libraryItem(): vscode.TreeItem {
  const item = new vscode.TreeItem("题库", vscode.TreeItemCollapsibleState.Collapsed);
  item.id = "leetdock.library";
  item.iconPath = new vscode.ThemeIcon("library");
  item.contextValue = "leetdock.library";
  return item;
}

function difficultiesItem(): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "难度/difficulty",
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = "leetdock.difficulties";
  item.iconPath = new vscode.ThemeIcon("symbol-enum");
  item.description = "3 个";
  item.tooltip = "按力扣官方难度浏览题目";
  item.contextValue = "leetdock.difficulties";
  return item;
}

function difficultyItem(
  difficulty: Difficulty,
  detail: DifficultyDetailState | undefined,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${difficultyName(difficulty)}/${difficulty.toLowerCase()}`,
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = `leetdock.difficulty.${difficulty.toLowerCase()}`;
  item.description = detail === undefined ? undefined : `${detail.total} 题`;
  item.tooltip = detail === undefined
    ? `力扣${difficultyName(difficulty)}题目`
    : `力扣${difficultyName(difficulty)}题目 · ${detail.total} 题`;
  item.iconPath = new vscode.ThemeIcon(
    "circle-filled",
    new vscode.ThemeColor(difficultyColor(difficulty)),
  );
  item.contextValue = "leetdock.difficulty";
  return item;
}

function difficultyStatusItem(
  difficulty: Difficulty,
  status: "empty" | "error" | "loading",
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    status === "loading"
      ? `正在加载${difficultyName(difficulty)}题目…`
      : status === "empty"
      ? `暂无${difficultyName(difficulty)}题目`
      : "加载失败 · 点击重试",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.difficulty.${difficulty.toLowerCase()}.${status}`;
  item.iconPath = new vscode.ThemeIcon(
    status === "loading" ? "loading~spin" : status === "empty" ? "info" : "refresh",
  );
  if (status === "error") {
    item.command = {
      command: "leetdock.refreshDifficulty",
      title: "刷新难度题目",
      arguments: [difficulty],
    };
  }
  item.contextValue = `leetdock.difficulty.${status}`;
  return item;
}

function difficultyProblemItem(
  difficulty: Difficulty,
  problem: ProblemSummary,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${problem.frontendId}. ${displayTitle(problem)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.difficulty.${difficulty.toLowerCase()}.problem.${problem.titleSlug}`;
  item.description = [difficultyLabel(problem), statusLabel(problem)]
    .filter((part) => part.length > 0)
    .join(" · ");
  item.tooltip = `${problem.title}\nhttps://leetcode.cn/problems/${problem.titleSlug}/`;
  item.iconPath = new vscode.ThemeIcon(problemIcon(problem));
  item.command = {
    command: "leetdock.openProblem",
    title: "打开难度题库中的题目",
    arguments: [problem.titleSlug],
  };
  item.contextValue = "leetdock.difficulty.problem";
  return item;
}

function difficultyMoreItem(
  difficulty: Difficulty,
  loading: boolean,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    loading ? "正在加载更多…" : "加载更多…",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.difficulty.${difficulty.toLowerCase()}.more`;
  item.iconPath = new vscode.ThemeIcon(loading ? "loading~spin" : "more");
  if (!loading) {
    item.command = {
      command: "leetdock.loadMoreDifficulty",
      title: "加载更多难度题目",
      arguments: [difficulty],
    };
  }
  item.contextValue = "leetdock.difficulty.more";
  return item;
}

function tagsItem(view: TagsViewState): vscode.TreeItem {
  const item = new vscode.TreeItem("标签/tag", vscode.TreeItemCollapsibleState.Collapsed);
  item.id = "leetdock.tags";
  item.iconPath = new vscode.ThemeIcon("tag");
  item.contextValue = `leetdock.tags.${view.kind}`;
  if (view.kind === "loading") {
    item.description = "正在加载";
  } else if (view.kind === "error") {
    item.description = "加载失败";
    item.tooltip = "无法获取标签题库；展开后点击重试";
  } else if (view.kind === "ready") {
    item.description = `${view.tags.length} 个`;
    item.tooltip = `官方标签题库 · ${view.tags.length} 个标签`;
  }
  return item;
}

function tagSearchItem(): vscode.TreeItem {
  const item = new vscode.TreeItem("搜索标签…", vscode.TreeItemCollapsibleState.None);
  item.id = "leetdock.tag.search";
  item.iconPath = new vscode.ThemeIcon("search");
  item.command = { command: "leetdock.searchTag", title: "搜索标签" };
  item.contextValue = "leetdock.tag.search";
  return item;
}

function tagsStatusItem(
  status: "empty" | "error" | "loading",
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    status === "loading"
      ? "正在获取标签列表…"
      : status === "empty"
      ? "暂无标签"
      : "加载失败 · 点击重试",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.tags.${status}`;
  item.iconPath = new vscode.ThemeIcon(
    status === "loading" ? "loading~spin" : status === "empty" ? "info" : "refresh",
  );
  if (status === "error") {
    item.command = { command: "leetdock.refreshTags", title: "刷新标签列表" };
  }
  item.contextValue = `leetdock.tags.${status}`;
  return item;
}

function tagItem(
  summary: ProblemTag,
  detail: TagDetailState | undefined,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    displayTagName(summary),
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = `leetdock.tag.${summary.slug}`;
  item.description = detail === undefined ? undefined : `${detail.total} 题`;
  const names = summary.translatedName === undefined
    ? [summary.name]
    : [summary.translatedName, summary.name];
  item.tooltip = `${names.join("\n")} · ${summary.slug}`;
  item.iconPath = new vscode.ThemeIcon("tag");
  item.contextValue = "leetdock.tag";
  return item;
}

function tagStatusItem(
  summary: ProblemTag,
  status: "empty" | "error" | "loading",
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    status === "loading"
      ? "正在加载标签题目…"
      : status === "empty"
      ? "该标签下暂无题目"
      : "加载失败 · 点击重试",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.tag.${summary.slug}.${status}`;
  item.iconPath = new vscode.ThemeIcon(
    status === "loading" ? "loading~spin" : status === "empty" ? "info" : "refresh",
  );
  if (status === "error") {
    item.command = {
      command: "leetdock.refreshTag",
      title: "刷新标签题目",
      arguments: [summary.slug],
    };
  }
  item.contextValue = `leetdock.tag.${status}`;
  return item;
}

function tagProblemItem(
  tagSlug: string,
  problem: ProblemSummary,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${problem.frontendId}. ${displayTitle(problem)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.tag.${tagSlug}.problem.${problem.titleSlug}`;
  item.description = [difficultyLabel(problem), statusLabel(problem)]
    .filter((part) => part.length > 0)
    .join(" · ");
  item.tooltip = `${problem.title}\nhttps://leetcode.cn/problems/${problem.titleSlug}/`;
  item.iconPath = new vscode.ThemeIcon(problemIcon(problem));
  item.command = {
    command: "leetdock.openProblem",
    title: "打开标签题目",
    arguments: [problem.titleSlug],
  };
  item.contextValue = "leetdock.tag.problem";
  return item;
}

function tagMoreItem(
  summary: ProblemTag,
  loading: boolean,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    loading ? "正在加载更多…" : "加载更多…",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.tag.${summary.slug}.more`;
  item.iconPath = new vscode.ThemeIcon(loading ? "loading~spin" : "more");
  if (!loading) {
    item.command = {
      command: "leetdock.loadMoreTag",
      title: "加载更多标签题目",
      arguments: [summary.slug],
    };
  }
  item.contextValue = "leetdock.tag.more";
  return item;
}

function companiesItem(
  view: CompaniesViewState,
  auth: AuthSnapshot,
): vscode.TreeItem {
  const item = new vscode.TreeItem("公司", vscode.TreeItemCollapsibleState.Collapsed);
  item.id = "leetdock.companies";
  item.iconPath = new vscode.ThemeIcon("organization");
  item.contextValue = `leetdock.companies.${view.kind}`;
  if (auth.status === "signed-out") {
    item.description = "登录后查看";
  } else if (auth.status === "verifying") {
    item.description = "正在验证";
  } else if (auth.status === "offline" || view.kind === "error") {
    item.description = "加载失败";
    item.tooltip = "无法获取公司题库；展开后点击重试";
  } else if (auth.user?.isPremium !== true) {
    item.description = "需要 Plus";
    item.tooltip = "公司高频题是力扣 Plus 会员内容";
  } else if (view.kind === "loading") {
    item.description = "正在加载";
  } else if (view.kind === "ready") {
    item.description = `${view.companies.length} 个`;
    item.tooltip = `官方公司题库 · ${view.companies.length} 个公司`;
  }
  return item;
}

function companySearchItem(): vscode.TreeItem {
  const item = new vscode.TreeItem("搜索公司…", vscode.TreeItemCollapsibleState.None);
  item.id = "leetdock.company.search";
  item.iconPath = new vscode.ThemeIcon("search");
  item.command = { command: "leetdock.searchCompany", title: "搜索公司" };
  item.contextValue = "leetdock.company.search";
  return item;
}

function companiesStatusItem(
  status: "empty" | "error" | "loading" | "premium" | "sign-in",
): vscode.TreeItem {
  const label = status === "sign-in"
    ? "登录后查看公司题库"
    : status === "premium"
    ? "升级 Plus 会员后查看"
    : status === "loading"
    ? "正在获取公司列表…"
    : status === "empty"
    ? "暂无公司题库"
    : "加载失败 · 点击重试";
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.id = `leetdock.companies.${status}`;
  item.iconPath = new vscode.ThemeIcon(
    status === "sign-in"
      ? "sign-in"
      : status === "premium"
      ? "star-full"
      : status === "loading"
      ? "loading~spin"
      : status === "empty"
      ? "info"
      : "refresh",
  );
  if (status === "sign-in") {
    item.command = { command: "leetdock.signIn", title: "登录" };
  } else if (status === "premium") {
    item.command = {
      command: "vscode.open",
      title: "查看 Plus 会员",
      arguments: [vscode.Uri.parse("https://leetcode.cn/premium/")],
    };
  } else if (status === "error") {
    item.command = { command: "leetdock.refreshCompanies", title: "刷新公司列表" };
  }
  item.contextValue = `leetdock.companies.${status}`;
  return item;
}

function companyItem(
  summary: CompanySummary,
  detail: CompanyDetailState | undefined,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    displayCompanyName(summary),
    vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.id = `leetdock.company.${summary.slug}`;
  item.description = detail === undefined ? undefined : `${detail.total} 题`;
  item.tooltip = detail === undefined
    ? `${summary.name}\n官方公司题库`
    : `${summary.name}\n官方默认时间范围 · ${detail.total} 题`;
  item.iconPath = new vscode.ThemeIcon("organization");
  item.contextValue = "leetdock.company";
  return item;
}

function companyStatusItem(
  summary: CompanySummary,
  status: "empty" | "error" | "loading",
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    status === "loading"
      ? "正在加载公司题目…"
      : status === "empty"
      ? "当前范围内暂无题目"
      : "加载失败 · 点击重试",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.company.${summary.slug}.${status}`;
  item.iconPath = new vscode.ThemeIcon(
    status === "loading" ? "loading~spin" : status === "empty" ? "info" : "refresh",
  );
  if (status === "error") {
    item.command = {
      command: "leetdock.refreshCompany",
      title: "刷新公司题目",
      arguments: [summary.slug],
    };
  }
  item.contextValue = `leetdock.company.${status}`;
  return item;
}

function companyProblemItem(
  companySlug: string,
  problem: CompanyQuestion,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `${problem.frontendId}. ${displayTitle(problem)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.company.${companySlug}.problem.${problem.titleSlug}`;
  item.description = [difficultyLabel(problem), statusLabel(problem)]
    .filter((part) => part.length > 0)
    .join(" · ");
  item.tooltip = [
    problem.title,
    ...(problem.frequency === undefined
      ? []
      : [`出题频率：${formatFrequency(problem.frequency)}`]),
    `https://leetcode.cn/problems/${problem.titleSlug}/`,
  ].join("\n");
  item.iconPath = new vscode.ThemeIcon(problemIcon(problem));
  item.command = {
    command: "leetdock.openProblem",
    title: "打开公司题目",
    arguments: [problem.titleSlug],
  };
  item.contextValue = "leetdock.company.problem";
  return item;
}

function companyMoreItem(
  summary: CompanySummary,
  loading: boolean,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    loading ? "正在加载更多…" : "加载更多…",
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `leetdock.company.${summary.slug}.more`;
  item.iconPath = new vscode.ThemeIcon(loading ? "loading~spin" : "more");
  if (!loading) {
    item.command = {
      command: "leetdock.loadMoreCompany",
      title: "加载更多公司题目",
      arguments: [summary.slug],
    };
  }
  item.contextValue = "leetdock.company.more";
  return item;
}

function formatFrequency(frequency: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(frequency);
}

function hasSignedInUser(snapshot: AuthSnapshot): boolean {
  return snapshot.status !== "signed-out" && snapshot.user?.isSignedIn === true;
}

function hasOnlineSignedInUser(snapshot: AuthSnapshot): boolean {
  return snapshot.status === "signed-in" && snapshot.user?.isSignedIn === true;
}

function hasOnlinePremiumUser(snapshot: AuthSnapshot): boolean {
  return hasOnlineSignedInUser(snapshot) && snapshot.user?.isPremium === true;
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

function displayTitle(problem: ProblemSummary): string {
  return problem.translatedTitle?.trim() || problem.title;
}

function difficultyLabel(problem: ProblemSummary): string {
  return difficultyName(problem.difficulty);
}

function difficultyName(difficulty: Difficulty): string {
  switch (difficulty) {
    case "Easy":
      return "简单";
    case "Medium":
      return "中等";
    case "Hard":
      return "困难";
  }
}

function difficultyColor(difficulty: Difficulty): string {
  switch (difficulty) {
    case "Easy":
      return "testing.iconPassed";
    case "Medium":
      return "list.warningForeground";
    case "Hard":
      return "list.errorForeground";
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

function problemListStatusLabel(problem: ProblemListQuestion): string {
  if (problem.status === "AC") {
    return "本轮已完成";
  }
  if (problem.status === "TRIED") {
    return "本轮尝试过";
  }
  if (problem.previouslySolved) {
    return "曾通过";
  }
  return problem.paidOnly ? "会员" : "";
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
