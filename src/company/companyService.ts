import { LeetCodeClient } from "../leetcode/client";
import type {
  CompanyQuestion,
  CompanySummary,
} from "../leetcode/types";
import {
  type LoadState,
  type PagedDetailLoadState,
  PagedQuestionLibrary,
} from "../library/pagedQuestionLibrary";

export const COMPANY_QUESTION_PAGE_SIZE = 50;

export interface CompanyDetailState {
  readonly summary: CompanySummary;
  readonly favoriteSlug: string;
  readonly questions: readonly CompanyQuestion[];
  readonly total: number;
  readonly hasMore: boolean;
}

export class CompanyService {
  private readonly library: PagedQuestionLibrary<
    string,
    CompanySummary,
    CompanyQuestion,
    CompanyDetailState,
    CompanySummary
  >;

  public constructor(client: LeetCodeClient) {
    this.library = new PagedQuestionLibrary({
      keyOf: (company) => company.slug,
      loadCatalog: async () => {
        const catalog = await client.getCompanies();
        return [...catalog].sort((left, right) =>
          displayCompanyName(left).localeCompare(displayCompanyName(right), "zh-CN", {
            sensitivity: "base",
          })
        );
      },
      loadFirst: async (summary) => {
        const source = await client.getCompanyQuestionSource(summary.slug);
        const page = await client.getCompanyQuestions(
          summary.slug,
          source.favoriteSlug,
          0,
          COMPANY_QUESTION_PAGE_SIZE,
        );
        return {
          summary,
          favoriteSlug: source.favoriteSlug,
          questions: page.questions,
          total: page.total,
          hasMore: page.hasMore,
        };
      },
      loadNextPage: (slug, current) =>
        client.getCompanyQuestions(
          slug,
          current.favoriteSlug,
          current.questions.length,
          COMPANY_QUESTION_PAGE_SIZE,
        ),
      staleErrorMessage: "Authentication changed while loading company questions.",
      notFoundErrorMessage: (slug) => `Company is not loaded: ${slug}`,
    });
  }

  public get catalogState(): LoadState<readonly CompanySummary[]> {
    return this.library.catalogState;
  }

  public get catalogSnapshot(): readonly CompanySummary[] | undefined {
    return this.library.catalogSnapshot;
  }

  public getDetailState(slug: string): PagedDetailLoadState<CompanyDetailState> {
    return this.library.getDetailState(slug);
  }

  public getDetailSnapshot(slug: string): CompanyDetailState | undefined {
    return this.library.getDetailSnapshot(slug);
  }

  public loadCatalog(): Promise<readonly CompanySummary[]> {
    return this.library.loadCatalog();
  }

  public loadDetail(summary: CompanySummary): Promise<CompanyDetailState> {
    return this.library.loadDetail(summary);
  }

  public loadMore(slug: string): Promise<CompanyDetailState> {
    return this.library.loadMore(slug);
  }

  public markAccepted(titleSlug: string): boolean {
    return this.library.markAccepted(titleSlug);
  }

  public reset(): void {
    this.library.reset();
  }
}

export function displayCompanyName(company: CompanySummary): string {
  return company.translatedName?.trim() || company.name;
}
