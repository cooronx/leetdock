import type { LeetCodeApi } from "../leetcode/api";
import { LeetCodeError } from "../leetcode/errors";
import type {
  ProblemSummary,
  ProblemTag,
  TagQuestionPage,
} from "../leetcode/types";

export const TAG_QUESTION_PAGE_SIZE = 50;

export interface TagDetailState {
  readonly summary: ProblemTag;
  readonly questions: readonly ProblemSummary[];
  readonly total: number;
  readonly hasMore: boolean;
}

export class TagService {
  private generation = 0;
  private catalog: readonly ProblemTag[] | undefined;
  private readonly details = new Map<string, TagDetailState>();

  public constructor(private readonly client: LeetCodeApi) {}

  public get catalogSnapshot(): readonly ProblemTag[] | undefined {
    return this.catalog;
  }

  public getDetailSnapshot(slug: string): TagDetailState | undefined {
    return this.details.get(slug);
  }

  public async loadCatalog(): Promise<readonly ProblemTag[]> {
    if (this.catalog !== undefined) {
      return this.catalog;
    }
    const generation = this.generation;
    const catalog = await this.client.getTags();
    this.assertCurrent(generation);
    this.catalog = [...catalog].sort((left, right) =>
      displayTagName(left).localeCompare(displayTagName(right), "zh-CN", {
        sensitivity: "base",
      })
    );
    return this.catalog;
  }

  public async loadDetail(summary: ProblemTag): Promise<TagDetailState> {
    const existing = this.details.get(summary.slug);
    if (existing !== undefined) {
      return existing;
    }
    const generation = this.generation;
    const page = await this.client.getTagQuestions(
      summary.slug,
      0,
      TAG_QUESTION_PAGE_SIZE,
    );
    this.assertCurrent(generation);
    const state = detailState(summary, page);
    this.details.set(summary.slug, state);
    return state;
  }

  public async loadMore(slug: string): Promise<TagDetailState> {
    const current = this.details.get(slug);
    if (current === undefined) {
      throw new LeetCodeError("not-found", `Tag is not loaded: ${slug}`);
    }
    if (!current.hasMore) {
      return current;
    }
    const generation = this.generation;
    const page = await this.client.getTagQuestions(
      slug,
      current.questions.length,
      TAG_QUESTION_PAGE_SIZE,
    );
    this.assertCurrent(generation);
    const known = new Set(current.questions.map((problem) => problem.titleSlug));
    const state: TagDetailState = {
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

  public markAccepted(titleSlug: string): boolean {
    let changed = false;
    for (const [slug, state] of this.details) {
      if (!state.questions.some(
        (problem) => problem.titleSlug === titleSlug && problem.status !== "AC",
      )) {
        continue;
      }
      this.details.set(slug, {
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
    this.catalog = undefined;
    this.details.clear();
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) {
      throw new LeetCodeError(
        "stale-session",
        "Authentication changed while loading tag questions.",
      );
    }
  }
}

export function displayTagName(tag: ProblemTag): string {
  return tag.translatedName?.trim() || tag.name;
}

function detailState(
  summary: ProblemTag,
  page: TagQuestionPage,
): TagDetailState {
  return {
    summary,
    questions: page.questions,
    total: page.total,
    hasMore: page.hasMore,
  };
}
