import { setTimeout as delay } from "node:timers/promises";
import {
  CredentialStore,
  normalizeLeetCodeCookie,
} from "../storage/credentialStore";
import { LeetCodeError } from "./errors";
import { isJudgePending, mapJudgeResult } from "./judgeResult";
import {
  CURRENT_USER_QUERY,
  PROBLEM_DETAIL_QUERY,
  PROBLEM_LIST_QUERY,
} from "./graphql";
import type {
  CodeSnippet,
  Difficulty,
  JudgeAction,
  JudgeResult,
  ProblemDetail,
  ProblemSearchPage,
  ProblemStatus,
  ProblemSummary,
  ProblemTag,
  UserInfo,
} from "./types";

const DEFAULT_ENDPOINT = "https://leetcode.cn/graphql/";
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

interface ClientOptions {
  readonly endpoint?: string;
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: buildHeaders(cookie, options.referer, this.endpoint),
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
