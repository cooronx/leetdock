import type {
  CompanyQuestionPage,
  CompanyQuestionSource,
  CompanySummary,
  DailyChallenge,
  DailyStreak,
  Difficulty,
  JudgeResult,
  ProblemDetail,
  ProblemListPage,
  ProblemListProgress,
  ProblemListSummary,
  ProblemSearchPage,
  ProblemSummary,
  ProblemTag,
  TagQuestionPage,
} from "./types";

/** All LeetCode operations executed by the local companion. */
export interface LeetCodeApi {
  searchProblems(keyword: string, skip?: number, limit?: number): Promise<ProblemSearchPage>;
  getDifficultyQuestions(
    difficulty: Difficulty,
    skip?: number,
    limit?: number,
  ): Promise<ProblemSearchPage>;
  getTags(): Promise<readonly ProblemTag[]>;
  getTagQuestions(
    tagSlug: string,
    skip?: number,
    limit?: number,
  ): Promise<TagQuestionPage>;
  getProblem(titleSlug: string): Promise<ProblemDetail>;
  getDailyChallenge(): Promise<DailyChallenge>;
  getDailyStreak(): Promise<DailyStreak>;
  getMyProblemLists(): Promise<readonly ProblemListSummary[]>;
  getProblemListQuestions(
    favoriteSlug: string,
    skip?: number,
    limit?: number,
  ): Promise<ProblemListPage>;
  getProblemListProgress(favoriteSlug: string): Promise<ProblemListProgress>;
  getProblemListQuestionAccepted(
    favoriteSlug: string,
    titleSlug: string,
  ): Promise<boolean>;
  getCompanies(): Promise<readonly CompanySummary[]>;
  getCompanyQuestionSource(companySlug: string): Promise<CompanyQuestionSource>;
  getCompanyQuestions(
    companySlug: string,
    favoriteSlug: string,
    skip?: number,
    limit?: number,
  ): Promise<CompanyQuestionPage>;
  testSolution(
    problem: ProblemDetail,
    languageSlug: string,
    code: string,
    input: string,
  ): Promise<JudgeResult>;
  submitSolution(
    problem: ProblemDetail,
    languageSlug: string,
    code: string,
  ): Promise<JudgeResult>;
  getProblemIndex(): Promise<readonly ProblemSummary[]>;
}
