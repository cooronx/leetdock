import type { LeetCodeApi } from "../leetcode/api";
import { LeetCodeError } from "../leetcode/errors";
import type {
  Difficulty,
  ProblemSearchPage,
  ProblemSummary,
} from "../leetcode/types";

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
  private generation = 0;
  private readonly details = new Map<Difficulty, DifficultyDetailState>();

  public constructor(private readonly client: LeetCodeApi) {}

  public getDetailSnapshot(
    difficulty: Difficulty,
  ): DifficultyDetailState | undefined {
    return this.details.get(difficulty);
  }

  public async loadDetail(difficulty: Difficulty): Promise<DifficultyDetailState> {
    const existing = this.details.get(difficulty);
    if (existing !== undefined) {
      return existing;
    }
    const generation = this.generation;
    const page = await this.client.getDifficultyQuestions(
      difficulty,
      0,
      DIFFICULTY_QUESTION_PAGE_SIZE,
    );
    this.assertCurrent(generation);
    const state = detailState(difficulty, page);
    this.details.set(difficulty, state);
    return state;
  }

  public async loadMore(difficulty: Difficulty): Promise<DifficultyDetailState> {
    const current = this.details.get(difficulty);
    if (current === undefined) {
      throw new LeetCodeError(
        "not-found",
        `Difficulty is not loaded: ${difficulty}`,
      );
    }
    if (!current.hasMore) {
      return current;
    }
    const generation = this.generation;
    const page = await this.client.getDifficultyQuestions(
      difficulty,
      current.questions.length,
      DIFFICULTY_QUESTION_PAGE_SIZE,
    );
    this.assertCurrent(generation);
    const known = new Set(current.questions.map((problem) => problem.titleSlug));
    const state: DifficultyDetailState = {
      ...current,
      questions: [
        ...current.questions,
        ...page.questions.filter((problem) => !known.has(problem.titleSlug)),
      ],
      total: Math.max(current.total, page.total),
      hasMore: page.questions.length > 0 && page.hasMore,
    };
    this.details.set(difficulty, state);
    return state;
  }

  public markAccepted(titleSlug: string): boolean {
    let changed = false;
    for (const [difficulty, state] of this.details) {
      if (!state.questions.some(
        (problem) => problem.titleSlug === titleSlug && problem.status !== "AC",
      )) {
        continue;
      }
      this.details.set(difficulty, {
        ...state,
        questions: state.questions.map((problem) =>
          problem.titleSlug === titleSlug
            ? { ...problem, status: "AC" as const }
            : problem
        ),
      });
      changed = true;
    }
    return changed;
  }

  public reset(): void {
    this.generation += 1;
    this.details.clear();
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) {
      throw new LeetCodeError(
        "stale-session",
        "Authentication changed while loading difficulty questions.",
      );
    }
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
