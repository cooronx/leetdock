import { LeetCodeClient } from "../leetcode/client";
import type {
  ProblemSummary,
  ProblemTag,
  TagQuestionPage,
} from "../leetcode/types";
import {
  type LoadState,
  type PagedDetailLoadState,
  PagedQuestionLibrary,
} from "../library/pagedQuestionLibrary";

export const TAG_QUESTION_PAGE_SIZE = 50;

export interface TagDetailState {
  readonly summary: ProblemTag;
  readonly questions: readonly ProblemSummary[];
  readonly total: number;
  readonly hasMore: boolean;
}

export class TagService {
  private readonly library: PagedQuestionLibrary<
    string,
    ProblemTag,
    ProblemSummary,
    TagDetailState,
    ProblemTag
  >;

  public constructor(client: LeetCodeClient) {
    this.library = new PagedQuestionLibrary({
      keyOf: (tag) => tag.slug,
      loadCatalog: async () => {
        const catalog = await client.getTags();
        return [...catalog].sort((left, right) =>
          displayTagName(left).localeCompare(displayTagName(right), "zh-CN", {
            sensitivity: "base",
          })
        );
      },
      loadFirst: async (summary) =>
        detailState(
          summary,
          await client.getTagQuestions(summary.slug, 0, TAG_QUESTION_PAGE_SIZE),
        ),
      loadNextPage: (slug, current) =>
        client.getTagQuestions(
          slug,
          current.questions.length,
          TAG_QUESTION_PAGE_SIZE,
        ),
      staleErrorMessage: "Authentication changed while loading tag questions.",
      notFoundErrorMessage: (slug) => `Tag is not loaded: ${slug}`,
    });
  }

  public get catalogState(): LoadState<readonly ProblemTag[]> {
    return this.library.catalogState;
  }

  public get catalogSnapshot(): readonly ProblemTag[] | undefined {
    return this.library.catalogSnapshot;
  }

  public getDetailState(slug: string): PagedDetailLoadState<TagDetailState> {
    return this.library.getDetailState(slug);
  }

  public getDetailSnapshot(slug: string): TagDetailState | undefined {
    return this.library.getDetailSnapshot(slug);
  }

  public loadCatalog(): Promise<readonly ProblemTag[]> {
    return this.library.loadCatalog();
  }

  public loadDetail(summary: ProblemTag): Promise<TagDetailState> {
    return this.library.loadDetail(summary);
  }

  public loadMore(slug: string): Promise<TagDetailState> {
    return this.library.loadMore(slug);
  }

  public markAccepted(titleSlug: string): boolean {
    return this.library.markAccepted(titleSlug);
  }

  public reset(): void {
    this.library.reset();
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
