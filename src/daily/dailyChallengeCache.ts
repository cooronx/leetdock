import type { DailyChallenge, DailyStreak } from "../leetcode/types";
import { CacheStorage } from "../storage/cacheStorage";

const CHALLENGE_KEY = "daily.challenge";
const STREAK_KEY = "daily.streak";

export class DailyChallengeCache {
  private userDataGeneration = 0;
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(private readonly cache: CacheStorage) {}

  public captureUserDataGeneration(): number {
    return this.userDataGeneration;
  }

  public isUserDataGenerationCurrent(generation: number): boolean {
    return generation === this.userDataGeneration;
  }

  public getChallenge(date: string): Promise<DailyChallenge | undefined> {
    return this.getForDate<DailyChallenge>(CHALLENGE_KEY, date);
  }

  public setChallenge(challenge: DailyChallenge): Promise<void> {
    return this.serializeMutation(() =>
      this.cache.set(CHALLENGE_KEY, {
        ...challenge,
        problem: { ...challenge.problem, status: null },
      })
    );
  }

  public getStreak(date: string): Promise<DailyStreak | undefined> {
    return this.getForDate<DailyStreak>(STREAK_KEY, date, "today");
  }

  public setStreak(streak: DailyStreak, generation: number): Promise<void> {
    return this.serializeMutation(async () => {
      if (generation !== this.userDataGeneration) {
        return;
      }
      await this.cache.set(STREAK_KEY, streak);
    });
  }

  public clearUserData(): Promise<void> {
    this.userDataGeneration += 1;
    return this.serializeMutation(() => this.cache.delete(STREAK_KEY));
  }

  public clearAll(): Promise<void> {
    this.userDataGeneration += 1;
    return this.serializeMutation(async () => {
      await Promise.all([
        this.cache.delete(CHALLENGE_KEY),
        this.cache.delete(STREAK_KEY),
      ]);
    });
  }

  private async getForDate<T>(
    key: string,
    date: string,
    dateProperty: "date" | "today" = "date",
  ): Promise<T | undefined> {
    const value = await this.cache.get<T>(key);
    if (value === undefined || typeof value !== "object" || value === null) {
      return undefined;
    }
    return Reflect.get(value, dateProperty) === date ? value : undefined;
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
