import { LeetCodeClient } from "../leetcode/client";
import { LeetCodeError } from "../leetcode/errors";
import type { DailyChallenge, DailyStreak } from "../leetcode/types";
import { DailyChallengeCache } from "./dailyChallengeCache";

export type DailyDataSource = "cache" | "network";
export type DailyStreakStatus = "available" | "signed-out" | "unavailable";

export interface DailyChallengeState {
  readonly challenge: DailyChallenge;
  readonly challengeSource: DailyDataSource;
  readonly signedIn: boolean;
  readonly streak?: DailyStreak;
  readonly streakSource?: DailyDataSource;
  readonly streakStatus: DailyStreakStatus;
  readonly todayCompleted?: boolean;
  readonly warning?: unknown;
}

interface LoadRequest {
  readonly date: string;
  readonly generation: number;
  readonly sequence: number;
  readonly signedIn: boolean;
}

export class DailyChallengeService {
  private current: DailyChallengeState | undefined;
  private inFlight:
    | { readonly request: LoadRequest; readonly promise: Promise<DailyChallengeState> }
    | undefined;
  private loadSequence = 0;

  public constructor(
    private readonly client: LeetCodeClient,
    private readonly cache: DailyChallengeCache,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public get snapshot(): DailyChallengeState | undefined {
    return this.current;
  }

  public markCompleted(titleSlug: string): boolean {
    const current = this.current;
    if (
      current === undefined ||
      current.challenge.problem.titleSlug !== titleSlug ||
      current.todayCompleted === true
    ) {
      return false;
    }
    this.current = { ...current, todayCompleted: true };
    return true;
  }

  public load(signedIn: boolean, force = false): Promise<DailyChallengeState> {
    const request = {
      date: beijingDateKey(this.now()),
      generation: this.cache.captureUserDataGeneration(),
      sequence: this.loadSequence + 1,
      signedIn,
    };
    const current = this.current;
    if (!force && this.matches(current, request)) {
      return Promise.resolve(current);
    }
    const inFlight = this.inFlight;
    if (inFlight !== undefined && this.sameRequest(inFlight.request, request)) {
      return inFlight.promise;
    }
    this.loadSequence = request.sequence;

    const promise = this.loadFresh(request).then((state) => {
      if (
        request.sequence === this.loadSequence &&
        (!request.signedIn || this.cache.isUserDataGenerationCurrent(request.generation))
      ) {
        this.current = state;
      }
      return state;
    });
    this.inFlight = { request, promise };
    void promise.then(
      () => this.releaseInFlight(promise),
      () => this.releaseInFlight(promise),
    );
    return promise;
  }

  public async clearUserData(): Promise<void> {
    this.loadSequence += 1;
    await this.cache.clearUserData();
    if (this.current !== undefined) {
      this.current = {
        challenge: this.current.challenge,
        challengeSource: this.current.challengeSource,
        signedIn: false,
        streakStatus: "signed-out",
      };
    }
  }

  public async clearAll(): Promise<void> {
    this.loadSequence += 1;
    await this.cache.clearAll();
    this.current = undefined;
  }

  private async loadFresh(request: LoadRequest): Promise<DailyChallengeState> {
    const cachedChallengePromise = this.cache.getChallenge(request.date);
    const challengeRequest = settle(this.client.getDailyChallenge());
    const streakRequest = request.signedIn
      ? settle(this.client.getDailyStreak())
      : undefined;

    const [cachedChallenge, remoteChallenge] = await Promise.all([
      cachedChallengePromise,
      challengeRequest,
    ]);
    const challenge = remoteChallenge.value ?? cachedChallenge;
    if (challenge === undefined) {
      throw remoteChallenge.error ?? new LeetCodeError(
        "invalid-response",
        "Today's daily challenge was unavailable.",
      );
    }

    const challengeSource: DailyDataSource =
      remoteChallenge.value === undefined ? "cache" : "network";
    if (remoteChallenge.value !== undefined) {
      await this.cache.setChallenge(remoteChallenge.value);
    }

    if (!request.signedIn || streakRequest === undefined) {
      return {
        challenge,
        challengeSource,
        signedIn: false,
        streakStatus: "signed-out",
        ...(remoteChallenge.error === undefined ? {} : { warning: remoteChallenge.error }),
      };
    }

    const [remoteStreak, cachedStreak] = await Promise.all([
      streakRequest,
      this.cache.getStreak(challenge.date),
    ]);
    const compatibleRemoteStreak = remoteStreak.value?.today === challenge.date
      ? remoteStreak.value
      : undefined;
    const streak = compatibleRemoteStreak ?? cachedStreak;
    if (compatibleRemoteStreak !== undefined) {
      await this.cache.setStreak(compatibleRemoteStreak, request.generation);
    }

    if (!this.cache.isUserDataGenerationCurrent(request.generation)) {
      return {
        challenge,
        challengeSource,
        signedIn: false,
        streakStatus: "signed-out",
        ...(remoteChallenge.error === undefined ? {} : { warning: remoteChallenge.error }),
      };
    }

    const streakMismatch = remoteStreak.value !== undefined && compatibleRemoteStreak === undefined
      ? new LeetCodeError(
          "invalid-response",
          "Daily challenge and streak dates did not match.",
        )
      : undefined;
    const warning = remoteChallenge.error ?? remoteStreak.error ?? streakMismatch;
    return {
      challenge,
      challengeSource,
      signedIn: true,
      ...(streak === undefined ? {} : { streak }),
      ...(streak === undefined ? {} : { todayCompleted: streak.todayCompleted }),
      ...(streak === undefined
        ? {}
        : { streakSource: compatibleRemoteStreak === undefined ? "cache" as const : "network" as const }),
      streakStatus: streak === undefined ? "unavailable" : "available",
      ...(warning === undefined ? {} : { warning }),
    };
  }

  private matches(
    state: DailyChallengeState | undefined,
    request: LoadRequest,
  ): state is DailyChallengeState {
    return state !== undefined &&
      state.challenge.date === request.date &&
      state.signedIn === request.signedIn;
  }

  private sameRequest(
    left: LoadRequest | undefined,
    right: LoadRequest,
  ): boolean {
    return left?.date === right.date &&
      left.generation === right.generation &&
      left.signedIn === right.signedIn;
  }

  private releaseInFlight(promise: Promise<DailyChallengeState>): void {
    if (this.inFlight?.promise === promise) {
      this.inFlight = undefined;
    }
  }
}

export function beijingDateKey(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Date must be valid.");
  }
  return new Date(date.getTime() + 8 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

async function settle<T>(promise: Promise<T>): Promise<{
  readonly value?: T;
  readonly error?: unknown;
}> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}
