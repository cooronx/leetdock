import { createHash } from "node:crypto";
import { LeetCodeClient } from "../leetcode/client";
import { LeetCodeError } from "../leetcode/errors";
import type {
  ProblemDetail,
  ProblemSearchPage,
  ProblemSummary,
} from "../leetcode/types";
import { ProblemCache, type RecentProblem } from "./problemCache";

const MAX_SEARCH_PAGES = 3;

export type ProblemLookupResult =
  | { readonly kind: "problem"; readonly problem: ProblemDetail }
  | { readonly kind: "choices"; readonly problems: readonly ProblemSummary[] };

export class ProblemService {
  public constructor(
    private readonly client: LeetCodeClient,
    private readonly cache: ProblemCache,
  ) {}

  public async lookup(input: string): Promise<ProblemLookupResult> {
    const normalized = input.trim();
    if (normalized.length === 0) {
      throw new LeetCodeError("not-found", "Problem input is empty.");
    }

    const urlSlug = parseProblemUrl(normalized);
    if (urlSlug !== undefined) {
      return { kind: "problem", problem: await this.openProblem(urlSlug) };
    }
    if (looksLikeUrl(normalized)) {
      throw new LeetCodeError("not-found", "Only leetcode.cn problem URLs are supported.");
    }

    if (/^\d+$/.test(normalized)) {
      const frontendId = normalizeNumericId(normalized);
      const index = await this.getProblemIndex();
      const exact = index.find(
        (problem) => normalizeNumericId(problem.frontendId) === frontendId,
      );
      if (exact === undefined) {
        throw new LeetCodeError("not-found", `Problem ID not found: ${normalized}`);
      }
      return { kind: "problem", problem: await this.openProblem(exact.titleSlug) };
    }

    if (isPossibleTitleSlug(normalized)) {
      try {
        return { kind: "problem", problem: await this.openProblem(normalized) };
      } catch (error) {
        if (!(error instanceof LeetCodeError) || error.kind !== "not-found") {
          throw error;
        }
      }
    }

    const results = await this.search(normalized);
    if (results.length === 0) {
      throw new LeetCodeError("not-found", `No problem matched: ${normalized}`);
    }

    const exactMatches = results.filter((problem) => isExactMatch(problem, normalized));
    if (exactMatches.length === 1) {
      const exact = exactMatches[0];
      if (exact !== undefined) {
        return { kind: "problem", problem: await this.openProblem(exact.titleSlug) };
      }
    }
    return { kind: "choices", problems: results };
  }

  public async search(keyword: string, forceRefresh = false): Promise<readonly ProblemSummary[]> {
    const normalized = keyword.trim();
    if (normalized.length === 0) {
      throw new LeetCodeError("not-found", "Search keyword is empty.");
    }
    const userDataGeneration = this.cache.captureUserDataGeneration();

    const cacheKey = searchCacheKey(normalized);
    let page: ProblemSearchPage | undefined;
    if (!forceRefresh) {
      page = await this.cache.getSearch(cacheKey);
    }
    if (page === undefined) {
      page = await this.client.searchProblems(normalized, 0, 100);
      let skip = page.questions.length;
      let loadedPages = 1;
      const questions = [...page.questions];

      while (
        page.hasMore &&
        loadedPages < MAX_SEARCH_PAGES &&
        !questions.some((problem) => isExactMatch(problem, normalized))
      ) {
        const nextPage = await this.client.searchProblems(normalized, skip, 100);
        if (nextPage.questions.length === 0) {
          page = { ...page, hasMore: false };
          break;
        }
        skip += nextPage.questions.length;
        loadedPages += 1;
        const knownSlugs = new Set(questions.map((problem) => problem.titleSlug));
        questions.push(
          ...nextPage.questions.filter((problem) => !knownSlugs.has(problem.titleSlug)),
        );
        page = {
          questions,
          total: Math.max(page.total, nextPage.total),
          hasMore: nextPage.hasMore,
        };
      }
      await this.cache.setSearch(cacheKey, page, userDataGeneration);
    }

    const sorted = [...page.questions].sort((left, right) =>
      compareProblems(left, right, normalized),
    );
    this.assertCurrentGeneration(userDataGeneration);
    return sorted;
  }

  public async openProblem(titleSlug: string, forceRefresh = false): Promise<ProblemDetail> {
    const normalized = titleSlug.trim();
    const userDataGeneration = this.cache.captureUserDataGeneration();
    let detail = forceRefresh ? undefined : await this.cache.getDetail(normalized);
    if (detail === undefined) {
      detail = await this.client.getProblem(normalized);
      await this.cache.setDetail(detail, userDataGeneration);
    }
    await this.cache.addRecent(detail, userDataGeneration);
    this.assertCurrentGeneration(userDataGeneration);
    return detail;
  }

  public async refreshProblem(titleSlug: string): Promise<ProblemDetail> {
    await this.cache.deleteDetail(titleSlug);
    return this.openProblem(titleSlug, true);
  }

  public async refreshProblemList(): Promise<void> {
    const userDataGeneration = this.cache.captureUserDataGeneration();
    const index = await this.client.getProblemIndex();
    await this.cache.clearProblemLists();
    await this.cache.setIndex(index, userDataGeneration);
    this.assertCurrentGeneration(userDataGeneration);
  }

  public async getRecent(): Promise<readonly RecentProblem[]> {
    return this.cache.getRecent();
  }

  public async clearCache(): Promise<void> {
    await this.cache.clearAll();
  }

  private async getProblemIndex(): Promise<readonly ProblemSummary[]> {
    const userDataGeneration = this.cache.captureUserDataGeneration();
    const cached = await this.cache.getIndex();
    if (cached !== undefined) {
      this.assertCurrentGeneration(userDataGeneration);
      return cached;
    }
    const index = await this.client.getProblemIndex();
    await this.cache.setIndex(index, userDataGeneration);
    this.assertCurrentGeneration(userDataGeneration);
    return index;
  }

  private assertCurrentGeneration(generation: number): void {
    if (!this.cache.isUserDataGenerationCurrent(generation)) {
      throw new LeetCodeError(
        "stale-session",
        "Authentication changed while loading problem data.",
      );
    }
  }
}

function parseProblemUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "leetcode.cn") {
    return undefined;
  }
  const match = url.pathname.match(/^\/problems\/([^/]+)\/?/i);
  const slug = match?.[1];
  return slug === undefined ? undefined : decodeURIComponentSafely(slug);
}

function looksLikeUrl(input: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(input);
}

function isPossibleTitleSlug(input: string): boolean {
  return /^[a-z\d][a-z\d-]*$/i.test(input);
}

function isExactMatch(problem: ProblemSummary, keyword: string): boolean {
  const normalized = normalizeText(keyword);
  return (
    normalizeText(problem.frontendId) === normalized ||
    normalizeText(problem.titleSlug) === normalized ||
    normalizeText(problem.title) === normalized ||
    (problem.translatedTitle !== undefined &&
      normalizeText(problem.translatedTitle) === normalized)
  );
}

function compareProblems(
  left: ProblemSummary,
  right: ProblemSummary,
  keyword: string,
): number {
  const scoreDifference = matchScore(left, keyword) - matchScore(right, keyword);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  return compareFrontendIds(left.frontendId, right.frontendId);
}

function matchScore(problem: ProblemSummary, keyword: string): number {
  const target = normalizeText(keyword);
  const values = [
    normalizeText(problem.titleSlug),
    normalizeText(problem.frontendId),
    normalizeText(problem.translatedTitle ?? ""),
    normalizeText(problem.title),
  ];

  const exactIndex = values.findIndex((value) => value === target);
  if (exactIndex !== -1) {
    return exactIndex;
  }
  if (values.some((value) => value.startsWith(target))) {
    return 10;
  }
  if (values.some((value) => value.includes(target))) {
    return 20;
  }
  return 30;
}

function compareFrontendIds(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, "zh-CN", { numeric: true });
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function normalizeNumericId(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

function searchCacheKey(keyword: string): string {
  return createHash("sha256").update(normalizeText(keyword)).digest("hex");
}

function decodeURIComponentSafely(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
