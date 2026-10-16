import * as grammarService from "../services/grammarService.js";

const GRAMMAR_GAME_TYPES = new Set([
  "puzzle",
  "error",
  "speed",
  "transformer",
  "context",
]);

const getErrorMessage = (error) =>
  error instanceof Error ? error.message : "An unexpected error occurred";

const isValidPuzzlePayload = (payload) =>
  payload &&
  typeof payload.vietnamesePrompt === "string" &&
  Array.isArray(payload.correctSentence) &&
  payload.correctSentence.every((word) => typeof word === "string");

export const getTopicsController = async (req, res) => {
  const userId = req.user?.id ?? req.user?.userId;

  try {
    const data = await grammarService.getTopicsWithProgressService(userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getTopicsController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const getSubTopicsController = async (req, res) => {
  const { topicId } = req.params;
  const userId = req.user?.id ?? req.user?.userId;

  if (!topicId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Topic ID is required",
    });
  }

  try {
    const data = await grammarService.getSubTopicsByTopicIdService(topicId, userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getSubTopicsController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const getSubTopicDetailController = async (req, res) => {
  const { subTopicId } = req.params;

  if (!subTopicId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Sub-topic ID is required",
    });
  }

  try {
    const data = await grammarService.getSubTopicDetailService(subTopicId);
    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Sub-topic not found",
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getSubTopicDetailController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const createSubTopicController = async (req, res) => {
  const { topicId } = req.params;
  const {
    title,
    description,
    orderIndex,
    theoryContent,
  } = req.body ?? {};

  if (!topicId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Topic ID is required",
    });
  }

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({
      success: false,
      error: "Description must be a string",
    });
  }

  if (
    orderIndex !== undefined &&
    (!Number.isInteger(orderIndex) || orderIndex < 0)
  ) {
    return res.status(400).json({
      success: false,
      error: "Order index must be a non-negative integer",
    });
  }

  if (
    theoryContent !== undefined &&
    (typeof theoryContent !== "object" ||
      theoryContent === null ||
      Array.isArray(theoryContent))
  ) {
    return res.status(400).json({
      success: false,
      error: "Theory content must be a JSON object",
    });
  }

  try {
    const data = await grammarService.createSubTopicService(topicId, {
      title: title.trim(),
      description,
      orderIndex,
      theoryContent,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("createSubTopicController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const updateSubTopicTheoryController = async (req, res) => {
  const { subTopicId } = req.params;
  const {
    title,
    description,
    orderIndex,
    theoryContent,
  } = req.body ?? {};

  if (!subTopicId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Sub-topic ID is required",
    });
  }

  if (
    title === undefined &&
    description === undefined &&
    orderIndex === undefined &&
    theoryContent === undefined
  ) {
    return res.status(400).json({
      success: false,
      error: "At least one field must be provided",
    });
  }

  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return res.status(400).json({
      success: false,
      error: "Title must be a non-empty string",
    });
  }

  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({
      success: false,
      error: "Description must be a string",
    });
  }

  if (
    orderIndex !== undefined &&
    (!Number.isInteger(orderIndex) || orderIndex < 0)
  ) {
    return res.status(400).json({
      success: false,
      error: "Order index must be a non-negative integer",
    });
  }

  if (
    theoryContent !== undefined &&
    (typeof theoryContent !== "object" ||
      theoryContent === null ||
      Array.isArray(theoryContent))
  ) {
    return res.status(400).json({
      success: false,
      error: "Theory content must be a JSON object",
    });
  }

  try {
    const data = await grammarService.updateSubTopicTheoryService(
      subTopicId,
      {
        title: title?.trim(),
        description,
        orderIndex,
        theoryContent,
      },
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("updateSubTopicTheoryController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const createTopicController = async (req, res) => {
  const { title, level } = req.body ?? {};

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof level !== "string" ||
    !level.trim()
  ) {
    return res.status(400).json({
      success: false,
      error: "Title and level are required",
    });
  }

  try {
    const data = await grammarService.createGrammarTopicService({
      ...req.body,
      title: title.trim(),
      level: level.trim(),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("createTopicController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const getStagesController = async (req, res) => {
  const { subTopicId } = req.params;

  if (!subTopicId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Sub-topic ID is required",
    });
  }

  try {
    const data =
      await grammarService.getStagesBySubTopicIdService(subTopicId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getStagesController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const getQuestionsController = async (req, res) => {
  const { stageId } = req.params;
  const queryLimit = req.query.limit;
  const limit = queryLimit === undefined ? undefined : Number(queryLimit);

  if (!stageId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Stage ID is required",
    });
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return res.status(400).json({
      success: false,
      error: "Limit must be a positive integer",
    });
  }

  try {
    const data = await grammarService.getQuestionsByStageIdService(
      stageId,
      limit,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getQuestionsController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const createStageController = async (req, res) => {
  const { subTopicId } = req.params;
  const { title, gameType, orderIndex } = req.body ?? {};

  if (!subTopicId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Sub-topic ID is required",
    });
  }

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (!GRAMMAR_GAME_TYPES.has(gameType)) {
    return res.status(400).json({
      success: false,
      error: "Game type must be puzzle, error, speed, transformer, or context",
    });
  }

  if (
    orderIndex !== undefined &&
    (!Number.isInteger(orderIndex) || orderIndex < 0)
  ) {
    return res.status(400).json({
      success: false,
      error: "Order index must be a non-negative integer",
    });
  }

  try {
    const data = await grammarService.createStageService(subTopicId, {
      title: title.trim(),
      gameType,
      orderIndex,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("createStageController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const createQuestionController = async (req, res) => {
  const { stageId } = req.params;
  const { questionType, payload, orderIndex } = req.body ?? {};

  if (!stageId?.trim()) {
    return res.status(400).json({
      success: false,
      error: "Stage ID is required",
    });
  }

  if (!GRAMMAR_GAME_TYPES.has(questionType)) {
    return res.status(400).json({
      success: false,
      error:
        "Question type must be puzzle, error, speed, transformer, or context",
    });
  }

  if (
    payload !== undefined &&
    (typeof payload !== "object" || payload === null || Array.isArray(payload))
  ) {
    return res.status(400).json({
      success: false,
      error: "Question payload must be a JSON object",
    });
  }

  if (questionType === "puzzle" && !isValidPuzzlePayload(payload)) {
    return res.status(400).json({
      success: false,
      error:
        "Puzzle payload must include a vietnamesePrompt string and a correctSentence array of strings",
    });
  }

  if (
    orderIndex !== undefined &&
    (!Number.isInteger(orderIndex) || orderIndex < 0)
  ) {
    return res.status(400).json({
      success: false,
      error: "Order index must be a non-negative integer",
    });
  }

  try {
    const data = await grammarService.createQuestionService(stageId, {
      questionType,
      payload,
      orderIndex,
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("createQuestionController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const submitSessionController = async (req, res) => {
  const { topicId, subTopicId, score, correctCount, totalQuestions, isCompleted } =
    req.body ?? {};
  const userId = req.user?.id ?? req.user?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication is required",
    });
  }

  if (
    typeof topicId !== "string" ||
    !topicId.trim() ||
    typeof subTopicId !== "string" ||
    !subTopicId.trim()
  ) {
    return res.status(400).json({
      success: false,
      error: "Topic ID and sub-topic ID are required",
    });
  }

  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    !Number.isInteger(correctCount) ||
    !Number.isInteger(totalQuestions) ||
    totalQuestions < 1 ||
    correctCount < 0 ||
    correctCount > totalQuestions
  ) {
    return res.status(400).json({
      success: false,
      error: "Score and question counts are invalid",
    });
  }

  if (
    isCompleted !== undefined &&
    (typeof isCompleted !== "boolean" ||
      (isCompleted && correctCount !== totalQuestions))
  ) {
    return res.status(400).json({
      success: false,
      error: "Completed progress requires all questions to be correct",
    });
  }

  try {
    const data = await grammarService.submitGameSessionService({
      userId,
      topicId: topicId.trim(),
      subTopicId: subTopicId.trim(),
      score,
      correctCount,
      totalQuestions,
      isCompleted,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("submitSessionController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const getUserProgressController = async (req, res) => {
  const { userId: requestedUserId } = req.params;
  const userId = req.user?.id ?? req.user?.userId;

  if (!userId?.trim() || requestedUserId !== userId) {
    return res.status(403).json({
      success: false,
      error: "You can only access your own grammar progress",
    });
  }

  try {
    const data = await grammarService.getUserProgressService(userId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("getUserProgressController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};

export const importFullSubTopicController = async (req, res) => {
  const {
    topicId,
    title,
    description,
    orderIndex,
    theoryContent,
    stages,
  } = req.body ?? {};

  if (typeof topicId !== "string" || !topicId.trim()) {
    return res.status(400).json({
      success: false,
      error: "Topic ID is required",
    });
  }

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Sub-topic title is required",
    });
  }

  if (!Array.isArray(stages) || stages.length === 0) {
    return res.status(400).json({
      success: false,
      error: "At least one stage is required",
    });
  }

  if (description !== undefined && typeof description !== "string") {
    return res.status(400).json({
      success: false,
      error: "Description must be a string",
    });
  }

  if (
    orderIndex !== undefined &&
    (!Number.isInteger(orderIndex) || orderIndex < 0)
  ) {
    return res.status(400).json({
      success: false,
      error: "Order index must be a non-negative integer",
    });
  }

  if (
    theoryContent !== undefined &&
    (typeof theoryContent !== "object" ||
      theoryContent === null ||
      Array.isArray(theoryContent))
  ) {
    return res.status(400).json({
      success: false,
      error: "Theory content must be a JSON object",
    });
  }

  for (const [stageIndex, stage] of stages.entries()) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      return res.status(400).json({
        success: false,
        error: `Stage ${stageIndex + 1} must be an object`,
      });
    }

    if (typeof stage.title !== "string" || !stage.title.trim()) {
      return res.status(400).json({
        success: false,
        error: `Stage ${stageIndex + 1} requires a title`,
      });
    }

    if (!GRAMMAR_GAME_TYPES.has(stage.gameType)) {
      return res.status(400).json({
        success: false,
        error: `Stage ${stageIndex + 1} has an invalid game type`,
      });
    }

    if (!Array.isArray(stage.questions)) {
      return res.status(400).json({
        success: false,
        error: `Stage ${stageIndex + 1} questions must be an array`,
      });
    }

    if (
      stage.orderIndex !== undefined &&
      (!Number.isInteger(stage.orderIndex) || stage.orderIndex < 0)
    ) {
      return res.status(400).json({
        success: false,
        error: `Stage ${stageIndex + 1} order index must be a non-negative integer`,
      });
    }

    for (const [questionIndex, question] of stage.questions.entries()) {
      if (!question || typeof question !== "object" || Array.isArray(question)) {
        return res.status(400).json({
          success: false,
          error: `Question ${questionIndex + 1} in stage ${
            stageIndex + 1
          } must be an object`,
        });
      }

      if (!GRAMMAR_GAME_TYPES.has(question.questionType)) {
        return res.status(400).json({
          success: false,
          error: `Question ${questionIndex + 1} in stage ${
            stageIndex + 1
          } has an invalid question type`,
        });
      }

      if (
        question.payload !== undefined &&
        (typeof question.payload !== "object" ||
          question.payload === null ||
          Array.isArray(question.payload))
      ) {
        return res.status(400).json({
          success: false,
          error: `Question ${questionIndex + 1} in stage ${
            stageIndex + 1
          } payload must be a JSON object`,
        });
      }

      if (
        question.questionType === "puzzle" &&
        !isValidPuzzlePayload(question.payload)
      ) {
        return res.status(400).json({
          success: false,
          error: `Question ${questionIndex + 1} in stage ${
            stageIndex + 1
          } puzzle payload must include a vietnamesePrompt string and a correctSentence array of strings`,
        });
      }

      if (
        question.orderIndex !== undefined &&
        (!Number.isInteger(question.orderIndex) || question.orderIndex < 0)
      ) {
        return res.status(400).json({
          success: false,
          error: `Question ${questionIndex + 1} in stage ${
            stageIndex + 1
          } order index must be a non-negative integer`,
        });
      }
    }
  }

  try {
    const data = await grammarService.importFullSubTopicService({
      ...req.body,
      topicId: topicId.trim(),
      title: title.trim(),
      stages: stages.map((stage) => ({
        ...stage,
        title: stage.title.trim(),
        questions: stage.questions,
      })),
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("importFullSubTopicController failed:", error);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error),
    });
  }
};