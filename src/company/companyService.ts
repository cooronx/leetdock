import type { LeetCodeApi } from "../leetcode/api";
import { LeetCodeError } from "../leetcode/errors";
import type {
  CompanyQuestion,
  CompanySummary,
} from "../leetcode/types";

export const COMPANY_QUESTION_PAGE_SIZE = 50;

export interface CompanyDetailState {
  readonly summary: CompanySummary;
  readonly favoriteSlug: string;
  readonly questions: readonly CompanyQuestion[];
  readonly total: number;
  readonly hasMore: boolean;
}

export class CompanyService {
  private generation = 0;
  private catalog: readonly CompanySummary[] | undefined;
  private readonly details = new Map<string, CompanyDetailState>();

  public constructor(private readonly client: LeetCodeApi) {}

  public get catalogSnapshot(): readonly CompanySummary[] | undefined {
    return this.catalog;
  }

  public getDetailSnapshot(slug: string): CompanyDetailState | undefined {
    return this.details.get(slug);
  }

  public async loadCatalog(): Promise<readonly CompanySummary[]> {
    if (this.catalog !== undefined) {
      return this.catalog;
    }
    const generation = this.generation;
    const catalog = await this.client.getCompanies();
    this.assertCurrent(generation);
    this.catalog = [...catalog].sort((left, right) =>
      displayCompanyName(left).localeCompare(displayCompanyName(right), "zh-CN", {
        sensitivity: "base",
      })
    );
    return this.catalog;
  }

  public async loadDetail(summary: CompanySummary): Promise<CompanyDetailState> {
    const existing = this.details.get(summary.slug);
    if (existing !== undefined) {
      return existing;
    }
    const generation = this.generation;
    const source = await this.client.getCompanyQuestionSource(summary.slug);
    const page = await this.client.getCompanyQuestions(
      summary.slug,
      source.favoriteSlug,
      0,
      COMPANY_QUESTION_PAGE_SIZE,
    );
    this.assertCurrent(generation);
    const state: CompanyDetailState = {
      summary,
      favoriteSlug: source.favoriteSlug,
      questions: page.questions,
      total: page.total,
      hasMore: page.hasMore,
    };
    this.details.set(summary.slug, state);
    return state;
  }

  public async loadMore(slug: string): Promise<CompanyDetailState> {
    const current = this.details.get(slug);
    if (current === undefined) {
      throw new LeetCodeError("not-found", `Company is not loaded: ${slug}`);
    }
    if (!current.hasMore) {
      return current;
    }
    const generation = this.generation;
    const page = await this.client.getCompanyQuestions(
      slug,
      current.favoriteSlug,
      current.questions.length,
      COMPANY_QUESTION_PAGE_SIZE,
    );
    this.assertCurrent(generation);
    const known = new Set(current.questions.map((problem) => problem.titleSlug));
    const state: CompanyDetailState = {
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
        "Authentication changed while loading company questions.",
      );
    }
  }
}

export function displayCompanyName(company: CompanySummary): string {
  return company.translatedName?.trim() || company.name;
}
