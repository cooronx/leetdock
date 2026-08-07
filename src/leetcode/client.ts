import { setTimeout as delay } from "node:timers/promises";
import {
  CredentialStore,
  normalizeLeetCodeCookie,
} from "../storage/credentialStore";
import { LeetCodeError } from "./errors";
import { isJudgePending, mapJudgeResult } from "./judgeResult";
import {
  COMPANY_QUESTIONS_QUERY,
  COMPANY_QUESTION_SOURCE_QUERY,
  COMPANY_TAGS_QUERY,
  CURRENT_USER_QUERY,
  DAILY_CHALLENGE_QUERY,
  DAILY_STREAK_QUERY,
  MY_PROBLEM_LISTS_QUERY,
  PROBLEM_DETAIL_QUERY,
  PROBLEM_LIST_PROGRESS_QUERY,
  PROBLEM_LIST_QUESTIONS_QUERY,
  PROBLEM_LIST_QUESTION_STATUS_QUERY,
  PROBLEM_LIST_QUERY,
  QUESTION_TAGS_QUERY,
} from "./graphql";
import type {
  CodeSnippet,
  CompanyQuestion,
  CompanyQuestionPage,
  CompanyQuestionSource,
  CompanySummary,
  DailyChallenge,
  DailyStreak,
  Difficulty,
  JudgeAction,
  JudgeResult,
  ProblemDetail,
  ProblemListPage,
  ProblemListProgress,
  ProblemListQuestion,
  ProblemListSource,
  ProblemListSummary,
  ProblemSearchPage,
  ProblemStatus,
  ProblemSummary,
  ProblemTag,
  TagQuestionPage,
  UserInfo,
} from "./types";

const DEFAULT_ENDPOINT = "https://leetcode.cn/graphql/";
const DEFAULT_STREAK_ENDPOINT = "https://leetcode.cn/graphql/noj-go/";
const DEFAULT_PROBLEM_INDEX_ENDPOINT = "https://leetcode.cn/api/problems/all/";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MIN_INTERVAL_MS = 250;
const DEFAULT_JUDGE_POLL_INTERVAL_MS = 1_000;
const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;
const LEETCODE_ORIGIN = "https://leetcode.cn";

interface GraphQLErrorPayload {
  readonly message?: unknown;
  readonly extensions?: unknown;
}

interface GraphQLResponse<T> {
  readonly data?: T | null;
  readonly errors?: unknown;
}

interface RawUserStatus {
  readonly isSignedIn?: unknown;
  readonly username?: unknown;
  readonly isPremium?: unknown;
  readonly avatar?: unknown;
}

interface CurrentUserData {
  readonly userStatus?: RawUserStatus | null;
}

interface RawProblemSummary {
  readonly frontendQuestionId?: unknown;
  readonly title?: unknown;
  readonly titleCn?: unknown;
  readonly titleSlug?: unknown;
  readonly difficulty?: unknown;
  readonly paidOnly?: unknown;
  readonly status?: unknown;
}

interface ProblemListData {
  readonly problemsetQuestionList?: {
    readonly hasMore?: unknown;
    readonly total?: unknown;
    readonly questions?: readonly RawProblemSummary[] | null;
  } | null;
}

interface RawOfficialTag {
  readonly name?: unknown;
  readonly nameTranslated?: unknown;
  readonly slug?: unknown;
}

interface QuestionTagTypesData {
  readonly questionTagTypeWithTags?: readonly {
    readonly tagRelation?: readonly {
      readonly tag?: RawOfficialTag | null;
    }[] | null;
  }[] | null;
}

interface RawProblemTag {
  readonly name?: unknown;
  readonly translatedName?: unknown;
  readonly slug?: unknown;
}

interface RawCodeSnippet {
  readonly lang?: unknown;
  readonly langSlug?: unknown;
  readonly code?: unknown;
}

interface RawProblemDetail {
  readonly questionId?: unknown;
  readonly questionFrontendId?: unknown;
  readonly title?: unknown;
  readonly translatedTitle?: unknown;
  readonly titleSlug?: unknown;
  readonly content?: unknown;
  readonly translatedContent?: unknown;
  readonly difficulty?: unknown;
  readonly topicTags?: readonly RawProblemTag[] | null;
  readonly codeSnippets?: readonly RawCodeSnippet[] | null;
  readonly exampleTestcases?: unknown;
  readonly sampleTestCase?: unknown;
  readonly hints?: readonly unknown[] | null;
  readonly isPaidOnly?: unknown;
  readonly status?: unknown;
}

interface ProblemDetailData {
  readonly question?: RawProblemDetail | null;
}

interface DailyChallengeData {
  readonly todayRecord?: readonly {
    readonly date?: unknown;
    readonly question?: RawProblemSummary | null;
  }[] | null;
}

interface DailyStreakData {
  readonly problemsetStreakCounter?: {
    readonly today?: unknown;
    readonly streakCount?: unknown;
    readonly daysSkipped?: unknown;
    readonly todayCompleted?: unknown;
  } | null;
}

interface RawProblemIndexEntry {
  readonly stat?: {
    readonly frontend_question_id?: unknown;
    readonly question__title?: unknown;
    readonly question__title_slug?: unknown;
  } | null;
  readonly status?: unknown;
  readonly difficulty?: { readonly level?: unknown } | null;
  readonly paid_only?: unknown;
}

interface ProblemIndexData {
  readonly stat_status_pairs?: readonly RawProblemIndexEntry[] | null;
}

interface RawFavoriteSummary {
  readonly name?: unknown;
  readonly slug?: unknown;
  readonly favoriteType?: unknown;
}

interface RawFavoriteCollection {
  readonly favorites?: readonly RawFavoriteSummary[] | null;
}

interface MyProblemListsData {
  readonly myCreatedFavoriteList?: RawFavoriteCollection | null;
  readonly myCollectedFavoriteList?: RawFavoriteCollection | null;
}

interface FavoriteQuestionListData {
  readonly favoriteQuestionList?: {
    readonly questions?: readonly RawFavoriteQuestion[] | null;
    readonly totalLength?: unknown;
    readonly hasMore?: unknown;
  } | null;
}

interface RawFavoriteQuestion {
  readonly questionFrontendId?: unknown;
  readonly title?: unknown;
  readonly translatedTitle?: unknown;
  readonly titleSlug?: unknown;
  readonly difficulty?: unknown;
  readonly paidOnly?: unknown;
  readonly status?: unknown;
  readonly frequency?: unknown;
}

interface RawCompanyTag {
  readonly name?: unknown;
  readonly translatedName?: unknown;
  readonly slug?: unknown;
}

interface CompanyTagsData {
  readonly companyTags?: readonly RawCompanyTag[] | null;
}

interface CompanyQuestionSourceData {
  readonly favoriteDetailV2?: {
    readonly questionNumber?: unknown;
    readonly generatedFavoritesInfo?: {
      readonly defaultFavoriteSlug?: unknown;
    } | null;
  } | null;
}

interface RawProgressCount {
  readonly count?: unknown;
  readonly difficulty?: unknown;
}

interface FavoriteProgressData {
  readonly favoriteUserQuestionProgressV2?: {
    readonly numAcceptedQuestions?: readonly RawProgressCount[] | null;
    readonly numFailedQuestions?: readonly RawProgressCount[] | null;
    readonly numUntouchedQuestions?: readonly RawProgressCount[] | null;
  } | null;
}

interface FavoriteQuestionStatusData {
  readonly favoriteQuestionAcStatus?: unknown;
}

interface ClientOptions {
  readonly endpoint?: string;
  readonly streakEndpoint?: string;
  readonly problemIndexEndpoint?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxConcurrency?: number;
  readonly minRequestIntervalMs?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly judgePollIntervalMs?: number;
  readonly judgeTimeoutMs?: number;
}

interface RequestOptions {
  readonly requiresAuthentication?: boolean;
  readonly referer?: string;
  readonly cookieOverride?: string;
  readonly endpoint?: string;
}

class RequestGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private nextStartAt = 0;

  public constructor(
    private readonly maxConcurrency: number,
    private readonly minIntervalMs: number,
  ) {}

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      const waitMs = Math.max(0, this.nextStartAt - Date.now());
      this.nextStartAt = Math.max(Date.now(), this.nextStartAt) + this.minIntervalMs;
      if (waitMs > 0) {
        await delay(waitMs);
      }
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next === undefined) {
      this.active -= 1;
      return;
    }
    next();
  }
}

export class LeetCodeClient {
  private readonly endpoint: string;
  private readonly streakEndpoint: string;
  private readonly problemIndexEndpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly requestGate: RequestGate;
  private readonly judgePollIntervalMs: number;
  private readonly judgeTimeoutMs: number;

  public constructor(
    private readonly credentials: CredentialStore,
    options: ClientOptions = {},
  ) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.streakEndpoint = options.streakEndpoint ?? DEFAULT_STREAK_ENDPOINT;
    this.problemIndexEndpoint =
      options.problemIndexEndpoint ?? DEFAULT_PROBLEM_INDEX_ENDPOINT;
    this.timeoutMs = positiveFiniteNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.maxRetries = nonNegativeInteger(
      options.maxRetries,
      DEFAULT_MAX_RETRIES,
      "maxRetries",
    );
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.requestGate = new RequestGate(
      positiveInteger(
        options.maxConcurrency,
        DEFAULT_MAX_CONCURRENCY,
        "maxConcurrency",
      ),
      nonNegativeFiniteNumber(
        options.minRequestIntervalMs,
        DEFAULT_MIN_INTERVAL_MS,
        "minRequestIntervalMs",
      ),
    );
    this.judgePollIntervalMs = nonNegativeFiniteNumber(
      options.judgePollIntervalMs,
      DEFAULT_JUDGE_POLL_INTERVAL_MS,
      "judgePollIntervalMs",
    );
    this.judgeTimeoutMs = positiveFiniteNumber(
      options.judgeTimeoutMs,
      DEFAULT_JUDGE_TIMEOUT_MS,
      "judgeTimeoutMs",
    );
  }

  public async getCurrentUser(): Promise<UserInfo> {
    return this.loadCurrentUser();
  }

  /** Validates a callback credential without replacing the stored credential. */
  public async verifyCookie(cookie: string): Promise<UserInfo> {
    return this.loadCurrentUser(normalizeLeetCodeCookie(cookie));
  }

  private async loadCurrentUser(cookieOverride?: string): Promise<UserInfo> {
    const data = await this.request<CurrentUserData>(
      "CurrentUser",
      CURRENT_USER_QUERY,
      {},
      {
        referer: "https://leetcode.cn/",
        ...(cookieOverride === undefined
          ? {}
          : { cookieOverride, requiresAuthentication: true }),
      },
    );
    const status = data.userStatus;
    if (status === null || status === undefined) {
      throw new LeetCodeError("invalid-response", "Missing userStatus in response.");
    }
    if (typeof status.isSignedIn !== "boolean") {
      throw new LeetCodeError(
        "invalid-response",
        "Missing isSignedIn in current user response.",
      );
    }
    const username = asString(status.username) ?? "";
    if (status.isSignedIn && username.trim().length === 0) {
      throw new LeetCodeError(
        "invalid-response",
        "Signed-in current user response did not include a username.",
      );
    }

    return {
      isSignedIn: status.isSignedIn,
      username,
      isPremium: status.isPremium === true,
      ...(asString(status.avatar) === undefined ? {} : { avatar: asString(status.avatar) }),
    };
  }

  public async searchProblems(
    keyword: string,
    skip = 0,
    limit = 50,
  ): Promise<ProblemSearchPage> {
    const normalizedKeyword = keyword.trim();
    const data = await this.request<ProblemListData>(
      "ProblemsetQuestionList",
      PROBLEM_LIST_QUERY,
      {
        limit: clamp(limit, 1, 100),
        skip: Math.max(0, Math.trunc(skip)),
        filters: { searchKeywords: normalizedKeyword },
      },
      { referer: "https://leetcode.cn/problemset/" },
    );

    const list = data.problemsetQuestionList;
    if (list === null || list === undefined || !Array.isArray(list.questions)) {
      throw new LeetCodeError("invalid-response", "Missing problem list in response.");
    }

    return {
      questions: list.questions.map(mapProblemSummary),
      total: typeof list.total === "number" ? list.total : list.questions.length,
      hasMore: list.hasMore === true,
    };
  }

  public async getTags(): Promise<readonly ProblemTag[]> {
    const data = await this.request<QuestionTagTypesData>(
      "QuestionTagTypeWithTags",
      QUESTION_TAGS_QUERY,
      {},
      { referer: "https://leetcode.cn/problemset/" },
    );
    if (!Array.isArray(data.questionTagTypeWithTags)) {
      throw new LeetCodeError("invalid-response", "Missing question tag types.");
    }

    const seen = new Set<string>();
    const tags: ProblemTag[] = [];
    for (const type of data.questionTagTypeWithTags) {
      if (!Array.isArray(type.tagRelation)) {
        throw new LeetCodeError("invalid-response", "Missing question tag relations.");
      }
      for (const relation of type.tagRelation) {
        if (relation.tag === null || relation.tag === undefined) {
          throw new LeetCodeError("invalid-response", "Missing question tag.");
        }
        const tag = mapOfficialTag(relation.tag);
        if (!seen.has(tag.slug)) {
          seen.add(tag.slug);
          tags.push(tag);
        }
      }
    }
    return tags;
  }

  public async getTagQuestions(
    tagSlug: string,
    skip = 0,
    limit = 50,
  ): Promise<TagQuestionPage> {
    const slug = requiredRequestValue(tagSlug, "tag slug");
    const data = await this.request<ProblemListData>(
      "ProblemsetQuestionList",
      PROBLEM_LIST_QUERY,
      {
        limit: clamp(limit, 1, 100),
        skip: Math.max(0, Math.trunc(skip)),
        filters: { tags: [slug] },
      },
      { referer: tagReferer(slug) },
    );
    const list = data.problemsetQuestionList;
    if (list === null || list === undefined || !Array.isArray(list.questions)) {
      throw new LeetCodeError("invalid-response", "Missing tag questions.");
    }
    return {
      questions: list.questions.map(mapProblemSummary),
      total: requiredNonNegativeInteger(
        list.total,
        "problemsetQuestionList.total",
      ),
      hasMore: list.hasMore === true,
    };
  }

  public async getProblem(titleSlug: string): Promise<ProblemDetail> {
    const normalizedSlug = titleSlug.trim();
    if (normalizedSlug.length === 0) {
      throw new LeetCodeError("not-found", "Problem slug is empty.");
    }

    const data = await this.request<ProblemDetailData>(
      "QuestionData",
      PROBLEM_DETAIL_QUERY,
      { titleSlug: normalizedSlug },
      { referer: `https://leetcode.cn/problems/${encodeURIComponent(normalizedSlug)}/` },
    );

    if (data.question === null || data.question === undefined) {
      throw new LeetCodeError("not-found", `Problem not found: ${normalizedSlug}`);
    }

    return mapProblemDetail(data.question);
  }

  public async getDailyChallenge(): Promise<DailyChallenge> {
    const data = await this.request<DailyChallengeData>(
      "DailyChallenge",
      DAILY_CHALLENGE_QUERY,
      {},
      { referer: "https://leetcode.cn/" },
    );
    const record = data.todayRecord?.[0];
    if (record?.question === null || record?.question === undefined) {
      throw new LeetCodeError("invalid-response", "Missing today's daily challenge.");
    }
    return {
      date: requiredDate(record.date, "todayRecord.date"),
      problem: mapProblemSummary(record.question),
    };
  }

  public async getDailyStreak(): Promise<DailyStreak> {
    const data = await this.request<DailyStreakData>(
      "DailyStreak",
      DAILY_STREAK_QUERY,
      {},
      {
        endpoint: this.streakEndpoint,
        referer: "https://leetcode.cn/problemset/",
        requiresAuthentication: true,
      },
    );
    const streak = data.problemsetStreakCounter;
    if (streak === null || streak === undefined) {
      throw new LeetCodeError("invalid-response", "Missing daily challenge streak.");
    }
    return {
      today: requiredDate(streak.today, "problemsetStreakCounter.today"),
      streakCount: requiredNonNegativeInteger(
        streak.streakCount,
        "problemsetStreakCounter.streakCount",
      ),
      daysSkipped: requiredNonNegativeInteger(
        streak.daysSkipped,
        "problemsetStreakCounter.daysSkipped",
      ),
      todayCompleted: requiredBoolean(
        streak.todayCompleted,
        "problemsetStreakCounter.todayCompleted",
      ),
    };
  }

  public async getMyProblemLists(): Promise<readonly ProblemListSummary[]> {
    const data = await this.request<MyProblemListsData>(
      "MyFavoriteLists",
      MY_PROBLEM_LISTS_QUERY,
      {},
      {
        referer: "https://leetcode.cn/problemset/",
        requiresAuthentication: true,
      },
    );
    const created = mapProblemListCollection(
      data.myCreatedFavoriteList,
      "created",
      "myCreatedFavoriteList",
    );
    const collected = mapProblemListCollection(
      data.myCollectedFavoriteList,
      "collected",
      "myCollectedFavoriteList",
    );
    const seen = new Set<string>();
    return [...created, ...collected].filter((list) => {
      if (seen.has(list.slug)) {
        return false;
      }
      seen.add(list.slug);
      return true;
    });
  }

  public async getProblemListQuestions(
    favoriteSlug: string,
    skip = 0,
    limit = 50,
  ): Promise<ProblemListPage> {
    const slug = requiredRequestValue(favoriteSlug, "problem list slug");
    const data = await this.request<FavoriteQuestionListData>(
      "FavoriteQuestionList",
      PROBLEM_LIST_QUESTIONS_QUERY,
      {
        favoriteSlug: slug,
        skip: Math.max(0, Math.trunc(skip)),
        limit: clamp(limit, 1, 100),
      },
      {
        referer: problemListReferer(slug),
        requiresAuthentication: true,
      },
    );
    const list = data.favoriteQuestionList;
    if (list === null || list === undefined || !Array.isArray(list.questions)) {
      throw new LeetCodeError("invalid-response", "Missing problem list questions.");
    }
    return {
      questions: list.questions.map(mapProblemListQuestion),
      total: requiredNonNegativeInteger(
        list.totalLength,
        "favoriteQuestionList.totalLength",
      ),
      hasMore: list.hasMore === true,
    };
  }

  public async getProblemListProgress(
    favoriteSlug: string,
  ): Promise<ProblemListProgress> {
    const slug = requiredRequestValue(favoriteSlug, "problem list slug");
    const data = await this.request<FavoriteProgressData>(
      "FavoriteUserQuestionProgress",
      PROBLEM_LIST_PROGRESS_QUERY,
      { favoriteSlug: slug },
      {
        referer: problemListReferer(slug),
        requiresAuthentication: true,
      },
    );
    const progress = data.favoriteUserQuestionProgressV2;
    if (progress === null || progress === undefined) {
      throw new LeetCodeError("invalid-response", "Missing problem list progress.");
    }
    return {
      accepted: sumProgressCounts(
        progress.numAcceptedQuestions,
        "numAcceptedQuestions",
      ),
      failed: sumProgressCounts(
        progress.numFailedQuestions,
        "numFailedQuestions",
      ),
      untouched: sumProgressCounts(
        progress.numUntouchedQuestions,
        "numUntouchedQuestions",
      ),
    };
  }

  public async getProblemListQuestionAccepted(
    favoriteSlug: string,
    titleSlug: string,
  ): Promise<boolean> {
    const listSlug = requiredRequestValue(favoriteSlug, "problem list slug");
    const problemSlug = requiredRequestValue(titleSlug, "problem slug");
    const data = await this.request<FavoriteQuestionStatusData>(
      "FavoriteQuestionAcStatus",
      PROBLEM_LIST_QUESTION_STATUS_QUERY,
      { favoriteSlug: listSlug, titleSlug: problemSlug },
      {
        referer: problemListReferer(listSlug),
        requiresAuthentication: true,
      },
    );
    // LeetCode returns null when the question has no status in this list session.
    return data.favoriteQuestionAcStatus === true;
  }

  public async getCompanies(): Promise<readonly CompanySummary[]> {
    const data = await this.request<CompanyTagsData>(
      "CompanyTags",
      COMPANY_TAGS_QUERY,
      {},
      {
        referer: `${LEETCODE_ORIGIN}/company/`,
        requiresAuthentication: true,
      },
    );
    if (!Array.isArray(data.companyTags)) {
      throw new LeetCodeError("invalid-response", "Missing company tags.");
    }
    const seen = new Set<string>();
    return data.companyTags.map(mapCompanySummary).filter((company) => {
      if (seen.has(company.slug)) {
        return false;
      }
      seen.add(company.slug);
      return true;
    });
  }

  public async getCompanyQuestionSource(
    companySlug: string,
  ): Promise<CompanyQuestionSource> {
    const slug = requiredRequestValue(companySlug, "company slug");
    const data = await this.request<CompanyQuestionSourceData>(
      "CompanyQuestionSource",
      COMPANY_QUESTION_SOURCE_QUERY,
      { favoriteSlug: slug },
      {
        referer: companyReferer(slug),
        requiresAuthentication: true,
      },
    );
    const detail = data.favoriteDetailV2;
    const favoriteSlug = asString(
      detail?.generatedFavoritesInfo?.defaultFavoriteSlug,
    )?.trim();
    if (detail === null || detail === undefined || !favoriteSlug) {
      throw new LeetCodeError(
        "authorization",
        "Company questions are unavailable for this account.",
      );
    }
    return {
      favoriteSlug,
      questionNumber: requiredNonNegativeInteger(
        detail.questionNumber,
        "favoriteDetailV2.questionNumber",
      ),
    };
  }

  public async getCompanyQuestions(
    companySlug: string,
    favoriteSlug: string,
    skip = 0,
    limit = 50,
  ): Promise<CompanyQuestionPage> {
    const company = requiredRequestValue(companySlug, "company slug");
    const favorite = requiredRequestValue(favoriteSlug, "company question list slug");
    const data = await this.request<FavoriteQuestionListData>(
      "CompanyQuestionList",
      COMPANY_QUESTIONS_QUERY,
      {
        favoriteSlug: favorite,
        skip: Math.max(0, Math.trunc(skip)),
        limit: clamp(limit, 1, 100),
      },
      {
        referer: companyReferer(company),
        requiresAuthentication: true,
      },
    );
    const list = data.favoriteQuestionList;
    if (list === null || list === undefined || !Array.isArray(list.questions)) {
      throw new LeetCodeError("invalid-response", "Missing company questions.");
    }
    return {
      questions: list.questions.map(mapCompanyQuestion),
      total: requiredNonNegativeInteger(
        list.totalLength,
        "favoriteQuestionList.totalLength",
      ),
      hasMore: list.hasMore === true,
    };
  }

  public async testSolution(
    problem: ProblemDetail,
    languageSlug: string,
    code: string,
    input: string,
  ): Promise<JudgeResult> {
    const endpoint = problemEndpoint(problem.titleSlug, "interpret_solution");
    const payload = await this.requestJsonRecord(
      endpoint,
      {
        method: "POST",
        body: JSON.stringify({
          lang: requiredRequestValue(languageSlug, "language"),
          question_id: requiredRequestValue(problem.internalId, "question ID"),
          typed_code: code,
          data_input: input,
        }),
      },
      false,
      problemReferer(problem.titleSlug),
    );
    const taskId = requiredTaskId(payload.interpret_id, "interpret_id");
    return this.pollJudgeResult("test", taskId, input);
  }

  public async submitSolution(
    problem: ProblemDetail,
    languageSlug: string,
    code: string,
  ): Promise<JudgeResult> {
    const endpoint = problemEndpoint(problem.titleSlug, "submit");
    const payload = await this.requestJsonRecord(
      endpoint,
      {
        method: "POST",
        body: JSON.stringify({
          lang: requiredRequestValue(languageSlug, "language"),
          question_id: requiredRequestValue(problem.internalId, "question ID"),
          typed_code: code,
        }),
      },
      false,
      problemReferer(problem.titleSlug),
    );
    const taskId = requiredTaskId(payload.submission_id, "submission_id");
    return this.pollJudgeResult("submit", taskId);
  }

  /**
   * Loads LeetCode's single-request public index for reliable frontend ID lookup.
   * GraphQL keyword search does not guarantee that an exact numeric ID is returned.
   */
  public async getProblemIndex(): Promise<readonly ProblemSummary[]> {
    return this.runWithRetries(async () => {
      const cookie = await this.credentials.getCookie();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImplementation(this.problemIndexEndpoint, {
          method: "GET",
          headers: buildHeaders(cookie, "https://leetcode.cn/problemset/", this.problemIndexEndpoint),
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw httpError(response);
        }

        let payload: ProblemIndexData;
        try {
          payload = JSON.parse(await response.text()) as ProblemIndexData;
        } catch (error) {
          throw new LeetCodeError("invalid-response", "Problem index was not valid JSON.", {
            cause: error,
          });
        }

        if (!Array.isArray(payload.stat_status_pairs)) {
          throw new LeetCodeError("invalid-response", "Problem index was missing entries.");
        }
        return payload.stat_status_pairs.map(mapProblemIndexEntry);
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private async request<T>(
    operationName: string,
    query: string,
    variables: Readonly<Record<string, unknown>>,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.runWithRetries(async () => {
      const cookie =
        options.cookieOverride ?? (await this.credentials.getCookie());
      if (options.requiresAuthentication === true && cookie === undefined) {
        throw new LeetCodeError("authentication", "Authentication is required.");
      }
      return this.fetchGraphQL<T>(operationName, query, variables, cookie, options);
    });
  }

  private async pollJudgeResult(
    action: JudgeAction,
    taskId: string,
    input?: string,
  ): Promise<JudgeResult> {
    const deadline = Date.now() + this.judgeTimeoutMs;
    while (Date.now() < deadline) {
      const payload = await this.requestJsonRecord(
        `${LEETCODE_ORIGIN}/submissions/detail/${encodeURIComponent(taskId)}/check/`,
        { method: "GET" },
        true,
        LEETCODE_ORIGIN,
      );
      if (!isJudgePending(payload)) {
        return mapJudgeResult(action, taskId, payload, input);
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        await delay(Math.min(this.judgePollIntervalMs, remaining));
      }
    }
    throw new LeetCodeError("timeout", "Timed out while waiting for judge result.");
  }

  private async requestJsonRecord(
    endpoint: string,
    init: Pick<RequestInit, "body" | "method">,
    retry: boolean,
    referer: string,
  ): Promise<Record<string, unknown>> {
    const operation = async (): Promise<Record<string, unknown>> => {
      const cookie = await this.credentials.getCookie();
      if (cookie === undefined) {
        throw new LeetCodeError("authentication", "Authentication is required.");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImplementation(endpoint, {
          ...init,
          headers: buildHeaders(cookie, referer, endpoint),
          redirect: "manual",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw httpError(response);
        }
        const rawBody = await response.text();
        let payload: unknown;
        try {
          payload = JSON.parse(rawBody);
        } catch (error) {
          throw new LeetCodeError("invalid-response", "Response was not valid JSON.", {
            cause: error,
          });
        }
        if (!isRecord(payload)) {
          throw new LeetCodeError("invalid-response", "Response was not an object.");
        }
        return payload;
      } finally {
        clearTimeout(timeout);
      }
    };

    if (retry) {
      return this.runWithRetries(operation);
    }
    try {
      return await this.requestGate.run(operation);
    } catch (error) {
      throw normalizeRequestError(error);
    }
  }

  private async runWithRetries<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: LeetCodeError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.requestGate.run(operation);
      } catch (error) {
        const normalized = normalizeRequestError(error);
        lastError = normalized;
        if (!normalized.retryable || attempt === this.maxRetries) {
          throw normalized;
        }
        await delay(retryDelayMs(attempt, normalized.retryAfterMs));
      }
    }

    throw lastError ?? new LeetCodeError("network", "Request failed.");
  }

  private async fetchGraphQL<T>(
    operationName: string,
    query: string,
    variables: Readonly<Record<string, unknown>>,
    cookie: string | undefined,
    options: RequestOptions,
  ): Promise<T> {
    const endpoint = options.endpoint ?? this.endpoint;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(endpoint, {
        method: "POST",
        headers: buildHeaders(cookie, options.referer, endpoint),
        body: JSON.stringify({ operationName, query, variables }),
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw httpError(response);
      }

      const rawBody = await response.text();
      let payload: GraphQLResponse<T>;
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!isRecord(parsed)) {
          throw new Error("GraphQL response envelope was not an object.");
        }
        payload = parsed as GraphQLResponse<T>;
      } catch (error) {
        throw new LeetCodeError("invalid-response", "Response was not valid JSON.", {
          cause: error,
        });
      }

      if (payload.errors !== undefined && payload.errors !== null) {
        if (!Array.isArray(payload.errors)) {
          throw new LeetCodeError("invalid-response", "GraphQL errors was not an array.");
        }
        const messages = (payload.errors as readonly GraphQLErrorPayload[])
          .map((item) => (isRecord(item) ? asString(item.message) : undefined))
          .filter((item): item is string => item !== undefined);
        if (payload.errors.length > 0) {
          const joined = messages.join("; ") || "Unknown GraphQL error.";
          throw new LeetCodeError(classifyGraphQLErrors(payload.errors), joined);
        }
      }

      if (payload.data === undefined || payload.data === null) {
        throw new LeetCodeError("invalid-response", "Response did not contain data.");
      }

      return payload.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildHeaders(
  cookie: string | undefined,
  referer: string | undefined,
  endpoint: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://leetcode.cn",
    Referer: referer ?? "https://leetcode.cn/",
    "User-Agent": "LeetDock VS Code Extension",
    "X-Requested-With": "XMLHttpRequest",
  };

  if (cookie !== undefined && isTrustedLeetCodeEndpoint(endpoint)) {
    headers.Cookie = cookie;
    const csrfToken = extractCookieValue(cookie, "csrftoken");
    if (csrfToken !== undefined) {
      headers["X-CSRFToken"] = csrfToken;
    }
  }

  return headers;
}

function isTrustedLeetCodeEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.hostname === "leetcode.cn";
  } catch {
    return false;
  }
}

function extractCookieValue(cookie: string, name: string): string | undefined {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, "i"));
  const value = match?.[1];
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function httpError(response: Response): LeetCodeError {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = retryAfter === null ? undefined : parseRetryAfter(retryAfter);

  if (response.status >= 300 && response.status < 400) {
    return new LeetCodeError(
      "authentication",
      `Authentication redirect received (${response.status}).`,
      { statusCode: response.status },
    );
  }
  if (response.status === 401) {
    return new LeetCodeError("authentication", `Authentication failed (${response.status}).`, {
      statusCode: response.status,
    });
  }
  if (response.status === 403) {
    return new LeetCodeError("authorization", "LeetDock rejected the request (403).", {
      statusCode: response.status,
    });
  }
  if (response.status === 429) {
    const canRetrySoon = retryAfterMs === undefined || retryAfterMs <= 5_000;
    return new LeetCodeError("rate-limit", "LeetDock rate limit reached.", {
      retryable: canRetrySoon,
      statusCode: response.status,
      retryAfterMs,
    });
  }
  if (response.status >= 500) {
    return new LeetCodeError("service", `LeetDock service error (${response.status}).`, {
      retryable: true,
      statusCode: response.status,
    });
  }
  return new LeetCodeError("service", `LeetDock request failed (${response.status}).`, {
    statusCode: response.status,
  });
}

function normalizeRequestError(error: unknown): LeetCodeError {
  if (error instanceof LeetCodeError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new LeetCodeError("timeout", "LeetDock request timed out.", {
      cause: error,
      retryable: true,
    });
  }

  const code = getErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new LeetCodeError("dns", "Could not resolve leetcode.cn.", {
      cause: error,
      retryable: true,
    });
  }
  return new LeetCodeError("network", "LeetDock request failed.", {
    cause: error,
    retryable: true,
  });
}

function classifyGraphQLErrors(
  errors: readonly unknown[],
): "authentication" | "authorization" | "graphql" {
  const codes = errors
    .map((item) => graphQLErrorCode(item))
    .filter((code): code is string => code !== undefined);
  if (codes.some((code) => code === "UNAUTHENTICATED")) {
    return "authentication";
  }
  if (codes.some((code) => code === "FORBIDDEN")) {
    return "authorization";
  }

  const message = errors
    .map((item) => (isRecord(item) ? asString(item.message) : undefined))
    .filter((item): item is string => item !== undefined)
    .join("; ");
  if (
    /\b(?:not authenticated|unauthenticated|authentication (?:required|failed|expired)|login required|sign[- ]?in required)\b|please (?:log|sign)[- ]?in/i.test(message)
  ) {
    return "authentication";
  }
  if (/\b(?:forbidden|permission denied|not authorized|csrf)\b/i.test(message)) {
    return "authorization";
  }
  return "graphql";
}

function graphQLErrorCode(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const extensions = value.extensions;
  if (!isRecord(extensions)) {
    return undefined;
  }
  return asString(extensions.code)?.toUpperCase();
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const direct = Reflect.get(error, "code");
  if (typeof direct === "string") {
    return direct;
  }
  const cause = Reflect.get(error, "cause");
  if (typeof cause === "object" && cause !== null) {
    const nested = Reflect.get(cause, "code");
    return typeof nested === "string" ? nested : undefined;
  }
  return undefined;
}

function parseRetryAfter(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return Math.max(0, timestamp - Date.now());
}

function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    return retryAfterMs;
  }
  return Math.min(500 * 2 ** attempt, 2_000);
}

function mapProblemSummary(raw: RawProblemSummary): ProblemSummary {
  return {
    frontendId: requiredString(raw.frontendQuestionId, "frontendQuestionId"),
    title: requiredString(raw.title, "title"),
    ...(asString(raw.titleCn) === undefined
      ? {}
      : { translatedTitle: asString(raw.titleCn) }),
    titleSlug: requiredString(raw.titleSlug, "titleSlug"),
    difficulty: mapDifficulty(raw.difficulty),
    paidOnly: raw.paidOnly === true,
    status: mapStatus(raw.status),
  };
}

function problemEndpoint(titleSlug: string, action: string): string {
  const slug = requiredRequestValue(titleSlug, "problem slug");
  return `${LEETCODE_ORIGIN}/problems/${encodeURIComponent(slug)}/${action}/`;
}

function problemReferer(titleSlug: string): string {
  return `${LEETCODE_ORIGIN}/problems/${encodeURIComponent(titleSlug)}/`;
}

function problemListReferer(favoriteSlug: string): string {
  return `${LEETCODE_ORIGIN}/problem-list/${encodeURIComponent(favoriteSlug)}/`;
}

function companyReferer(companySlug: string): string {
  return `${LEETCODE_ORIGIN}/company/${encodeURIComponent(companySlug)}/`;
}

function tagReferer(tagSlug: string): string {
  return `${LEETCODE_ORIGIN}/tag/${encodeURIComponent(tagSlug)}/problemset/`;
}

function requiredRequestValue(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new LeetCodeError("invalid-response", `Missing ${field}.`);
  }
  return normalized;
}

function requiredTaskId(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  const text = asString(value)?.trim();
  if (text === undefined || text.length === 0) {
    throw new LeetCodeError("invalid-response", `Missing ${field} in response.`);
  }
  return text;
}

function mapProblemDetail(raw: RawProblemDetail): ProblemDetail {
  const tags: ProblemTag[] = (raw.topicTags ?? []).map((tag) => ({
    name: requiredString(tag.name, "topicTags.name"),
    ...(asString(tag.translatedName) === undefined
      ? {}
      : { translatedName: asString(tag.translatedName) }),
    slug: requiredString(tag.slug, "topicTags.slug"),
  }));
  const codeSnippets: CodeSnippet[] = (raw.codeSnippets ?? []).map((snippet) => ({
    language: requiredString(snippet.lang, "codeSnippets.lang"),
    languageSlug: requiredString(snippet.langSlug, "codeSnippets.langSlug"),
    code: requiredString(snippet.code, "codeSnippets.code"),
  }));

  return {
    internalId: requiredString(raw.questionId, "questionId"),
    frontendId: requiredString(raw.questionFrontendId, "questionFrontendId"),
    title: requiredString(raw.title, "title"),
    ...(asString(raw.translatedTitle) === undefined
      ? {}
      : { translatedTitle: asString(raw.translatedTitle) }),
    titleSlug: requiredString(raw.titleSlug, "titleSlug"),
    content: asString(raw.content) ?? "",
    ...(asString(raw.translatedContent) === undefined
      ? {}
      : { translatedContent: asString(raw.translatedContent) }),
    difficulty: mapDifficulty(raw.difficulty),
    paidOnly: raw.isPaidOnly === true,
    status: mapStatus(raw.status),
    tags,
    codeSnippets,
    ...(asString(raw.exampleTestcases) === undefined
      ? {}
      : { exampleTestcases: asString(raw.exampleTestcases) }),
    ...(asString(raw.sampleTestCase) === undefined
      ? {}
      : { sampleTestCase: asString(raw.sampleTestCase) }),
    hints: (raw.hints ?? []).filter((hint): hint is string => typeof hint === "string"),
  };
}

function mapProblemIndexEntry(raw: RawProblemIndexEntry): ProblemSummary {
  const stat = raw.stat;
  if (stat === null || stat === undefined) {
    throw new LeetCodeError("invalid-response", "Problem index entry was missing stat.");
  }

  return {
    frontendId: requiredString(stat.frontend_question_id, "frontend_question_id"),
    title: requiredString(stat.question__title, "question__title"),
    titleSlug: requiredString(stat.question__title_slug, "question__title_slug"),
    difficulty: mapDifficultyLevel(raw.difficulty?.level),
    paidOnly: raw.paid_only === true,
    status: mapStatus(raw.status),
  };
}

function mapProblemListCollection(
  value: RawFavoriteCollection | null | undefined,
  source: ProblemListSource,
  field: string,
): ProblemListSummary[] {
  if (value === null || value === undefined || !Array.isArray(value.favorites)) {
    throw new LeetCodeError("invalid-response", `Missing ${field}.favorites.`);
  }
  return value.favorites
    .filter((favorite) => asString(favorite.favoriteType)?.toUpperCase() === "NORMAL")
    .map((favorite) => ({
      name: requiredString(favorite.name, `${field}.favorites.name`),
      slug: requiredString(favorite.slug, `${field}.favorites.slug`),
      source,
    }));
}

function mapProblemListQuestion(raw: RawFavoriteQuestion): ProblemListQuestion {
  const rawStatus = asString(raw.status)?.toUpperCase();
  return {
    frontendId: requiredString(raw.questionFrontendId, "questionFrontendId"),
    title: requiredString(raw.title, "title"),
    ...(asString(raw.translatedTitle) === undefined
      ? {}
      : { translatedTitle: asString(raw.translatedTitle) }),
    titleSlug: requiredString(raw.titleSlug, "titleSlug"),
    difficulty: mapDifficulty(raw.difficulty),
    paidOnly: raw.paidOnly === true,
    status: mapStatus(raw.status),
    previouslySolved: rawStatus === "PAST_SOLVED",
  };
}

function mapCompanySummary(raw: RawCompanyTag): CompanySummary {
  const translatedName = asString(raw.translatedName)?.trim();
  return {
    name: requiredString(raw.name, "companyTags.name"),
    ...(translatedName ? { translatedName } : {}),
    slug: requiredString(raw.slug, "companyTags.slug"),
  };
}

function mapOfficialTag(raw: RawOfficialTag): ProblemTag {
  const translatedName = asString(raw.nameTranslated)?.trim();
  return {
    name: requiredString(raw.name, "questionTag.name"),
    ...(translatedName ? { translatedName } : {}),
    slug: requiredString(raw.slug, "questionTag.slug"),
  };
}

function mapCompanyQuestion(raw: RawFavoriteQuestion): CompanyQuestion {
  const frequency = optionalNonNegativeNumber(raw.frequency);
  return {
    frontendId: requiredString(raw.questionFrontendId, "questionFrontendId"),
    title: requiredString(raw.title, "title"),
    ...(asString(raw.translatedTitle) === undefined
      ? {}
      : { translatedTitle: asString(raw.translatedTitle) }),
    titleSlug: requiredString(raw.titleSlug, "titleSlug"),
    difficulty: mapDifficulty(raw.difficulty),
    paidOnly: raw.paidOnly === true,
    status: mapStatus(raw.status),
    ...(frequency === undefined ? {} : { frequency }),
  };
}

function sumProgressCounts(
  values: readonly RawProgressCount[] | null | undefined,
  field: string,
): number {
  if (!Array.isArray(values)) {
    throw new LeetCodeError("invalid-response", `Missing ${field}.`);
  }
  return values.reduce(
    (total, value) => total + requiredNonNegativeInteger(value.count, `${field}.count`),
    0,
  );
}

function mapDifficulty(value: unknown): Difficulty {
  switch (asString(value)?.toLowerCase()) {
    case "easy":
      return "Easy";
    case "medium":
      return "Medium";
    case "hard":
      return "Hard";
    default:
      throw new LeetCodeError("invalid-response", "Unknown problem difficulty.");
  }
}

function mapDifficultyLevel(value: unknown): Difficulty {
  switch (value) {
    case 1:
      return "Easy";
    case 2:
      return "Medium";
    case 3:
      return "Hard";
    default:
      throw new LeetCodeError("invalid-response", "Unknown problem difficulty level.");
  }
}

function mapStatus(value: unknown): ProblemStatus {
  switch (asString(value)?.toUpperCase()) {
    case "AC":
    case "ACCEPTED":
    case "SOLVED":
      return "AC";
    case "ATTEMPTED":
    case "TRIED":
      return "TRIED";
    default:
      return null;
  }
}

function requiredString(value: unknown, field: string, allowEmpty = false): string {
  const result = asString(value);
  if (result === undefined || (!allowEmpty && result.length === 0)) {
    throw new LeetCodeError("invalid-response", `Missing ${field} in response.`);
  }
  return result;
}

function requiredDate(value: unknown, field: string): string {
  const date = requiredString(value, field);
  const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/
    .exec(date);
  const normalizedDate = match?.[1];
  if (normalizedDate === undefined) {
    throw new LeetCodeError("invalid-response", `Invalid ${field} in response.`);
  }
  return normalizedDate;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new LeetCodeError("invalid-response", `Invalid ${field} in response.`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new LeetCodeError("invalid-response", `Invalid ${field} in response.`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveFiniteNumber(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`);
  }
  return resolved;
}

function nonNegativeFiniteNumber(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
  return resolved;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = positiveFiniteNumber(value, fallback, name);
  if (!Number.isInteger(resolved)) {
    throw new RangeError(`${name} must be an integer.`);
  }
  return resolved;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = nonNegativeFiniteNumber(value, fallback, name);
  if (!Number.isInteger(resolved)) {
    throw new RangeError(`${name} must be an integer.`);
  }
  return resolved;
}
