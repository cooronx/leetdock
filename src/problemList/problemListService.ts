import type { LeetCodeApi } from "../leetcode/api";
import { LeetCodeError } from "../leetcode/errors";
import type {
  ProblemListPage,
  ProblemListProgress,
  ProblemListQuestion,
  ProblemListSummary,
} from "../leetcode/types";

export const PROBLEM_LIST_PAGE_SIZE = 50;

export interface ProblemListDetailState {
  readonly summary: ProblemListSummary;
  readonly questions: readonly ProblemListQuestion[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly progress: ProblemListProgress;
}

export class ProblemListService {
  private generation = 0;
  private catalog: readonly ProblemListSummary[] | undefined;
  private readonly details = new Map<string, ProblemListDetailState>();

  public constructor(private readonly client: LeetCodeApi) {}

  public get catalogSnapshot(): readonly ProblemListSummary[] | undefined {
    return this.catalog;
  }

  public getDetailSnapshot(slug: string): ProblemListDetailState | undefined {
    return this.details.get(slug);
  }

  public async loadCatalog(): Promise<readonly ProblemListSummary[]> {
    if (this.catalog !== undefined) {
      return this.catalog;
    }
    const generation = this.generation;
    const catalog = await this.client.getMyProblemLists();
    this.assertCurrent(generation);
    this.catalog = catalog;
    return catalog;
  }

  public async loadDetail(
    summary: ProblemListSummary,
  ): Promise<ProblemListDetailState> {
    const existing = this.details.get(summary.slug);
    if (existing !== undefined) {
      return existing;
    }
    const generation = this.generation;
    const [page, progress] = await Promise.all([
      this.client.getProblemListQuestions(summary.slug, 0, PROBLEM_LIST_PAGE_SIZE),
      this.client.getProblemListProgress(summary.slug),
    ]);
    this.assertCurrent(generation);
    const state = detailState(summary, page, progress);
    this.details.set(summary.slug, state);
    return state;
  }

  public async loadMore(slug: string): Promise<ProblemListDetailState> {
    const current = this.details.get(slug);
    if (current === undefined) {
      throw new LeetCodeError("not-found", `Problem list is not loaded: ${slug}`);
    }
    if (!current.hasMore) {
      return current;
    }
    const generation = this.generation;
    const page = await this.client.getProblemListQuestions(
      slug,
      current.questions.length,
      PROBLEM_LIST_PAGE_SIZE,
    );
    this.assertCurrent(generation);
    const known = new Set(current.questions.map((problem) => problem.titleSlug));
    const state: ProblemListDetailState = {
      ...current,
      questions: [
        ...current.questions,
        ...page.questions.filter((problem) => !known.has(problem.titleSlug)),
      ],
      total: Math.max(current.total, page.total),
      hasMore: page.questions.length > 0 && page.hasMore,
    };
    this.details.set(slug, state);
    return state;
  }

  public async refreshLoadedAfterAccepted(titleSlug: string): Promise<void> {
    const generation = this.generation;
    const loaded = [...this.details.values()];
    const results = await Promise.allSettled(loaded.map(async (state) => {
      const containsProblem = state.questions.some(
        (problem) => problem.titleSlug === titleSlug,
      );
      const [progress, accepted] = await Promise.all([
        this.client.getProblemListProgress(state.summary.slug),
        containsProblem
          ? this.client.getProblemListQuestionAccepted(state.summary.slug, titleSlug)
          : Promise.resolve(false),
      ]);
      this.assertCurrent(generation);
      const next: ProblemListDetailState = {
        ...state,
        progress,
        questions: accepted
          ? state.questions.map((problem) =>
            problem.titleSlug === titleSlug
              ? { ...problem, status: "AC", previouslySolved: false }
              : problem
          )
          : state.questions,
      };
      this.details.set(state.summary.slug, next);
    }));
    this.assertCurrent(generation);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) {
      throw failure.reason;
    }
  }

  public reset(): void {
    this.generation += 1;
    this.catalog = undefined;
    this.details.clear();
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) {
      throw new LeetCodeError(
        "stale-session",
        "Authentication changed while loading problem lists.",
      );
    }
  }
}

function detailState(
  summary: ProblemListSummary,
  page: ProblemListPage,
  progress: ProblemListProgress,
): ProblemListDetailState {
  return {
    summary,
    questions: page.questions,
    total: page.total,
    hasMore: page.hasMore,
    progress,
  };
}
