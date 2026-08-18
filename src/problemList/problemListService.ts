import { LeetCodeClient } from "../leetcode/client";
import type {
  ProblemListPage,
  ProblemListProgress,
  ProblemListQuestion,
  ProblemListSummary,
} from "../leetcode/types";
import {
  type LoadState,
  type PagedDetailLoadState,
  PagedQuestionLibrary,
} from "../library/pagedQuestionLibrary";

export const PROBLEM_LIST_PAGE_SIZE = 50;

export interface ProblemListDetailState {
  readonly summary: ProblemListSummary;
  readonly questions: readonly ProblemListQuestion[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly progress: ProblemListProgress;
}

export class ProblemListService {
  private readonly library: PagedQuestionLibrary<
    string,
    ProblemListSummary,
    ProblemListQuestion,
    ProblemListDetailState,
    ProblemListSummary
  >;

  public constructor(private readonly client: LeetCodeClient) {
    this.library = new PagedQuestionLibrary({
      keyOf: (list) => list.slug,
      loadCatalog: () => client.getMyProblemLists(),
      loadFirst: async (summary) => {
        const [page, progress] = await Promise.all([
          client.getProblemListQuestions(summary.slug, 0, PROBLEM_LIST_PAGE_SIZE),
          client.getProblemListProgress(summary.slug),
        ]);
        return detailState(summary, page, progress);
      },
      loadNextPage: (slug, current) =>
        client.getProblemListQuestions(
          slug,
          current.questions.length,
          PROBLEM_LIST_PAGE_SIZE,
        ),
      staleErrorMessage: "Authentication changed while loading problem lists.",
      notFoundErrorMessage: (slug) => `Problem list is not loaded: ${slug}`,
      acceptQuestion: (question) => ({
        ...question,
        status: "AC",
        previouslySolved: false,
      }),
    });
  }

  public get catalogState(): LoadState<readonly ProblemListSummary[]> {
    return this.library.catalogState;
  }

  public get catalogSnapshot(): readonly ProblemListSummary[] | undefined {
    return this.library.catalogSnapshot;
  }

  public getDetailState(
    slug: string,
  ): PagedDetailLoadState<ProblemListDetailState> {
    return this.library.getDetailState(slug);
  }

  public getDetailSnapshot(slug: string): ProblemListDetailState | undefined {
    return this.library.getDetailSnapshot(slug);
  }

  public loadCatalog(): Promise<readonly ProblemListSummary[]> {
    return this.library.loadCatalog();
  }

  public loadDetail(
    summary: ProblemListSummary,
  ): Promise<ProblemListDetailState> {
    return this.library.loadDetail(summary);
  }

  public loadMore(slug: string): Promise<ProblemListDetailState> {
    return this.library.loadMore(slug);
  }

  public refreshLoadedAfterAccepted(titleSlug: string): Promise<void> {
    return this.library.refreshLoaded(
      async (_slug, state) => {
        const containsProblem = state.questions.some(
          (problem) => problem.titleSlug === titleSlug,
        );
        const [progress, accepted] = await Promise.all([
          this.client.getProblemListProgress(state.summary.slug),
          containsProblem
            ? this.client.getProblemListQuestionAccepted(state.summary.slug, titleSlug)
            : Promise.resolve(false),
        ]);
        return { progress, accepted };
      },
      (state, update) => ({
        ...state,
        progress: update.progress,
        questions: update.accepted
          ? state.questions.map((problem) =>
            problem.titleSlug === titleSlug
              ? { ...problem, status: "AC", previouslySolved: false }
              : problem
          )
          : state.questions,
      }),
    );
  }

  public reset(): void {
    this.library.reset();
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
