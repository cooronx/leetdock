import type { DebugProblemSpec } from "../debug/problemSpec";

export type Difficulty = "Easy" | "Medium" | "Hard";

export type ProblemStatus = "AC" | "TRIED" | null;

export interface UserInfo {
  readonly isSignedIn: boolean;
  readonly username: string;
  readonly isPremium: boolean;
  readonly avatar?: string;
}

export interface ProblemTag {
  readonly name: string;
  readonly translatedName?: string;
  readonly slug: string;
}

export interface CodeSnippet {
  readonly language: string;
  readonly languageSlug: string;
  readonly code: string;
}

export interface ProblemSummary {
  readonly frontendId: string;
  readonly title: string;
  readonly translatedTitle?: string;
  readonly titleSlug: string;
  readonly difficulty: Difficulty;
  readonly paidOnly: boolean;
  readonly status: ProblemStatus;
}

export interface ProblemDetail extends ProblemSummary {
  /** LeetCode's internal numeric ID, required by run and submit endpoints. */
  readonly internalId: string;
  readonly content: string;
  readonly translatedContent?: string;
  readonly tags: readonly ProblemTag[];
  readonly codeSnippets: readonly CodeSnippet[];
  readonly exampleTestcases?: string;
  readonly sampleTestCase?: string;
  /** Normalized local-debug metadata. Missing on details cached by older versions. */
  readonly debugProblemSpec?: DebugProblemSpec;
  readonly hints: readonly string[];
}

export type JudgeAction = "test" | "submit";

export interface JudgeResult {
  readonly action: JudgeAction;
  readonly taskId: string;
  readonly state: string;
  readonly statusCode?: number;
  readonly statusMessage: string;
  readonly accepted: boolean;
  readonly runSuccess: boolean;
  readonly runtime?: string;
  readonly memory?: string;
  readonly compileError?: string;
  readonly runtimeError?: string;
  readonly input?: string;
  readonly actualOutput?: string;
  readonly expectedOutput?: string;
  readonly standardOutput?: string;
  readonly totalCorrect?: number;
  readonly totalTestcases?: number;
  readonly runtimePercentile?: number;
  readonly memoryPercentile?: number;
}

export interface ProblemSearchPage {
  readonly questions: readonly ProblemSummary[];
  readonly total: number;
  readonly hasMore: boolean;
}

export type TagQuestionPage = ProblemSearchPage;

export type ProblemListSource = "created" | "collected";

export interface ProblemListSummary {
  readonly name: string;
  readonly slug: string;
  readonly source: ProblemListSource;
}

export interface ProblemListPage {
  readonly questions: readonly ProblemListQuestion[];
  readonly total: number;
  readonly hasMore: boolean;
}

export interface ProblemListQuestion extends ProblemSummary {
  /** Solved before the current list session, but not completed in this session. */
  readonly previouslySolved: boolean;
}

export interface ProblemListProgress {
  readonly accepted: number;
  readonly failed: number;
  readonly untouched: number;
}

export interface CompanySummary {
  readonly name: string;
  readonly translatedName?: string;
  readonly slug: string;
}

export interface CompanyQuestion extends ProblemSummary {
  readonly frequency?: number;
}

export interface CompanyQuestionPage {
  readonly questions: readonly CompanyQuestion[];
  readonly total: number;
  readonly hasMore: boolean;
}

export interface CompanyQuestionSource {
  readonly favoriteSlug: string;
  readonly questionNumber: number;
}

export interface DailyChallenge {
  readonly date: string;
  readonly problem: ProblemSummary;
}

export interface DailyStreak {
  readonly today: string;
  readonly streakCount: number;
  readonly daysSkipped: number;
  readonly todayCompleted: boolean;
}
