export const CURRENT_USER_QUERY = /* GraphQL */ `
  query CurrentUser {
    userStatus {
      isSignedIn
      username
      isPremium
      avatar
    }
  }
`;

export const PROBLEM_LIST_QUERY = /* GraphQL */ `
  query ProblemsetQuestionList(
    $limit: Int
    $skip: Int
    $filters: QuestionListFilterInput
  ) {
    problemsetQuestionList(
      limit: $limit
      skip: $skip
      filters: $filters
    ) {
      hasMore
      total
      questions {
        frontendQuestionId
        title
        titleCn
        titleSlug
        difficulty
        paidOnly
        status
      }
    }
  }
`;

export const PROBLEM_DETAIL_QUERY = /* GraphQL */ `
  query QuestionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      title
      translatedTitle
      titleSlug
      content
      translatedContent
      difficulty
      topicTags {
        name
        translatedName
        slug
      }
      codeSnippets {
        lang
        langSlug
        code
      }
      exampleTestcases
      sampleTestCase
      hints
      isPaidOnly
      status
    }
  }
`;
