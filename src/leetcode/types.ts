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
  readonly content: string;
  readonly translatedContent?: string;
  readonly tags: readonly ProblemTag[];
  readonly codeSnippets: readonly CodeSnippet[];
  readonly exampleTestcases?: string;
  readonly sampleTestCase?: string;
  readonly hints: readonly string[];
}

export interface ProblemSearchPage {
  readonly questions: readonly ProblemSummary[];
  readonly total: number;
  readonly hasMore: boolean;
}
