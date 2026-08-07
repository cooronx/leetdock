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

export const DAILY_CHALLENGE_QUERY = /* GraphQL */ `
  query DailyChallenge {
    todayRecord {
      date
      question {
        frontendQuestionId: questionFrontendId
        title
        titleCn: translatedTitle
        titleSlug
        difficulty
        paidOnly: isPaidOnly
        status
      }
    }
  }
`;

export const DAILY_STREAK_QUERY = /* GraphQL */ `
  query DailyStreak {
    problemsetStreakCounter {
      today
      streakCount
      daysSkipped
      todayCompleted
    }
  }
`;

export const MY_PROBLEM_LISTS_QUERY = /* GraphQL */ `
  query MyFavoriteLists {
    myCreatedFavoriteList {
      favorites {
        name
        slug
        favoriteType
      }
    }
    myCollectedFavoriteList {
      favorites {
        name
        slug
        favoriteType
      }
    }
  }
`;

export const PROBLEM_LIST_QUESTIONS_QUERY = /* GraphQL */ `
  query FavoriteQuestionList(
    $favoriteSlug: String!
    $limit: Int
    $skip: Int
    $version: String = "v2"
  ) {
    favoriteQuestionList(
      favoriteSlug: $favoriteSlug
      limit: $limit
      skip: $skip
      version: $version
    ) {
      questions {
        questionFrontendId
        title
        translatedTitle
        titleSlug
        difficulty
        paidOnly
        status
      }
      totalLength
      hasMore
    }
  }
`;

export const PROBLEM_LIST_PROGRESS_QUERY = /* GraphQL */ `
  query FavoriteUserQuestionProgress($favoriteSlug: String!) {
    favoriteUserQuestionProgressV2(favoriteSlug: $favoriteSlug) {
      numAcceptedQuestions {
        count
        difficulty
      }
      numFailedQuestions {
        count
        difficulty
      }
      numUntouchedQuestions {
        count
        difficulty
      }
    }
  }
`;

export const PROBLEM_LIST_QUESTION_STATUS_QUERY = /* GraphQL */ `
  query FavoriteQuestionAcStatus(
    $favoriteSlug: String!
    $titleSlug: String!
  ) {
    favoriteQuestionAcStatus(
      favoriteSlug: $favoriteSlug
      titleSlug: $titleSlug
    )
  }
`;

export const COMPANY_TAGS_QUERY = /* GraphQL */ `
  query CompanyTags {
    companyTags {
      name
      translatedName
      slug
    }
  }
`;

export const COMPANY_QUESTION_SOURCE_QUERY = /* GraphQL */ `
  query CompanyQuestionSource($favoriteSlug: String!) {
    favoriteDetailV2(favoriteSlug: $favoriteSlug) {
      questionNumber
      generatedFavoritesInfo {
        defaultFavoriteSlug
      }
    }
  }
`;

export const COMPANY_QUESTIONS_QUERY = /* GraphQL */ `
  query CompanyQuestionList(
    $favoriteSlug: String!
    $limit: Int
    $skip: Int
    $version: String = "v2"
  ) {
    favoriteQuestionList(
      favoriteSlug: $favoriteSlug
      limit: $limit
      skip: $skip
      version: $version
    ) {
      questions {
        questionFrontendId
        title
        translatedTitle
        titleSlug
        difficulty
        paidOnly
        status
        frequency
      }
      totalLength
      hasMore
    }
  }
`;
