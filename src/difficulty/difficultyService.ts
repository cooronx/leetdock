import { LeetCodeClient } from "../leetcode/client";
import type {
  Difficulty,
  ProblemSearchPage,
  ProblemSummary,
} from "../leetcode/types";
import {
  type PagedDetailLoadState,
  PagedQuestionLibrary,
} from "../library/pagedQuestionLibrary";

export const DIFFICULTY_QUESTION_PAGE_SIZE = 50;

export const DIFFICULTIES: readonly Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
];

export interface DifficultyDetailState {
  readonly difficulty: Difficulty;
  readonly questions: readonly ProblemSummary[];
  readonly total: number;
  readonly hasMore: boolean;
}

export class DifficultyService {
  private readonly library: PagedQuestionLibrary<
    Difficulty,
    Difficulty,
    ProblemSummary,
    DifficultyDetailState
  >;

  public constructor(client: LeetCodeClient) {
    this.library = new PagedQuestionLibrary({
      keyOf: (difficulty) => difficulty,
      loadFirst: async (difficulty) =>
        detailState(
          difficulty,
          await client.getDifficultyQuestions(
            difficulty,
            0,
            DIFFICULTY_QUESTION_PAGE_SIZE,
          ),
        ),
      loadNextPage: (difficulty, current) =>
        client.getDifficultyQuestions(
          difficulty,
          current.questions.length,
          DIFFICULTY_QUESTION_PAGE_SIZE,
        ),
      staleErrorMessage: "Authentication changed while loading difficulty questions.",
      notFoundErrorMessage: (difficulty) =>
        `Difficulty is not loaded: ${difficulty}`,
    });
  }

  public getDetailState(
    difficulty: Difficulty,
  ): PagedDetailLoadState<DifficultyDetailState> {
    return this.library.getDetailState(difficulty);
  }

  public getDetailSnapshot(
    difficulty: Difficulty,
  ): DifficultyDetailState | undefined {
    return this.library.getDetailSnapshot(difficulty);
  }

  public loadDetail(difficulty: Difficulty): Promise<DifficultyDetailState> {
    return this.library.loadDetail(difficulty);
  }

  public loadMore(difficulty: Difficulty): Promise<DifficultyDetailState> {
    return this.library.loadMore(difficulty);
  }

  public markAccepted(titleSlug: string): boolean {
    return this.library.markAccepted(titleSlug);
  }

  public reset(): void {
    this.library.reset();
  }
}

function detailState(
  difficulty: Difficulty,
  page: ProblemSearchPage,
): DifficultyDetailState {
  return {
    difficulty,
    questions: page.questions,
    total: page.total,
    hasMore: page.hasMore,
  };
}
