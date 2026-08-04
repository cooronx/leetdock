import type {
  ProblemDetail,
  ProblemSearchPage,
  ProblemStatus,
  ProblemSummary,
} from "../leetcode/types";
import { CacheStorage } from "../storage/cacheStorage";

const SEARCH_TTL_MS = 24 * 60 * 60 * 1_000;
const INDEX_TTL_MS = SEARCH_TTL_MS;
const DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const RECENT_LIMIT = 20;

const INDEX_KEY = "problem.index";
const RECENT_KEY = "problem.recent";
const USER_STATUSES_KEY = "problem.userStatuses";
const SEARCH_PREFIX = "problem.search.";
const DETAIL_PREFIX = "problem.detail.";

export interface RecentProblem extends ProblemSummary {
  readonly openedAt: number;
}

type StoredStatus = Exclude<ProblemStatus, null>;
type UserStatuses = Readonly<Record<string, StoredStatus>>;

export class ProblemCache {
  public constructor(private readonly cache: CacheStorage) {}

  public async getSearch(key: string): Promise<ProblemSearchPage | undefined> {
    const page = await this.cache.get<ProblemSearchPage>(`${SEARCH_PREFIX}${key}`);
    return page === undefined
      ? undefined
      : { ...page, questions: await this.withStatuses(page.questions) };
  }

  public async setSearch(key: string, page: ProblemSearchPage): Promise<void> {
    await this.captureStatuses(page.questions);
    await this.cache.set(
      `${SEARCH_PREFIX}${key}`,
      { ...page, questions: page.questions.map(stripStatus) },
      SEARCH_TTL_MS,
    );
  }

  public async getIndex(): Promise<readonly ProblemSummary[] | undefined> {
    const index = await this.cache.get<readonly ProblemSummary[]>(INDEX_KEY);
    return index === undefined ? undefined : this.withStatuses(index);
  }

  public async setIndex(index: readonly ProblemSummary[]): Promise<void> {
    await this.captureStatuses(index);
    await this.cache.set(INDEX_KEY, index.map(stripStatus), INDEX_TTL_MS);
  }

  public async getDetail(titleSlug: string): Promise<ProblemDetail | undefined> {
    const detail = await this.cache.get<ProblemDetail>(
      `${DETAIL_PREFIX}${normalizeSlug(titleSlug)}`,
    );
    if (detail === undefined) {
      return undefined;
    }
    if (detail.paidOnly) {
      await this.deleteDetail(detail.titleSlug);
      return undefined;
    }
    const [withStatus] = await this.withStatuses([detail]);
    return withStatus;
  }

  public async setDetail(detail: ProblemDetail): Promise<void> {
    await this.captureStatuses([detail]);
    if (detail.paidOnly) {
      // Paid content is account-scoped and must never survive a login boundary.
      await this.deleteDetail(detail.titleSlug);
      return;
    }
    await this.cache.set(
      `${DETAIL_PREFIX}${normalizeSlug(detail.titleSlug)}`,
      stripStatus(detail),
      DETAIL_TTL_MS,
    );
  }

  public async deleteDetail(titleSlug: string): Promise<void> {
    await this.cache.delete(`${DETAIL_PREFIX}${normalizeSlug(titleSlug)}`);
  }

  public async addRecent(problem: ProblemSummary): Promise<void> {
    await this.captureStatuses([problem]);
    const existing = await this.cache.get<readonly RecentProblem[]>(RECENT_KEY) ?? [];
    const recent: RecentProblem = {
      ...stripStatus(problem),
      openedAt: Date.now(),
    };
    const next = [
      recent,
      ...existing.filter((item) => item.titleSlug !== problem.titleSlug),
    ].slice(0, RECENT_LIMIT);
    await this.cache.set(RECENT_KEY, next);
  }

  public async getRecent(): Promise<readonly RecentProblem[]> {
    const recent = await this.cache.get<readonly RecentProblem[]>(RECENT_KEY) ?? [];
    return this.withStatuses(recent);
  }

  public async clearProblemLists(): Promise<void> {
    await Promise.all([
      this.cache.delete(INDEX_KEY),
      this.cache.clear(SEARCH_PREFIX),
    ]);
  }

  public async clearUserData(): Promise<void> {
    await this.cache.delete(USER_STATUSES_KEY);
  }

  public async clearAll(): Promise<void> {
    await Promise.all([
      this.clearProblemLists(),
      this.cache.clear(DETAIL_PREFIX),
      this.cache.delete(RECENT_KEY),
      this.clearUserData(),
    ]);
  }

  private async captureStatuses(problems: readonly ProblemSummary[]): Promise<void> {
    const updates = problems.filter(
      (problem): problem is ProblemSummary & { readonly status: StoredStatus } =>
        problem.status !== null,
    );
    if (updates.length === 0) {
      return;
    }

    const current = await this.cache.get<UserStatuses>(USER_STATUSES_KEY) ?? {};
    const next: Record<string, StoredStatus> = { ...current };
    for (const problem of updates) {
      next[problem.titleSlug] = problem.status;
    }
    await this.cache.set(USER_STATUSES_KEY, next);
  }

  private async withStatuses<T extends ProblemSummary>(
    problems: readonly T[],
  ): Promise<readonly T[]> {
    const statuses = await this.cache.get<UserStatuses>(USER_STATUSES_KEY) ?? {};
    return problems.map((problem) => ({
      ...problem,
      status: statuses[problem.titleSlug] ?? null,
    }));
  }
}

function stripStatus<T extends ProblemSummary>(problem: T): T {
  return { ...problem, status: null };
}

function normalizeSlug(titleSlug: string): string {
  return encodeURIComponent(titleSlug.trim());
}
