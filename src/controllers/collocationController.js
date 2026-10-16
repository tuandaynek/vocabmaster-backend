import {
  fetchDueCollocationCards,
  fetchGlobalCollocations,
  fetchUserCollocationList,
  getNextCollocation,
  getPhase1Data,
  reviewCollocationEntry,
  saveCollocationsList,
  getCollocationVariationsService,
  completeReviewService,
  // Import thêm 3 hàm service cho 3 Phase
  getPhase1TranslationService,
  evaluatePhase2CollocationService,
  evaluatePhase3CollocationService,
} from "../services/collocationService.js";

const getUserIdFromReq = (req) => {
  const tokenUserId = req.user?.id || req.user?.userId;
  if (tokenUserId) return tokenUserId;

  if (process.env.NODE_ENV !== "production") {
    return req.body?.user_id || process.env.SUPABASE_TEST_USER_ID || null;
  }

  return null;
};

export const getGlobalCollocations = async (req, res) => {
  try {
    const result = await fetchGlobalCollocations({
      search: String(req.query.search || ""),
      type: String(req.query.type || "all"),
      topic: String(req.query.topic || "all"),
      cefr: String(req.query.cefr || "all"),
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 9),
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("getGlobalCollocations failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load global collocations",
    });
  }
};

export const saveCollocationsSelection = async (req, res) => {
  const userId = getUserIdFromReq(req);
  const selectedCollocations = req.body?.selectedCollocations || [];

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Thiếu token xác thực hoặc user_id",
      });
    }

    const result = await saveCollocationsList({ selectedCollocations, userId });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("saveCollocationsSelection failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to save collocations",
    });
  }
};

export const downloadCollocations = saveCollocationsSelection;

export const getUserCollocations = async (req, res) => {
  const userId = getUserIdFromReq(req);

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Thiếu token xác thực hợp lệ",
      });
    }

    const data = await fetchUserCollocationList({ userId });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("getUserCollocations failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load collocations",
    });
  }
};

export const getDueCollocations = async (req, res) => {
  const userId = getUserIdFromReq(req);

  try {
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Thiếu token xác thực hợp lệ",
      });
    }

    const data = await fetchDueCollocationCards({ userId, limit: 20 });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("getDueCollocations failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load due collocations",
    });
  }
};

export const reviewCollocation = async (req, res) => {
  const user_vocab_id = req.body?.user_vocab_id || req.params?.id;
  const rating = req.body?.rating;
  const userId = getUserIdFromReq(req);

  try {
    if (!user_vocab_id) {
      return res.status(400).json({
        success: false,
        message: "user_vocab_id is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Thiếu token xác thực hoặc user_id",
      });
    }

    const result = await reviewCollocationEntry({
      user_vocab_id,
      rating,
      userId,
    });

    return res.status(200).json(result);
  } catch (error) {
    const isAuthError =
      error.message?.includes("quyền") || error.message?.includes("permission");
    const isNotFoundError =
      error.message?.includes("không tìm thấy") ||
      error.message?.includes("not found");
    const statusCode = isAuthError ? 403 : isNotFoundError ? 404 : 400;

    return res.status(statusCode).json({
      success: false,
      message: error.message || "Failed to review collocation",
    });
  }
};

export const getCollocationReview = async (req, res) => {
  try {
    const data = await getPhase1Data(req.params.collocationId);
    return res.status(200).json(data);
  } catch (error) {
    console.error("getCollocationReview failed:", error);
    return res.status(404).json({
      success: false,
      message: error.message || "Failed to load collocation review",
    });
  }
};

export const getNextCollocationHandler = async (_req, res) => {
  try {
    const data = await getNextCollocation();
    return res.status(200).json(data);
  } catch (error) {
    console.error("getNextCollocationHandler failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load next collocation",
    });
  }
};

export const getCollocationVariations = async (req, res) => {
  try {
    const { collocationId } = req.params;
    const userId = getUserIdFromReq(req);

    if (!collocationId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu collocationId trong query parameters!",
      });
    }

    const result = await getCollocationVariationsService(collocationId, userId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in getCollocationVariations controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error khi lấy biến thể collocation",
    });
  }
};

export const completeReview = async (req, res) => {
  try {
    const { collocationId } = req.params;
    const userId = getUserIdFromReq(req);
    const { rating } = req.body;

    if (!collocationId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu collocationId trong tham số!",
      });
    }

    const result = await completeReviewService({
      collocationId,
      userId,
      rating: rating || "good",
    });

    return res.status(200).json({
      success: true,
      message: "Đã hoàn thành Phase 3 và cập nhật lịch ôn tập SRS thành công!",
      data: result,
    });
  } catch (error) {
    console.error("Error in completePhase3 controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error khi lưu kết quả Phase 3",
    });
  }
};

// ==================== 3 ACTIVE PHASES CONTROLLERS ====================

export const getPhase1Translation = async (req, res) => {
  try {
    const collocationId = req.params?.collocationId || req.query?.collocationId;
    const userId = getUserIdFromReq(req);

    if (!collocationId) {
      return res.status(400).json({
        success: false,
        message: "Thiếu collocationId!",
      });
    }

    const result = await getPhase1TranslationService({ collocationId, userId });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in getPhase1Translation controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load Phase 1 translation data",
    });
  }
};

export const evaluatePhase2Collocation = async (req, res) => {
  try {
    const { collocationId, userSentence } = req.body;
    const userId = getUserIdFromReq(req);

    if (!collocationId || !userSentence) {
      return res.status(400).json({
        success: false,
        message: "Thiếu collocationId hoặc câu tiếng Anh (userSentence)!",
      });
    }

    const result = await evaluatePhase2CollocationService({
      collocationId,
      userSentence,
      userId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in evaluatePhase2Collocation controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to evaluate Phase 2 sentence",
    });
  }
};

export const evaluatePhase3Collocation = async (req, res) => {
  try {
    const { collocationId, userStory } = req.body;
    const userId = getUserIdFromReq(req);

    if (!collocationId || !userStory) {
      return res.status(400).json({
        success: false,
        message: "Thiếu collocationId hoặc đoạn văn (userStory)!",
      });
    }

    const result = await evaluatePhase3CollocationService({
      collocationId,
      userStory,
      userId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error in evaluatePhase3Collocation controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to evaluate Phase 3 story",
    });
  }
};