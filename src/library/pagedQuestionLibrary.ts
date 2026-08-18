import { LeetCodeError } from "../leetcode/errors";

export type LoadState<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown };

export type PagedDetailLoadState<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | {
    readonly kind: "ready";
    readonly value: T;
    readonly loadingMore: boolean;
  }
  | { readonly kind: "error"; readonly error: unknown };

export interface LibraryQuestion {
  readonly titleSlug: string;
  readonly status: string | null;
}

export interface QuestionPage<Q> {
  readonly questions: readonly Q[];
  readonly total: number;
  readonly hasMore: boolean;
}

export interface PagedQuestionDetail<Q> extends QuestionPage<Q> {}

export interface PagedQuestionLibraryOptions<
  K,
  I,
  Q extends LibraryQuestion,
  D extends PagedQuestionDetail<Q>,
  C,
> {
  readonly keyOf: (input: I) => K;
  readonly loadCatalog?: () => Promise<readonly C[]>;
  readonly loadFirst: (input: I) => Promise<D>;
  readonly loadNextPage: (key: K, current: D) => Promise<QuestionPage<Q>>;
  readonly staleErrorMessage: string;
  readonly notFoundErrorMessage: (key: K) => string;
  readonly acceptQuestion?: (question: Q) => Q;
}

/** Owns the async lifecycle shared by paged question libraries. */
export class PagedQuestionLibrary<
  K,
  I,
  Q extends LibraryQuestion,
  D extends PagedQuestionDetail<Q>,
  C = never,
> {
  private generation = 0;
  private catalogStateValue: LoadState<readonly C[]> = { kind: "idle" };
  private catalogRequest: Promise<readonly C[]> | undefined;
  private readonly detailStates = new Map<K, PagedDetailLoadState<D>>();
  private readonly detailRequests = new Map<K, Promise<D>>();
  private readonly pageRequests = new Map<K, Promise<D>>();

  public constructor(
    private readonly options: PagedQuestionLibraryOptions<K, I, Q, D, C>,
  ) {}

  public get catalogState(): LoadState<readonly C[]> {
    return this.catalogStateValue;
  }

  public get catalogSnapshot(): readonly C[] | undefined {
    return this.catalogStateValue.kind === "ready"
      ? this.catalogStateValue.value
      : undefined;
  }

  public getDetailState(key: K): PagedDetailLoadState<D> {
    return this.detailStates.get(key) ?? { kind: "idle" };
  }

  public getDetailSnapshot(key: K): D | undefined {
    const state = this.detailStates.get(key);
    return state?.kind === "ready" ? state.value : undefined;
  }

  public loadCatalog(): Promise<readonly C[]> {
    const ready = this.catalogSnapshot;
    if (ready !== undefined) {
      return Promise.resolve(ready);
    }
    if (this.catalogRequest !== undefined) {
      return this.catalogRequest;
    }
    const load = this.options.loadCatalog;
    if (load === undefined) {
      return Promise.reject(new Error("This question library has no catalog."));
    }

    const generation = this.generation;
    this.catalogStateValue = { kind: "loading" };
    const operation = invoke(load);
    const request = operation.then(
      (catalog) => {
        this.assertCurrent(generation);
        this.catalogStateValue = { kind: "ready", value: catalog };
        return catalog;
      },
      (error: unknown) => {
        this.assertCurrent(generation);
        this.catalogStateValue = { kind: "error", error };
        throw error;
      },
    );
    this.catalogRequest = request;
    void request.then(
      () => this.releaseCatalogRequest(request),
      () => this.releaseCatalogRequest(request),
    );
    return request;
  }

  public loadDetail(input: I): Promise<D> {
    const key = this.options.keyOf(input);
    const state = this.detailStates.get(key);
    if (state?.kind === "ready") {
      return Promise.resolve(state.value);
    }
    const existing = this.detailRequests.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const generation = this.generation;
    this.detailStates.set(key, { kind: "loading" });
    const operation = invoke(() => this.options.loadFirst(input));
    const request = operation.then(
      (detail) => {
        this.assertCurrent(generation);
        this.detailStates.set(key, {
          kind: "ready",
          value: detail,
          loadingMore: false,
        });
        return detail;
      },
      (error: unknown) => {
        this.assertCurrent(generation);
        this.detailStates.set(key, { kind: "error", error });
        throw error;
      },
    );
    this.detailRequests.set(key, request);
    void request.then(
      () => this.releaseDetailRequest(key, request),
      () => this.releaseDetailRequest(key, request),
    );
    return request;
  }

  public loadMore(key: K): Promise<D> {
    const existing = this.pageRequests.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const state = this.detailStates.get(key);
    if (state?.kind !== "ready") {
      return Promise.reject(
        new LeetCodeError("not-found", this.options.notFoundErrorMessage(key)),
      );
    }
    if (!state.value.hasMore) {
      return Promise.resolve(state.value);
    }

    const generation = this.generation;
    const initial = state.value;
    this.detailStates.set(key, { ...state, loadingMore: true });
    const operation = invoke(() => this.options.loadNextPage(key, initial));
    const request = operation.then(
      (page) => {
        this.assertCurrent(generation);
        const latest = this.detailStates.get(key);
        const current = latest?.kind === "ready" ? latest.value : initial;
        const detail = mergePage(current, page);
        this.detailStates.set(key, {
          kind: "ready",
          value: detail,
          loadingMore: false,
        });
        return detail;
      },
      (error: unknown) => {
        this.assertCurrent(generation);
        const latest = this.detailStates.get(key);
        if (latest?.kind === "ready") {
          this.detailStates.set(key, { ...latest, loadingMore: false });
        }
        throw error;
      },
    );
    this.pageRequests.set(key, request);
    void request.then(
      () => this.releasePageRequest(key, request),
      () => this.releasePageRequest(key, request),
    );
    return request;
  }

  public markAccepted(titleSlug: string): boolean {
    let changed = false;
    for (const [key, state] of this.detailStates) {
      if (state.kind !== "ready") {
        continue;
      }
      let stateChanged = false;
      const questions = state.value.questions.map((question) => {
        if (question.titleSlug !== titleSlug || question.status === "AC") {
          return question;
        }
        changed = true;
        stateChanged = true;
        return this.options.acceptQuestion?.(question) ?? {
          ...question,
          status: "AC",
        } as Q;
      });
      if (stateChanged) {
        this.detailStates.set(key, {
          ...state,
          value: { ...state.value, questions } as D,
        });
      }
    }
    return changed;
  }

  public async refreshLoaded<R>(
    loadUpdate: (key: K, detail: D) => Promise<R>,
    applyUpdate: (detail: D, update: R) => D,
  ): Promise<void> {
    const generation = this.generation;
    const loaded = [...this.detailStates.entries()].flatMap(([key, state]) =>
      state.kind === "ready" ? [[key, state.value] as const] : []
    );
    const results = await Promise.allSettled(loaded.map(async ([key, detail]) => {
      const update = await loadUpdate(key, detail);
      this.assertCurrent(generation);
      const current = this.detailStates.get(key);
      if (current?.kind === "ready") {
        this.detailStates.set(key, {
          ...current,
          value: applyUpdate(current.value, update),
        });
      }
    }));
    this.assertCurrent(generation);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) {
      throw failure.reason;
    }
  }

  public reset(): void {
    this.generation += 1;
    this.catalogStateValue = { kind: "idle" };
    this.catalogRequest = undefined;
    this.detailStates.clear();
    this.detailRequests.clear();
    this.pageRequests.clear();
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) {
      throw new LeetCodeError("stale-session", this.options.staleErrorMessage);
    }
  }

  private releaseCatalogRequest(request: Promise<readonly C[]>): void {
    if (this.catalogRequest === request) {
      this.catalogRequest = undefined;
    }
  }

  private releaseDetailRequest(key: K, request: Promise<D>): void {
    if (this.detailRequests.get(key) === request) {
      this.detailRequests.delete(key);
    }
  }

  private releasePageRequest(key: K, request: Promise<D>): void {
    if (this.pageRequests.get(key) === request) {
      this.pageRequests.delete(key);
    }
  }
}

function mergePage<
  Q extends LibraryQuestion,
  D extends PagedQuestionDetail<Q>,
>(current: D, page: QuestionPage<Q>): D {
  const known = new Set(current.questions.map((question) => question.titleSlug));
  return {
    ...current,
    questions: [
      ...current.questions,
      ...page.questions.filter((question) => !known.has(question.titleSlug)),
    ],
    total: Math.max(current.total, page.total),
    hasMore: page.questions.length > 0 && page.hasMore,
  };
}

function invoke<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return operation();
  } catch (error) {
    return Promise.reject(error);
  }
}
