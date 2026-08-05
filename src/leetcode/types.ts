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
