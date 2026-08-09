import {
  isDebugProblemSpec,
  type DebugProblemSpec,
} from "../debug/problemSpec";
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

const INDEX_KEY = "problem.index";
const USER_STATUSES_KEY = "problem.userStatuses";
const SEARCH_PREFIX = "problem.search.";
const DETAIL_PREFIX = "problem.detail.";
const DEBUG_SPEC_PREFIX = "problem.debugSpec.";

type StoredStatus = Exclude<ProblemStatus, null>;
type UserStatuses = Readonly<Record<string, StoredStatus>>;

export class ProblemCache {
  private userDataGeneration = 0;
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(private readonly cache: CacheStorage) {}

  /** Captures the current account boundary for a request that may return later. */
  public captureUserDataGeneration(): number {
    return this.userDataGeneration;
  }

  public isUserDataGenerationCurrent(generation: number): boolean {
    return generation === this.userDataGeneration;
  }

  public async getSearch(key: string): Promise<ProblemSearchPage | undefined> {
    const page = await this.cache.get<ProblemSearchPage>(`${SEARCH_PREFIX}${key}`);
    return page === undefined
      ? undefined
      : { ...page, questions: await this.withStatuses(page.questions) };
  }

  public setSearch(
    key: string,
    page: ProblemSearchPage,
    generation: number,
  ): Promise<void> {
    return this.serializeMutation(async () => {
      if (generation !== this.userDataGeneration) {
        return;
      }
      await this.captureStatusesUnqueued(page.questions, generation);
      await this.cache.set(
        `${SEARCH_PREFIX}${key}`,
        { ...page, questions: page.questions.map(stripStatus) },
        SEARCH_TTL_MS,
      );
    });
  }

  public async getIndex(): Promise<readonly ProblemSummary[] | undefined> {
    const index = await this.cache.get<readonly ProblemSummary[]>(INDEX_KEY);
    return index === undefined ? undefined : this.withStatuses(index);
  }

  public setIndex(
    index: readonly ProblemSummary[],
    generation: number,
  ): Promise<void> {
    return this.serializeMutation(async () => {
      if (generation !== this.userDataGeneration) {
        return;
      }
      await this.captureStatusesUnqueued(index, generation);
      await this.cache.set(INDEX_KEY, index.map(stripStatus), INDEX_TTL_MS);
    });
  }

  public async getDetail(titleSlug: string): Promise<ProblemDetail | undefined> {
    const detail = await this.cache.get<ProblemDetail>(
      `${DETAIL_PREFIX}${normalizeSlug(titleSlug)}`,
    );
    if (detail === undefined) {
      return undefined;
    }
    if (typeof detail.internalId !== "string" || detail.internalId.trim().length === 0) {
      // Details cached by versions before judge support do not contain questionId.
      await this.deleteDetail(detail.titleSlug);
      return undefined;
    }
    if (detail.paidOnly) {
      await this.deleteDetail(detail.titleSlug);
      return undefined;
    }
    const [withStatus] = await this.withStatuses([detail]);
    return withStatus;
  }

  public async getDebugProblemSpec(
    titleSlug: string,
  ): Promise<DebugProblemSpec | undefined> {
    const key = `${DEBUG_SPEC_PREFIX}${normalizeSlug(titleSlug)}`;
    const value = await this.cache.get<unknown>(key);
    if (value === undefined) {
      return undefined;
    }
    if (!isDebugProblemSpec(value)) {
      await this.serializeMutation(() => this.cache.delete(key));
      return undefined;
    }
    return value;
  }

  public setDetail(
    detail: ProblemDetail,
    generation: number,
  ): Promise<void> {
    return this.serializeMutation(async () => {
      if (generation !== this.userDataGeneration) {
        return;
      }
      await this.captureStatusesUnqueued([detail], generation);
      if (detail.paidOnly) {
        // Paid content is account-scoped and must never survive a login boundary.
        await Promise.all([
          this.cache.delete(`${DETAIL_PREFIX}${normalizeSlug(detail.titleSlug)}`),
          this.cache.delete(`${DEBUG_SPEC_PREFIX}${normalizeSlug(detail.titleSlug)}`),
        ]);
        return;
      }
      await Promise.all([
        this.cache.set(
          `${DETAIL_PREFIX}${normalizeSlug(detail.titleSlug)}`,
          stripStatus(detail),
          DETAIL_TTL_MS,
        ),
        ...(detail.debugProblemSpec === undefined
          ? []
          : [
              this.cache.set(
                `${DEBUG_SPEC_PREFIX}${normalizeSlug(detail.titleSlug)}`,
                detail.debugProblemSpec,
              ),
            ]),
      ]);
    });
  }

  public deleteDetail(titleSlug: string): Promise<void> {
    return this.serializeMutation(async () => {
      await Promise.all([
        this.cache.delete(`${DETAIL_PREFIX}${normalizeSlug(titleSlug)}`),
        this.cache.delete(`${DEBUG_SPEC_PREFIX}${normalizeSlug(titleSlug)}`),
      ]);
    });
  }

  public clearProblemLists(): Promise<void> {
    return this.serializeMutation(async () => {
      await Promise.all([
        this.cache.delete(INDEX_KEY),
        this.cache.clear(SEARCH_PREFIX),
      ]);
    });
  }

  public clearUserData(): Promise<void> {
    this.userDataGeneration += 1;
    return this.serializeMutation(() =>
      this.cache.delete(USER_STATUSES_KEY)
    );
  }

  public clearAll(): Promise<void> {
    this.userDataGeneration += 1;
    return this.serializeMutation(() => this.cache.clear("problem."));
  }

  private async captureStatusesUnqueued(
    problems: readonly ProblemSummary[],
    generation: number,
  ): Promise<void> {
    if (generation !== this.userDataGeneration) {
      return;
    }
    const updates = problems.filter(
      (problem): problem is ProblemSummary & { readonly status: StoredStatus } =>
        problem.status !== null,
    );
    if (updates.length === 0) {
      return;
    }

    const current = await this.cache.get<UserStatuses>(USER_STATUSES_KEY) ?? {};
    if (generation !== this.userDataGeneration) {
      return;
    }
    const next: Record<string, StoredStatus> = { ...current };
    for (const problem of updates) {
      next[problem.titleSlug] = problem.status;
    }
    await this.cache.set(USER_STATUSES_KEY, next);
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
