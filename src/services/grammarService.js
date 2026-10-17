import { supabase } from "../lib/supabase.js";
import { XP_RULES } from "../utils/xpCalculation.js";

const normalizePuzzlePayload = (payload) => {
  if (
    !payload ||
    typeof payload.vietnamesePrompt !== "string" ||
    !Array.isArray(payload.correctSentence) ||
    !payload.correctSentence.every((word) => typeof word === "string")
  ) {
    throw new Error(
      "Puzzle payload must include a vietnamesePrompt string and a correctSentence array of strings",
    );
  }

  return {
    vietnamesePrompt: payload.vietnamesePrompt,
    correctSentence: payload.correctSentence,
  };
};

export const getTopicsWithProgressService = async (userId) => {
  const { data: topics, error: topicsError } = await supabase
    .from("grammar_topics")
    .select(`
      id, title, category, description, level, badge_color, icon_bg,
      grammar_sub_topics (
        id, topic_id, title, description, order_index,
        grammar_game_stages (
          id, game_type, grammar_questions (id)
        )
      )
    `)
    .order("created_at", { ascending: true });

  if (topicsError) {
    throw new Error(`Failed to fetch grammar topics: ${topicsError.message}`);
  }

  let progressRows = [];
  if (userId) {
    const { data, error: progressError } = await supabase
      .from("user_grammar_progress")
      .select("topic_id, sub_topic_id, progress_percentage, is_mastered, is_locked")
      .eq("user_id", userId);

    if (progressError) {
      throw new Error(`Failed to fetch grammar progress: ${progressError.message}`);
    }
    progressRows = data ?? [];
  }

  const progressBySubTopic = new Map();
  for (const row of progressRows) {
    progressBySubTopic.set(row.sub_topic_id, row);
  }

  return (topics ?? []).map((topic) => {
    const subTopics = (topic.grammar_sub_topics ?? []).map((subTopic) => {
      const progress = progressBySubTopic.get(subTopic.id);
      return {
        ...subTopic,
        progress: progress?.progress_percentage ?? 0,
        is_mastered: progress?.is_mastered ?? false,
        is_locked: progress?.is_locked ?? false,
      };
    });
    const progressTotal = subTopics.reduce(
      (total, subTopic) => total + subTopic.progress,
      0,
    );
    const lockedSubTopics = subTopics.filter((subTopic) => subTopic.is_locked);
    return {
      ...topic,
      grammar_sub_topics: subTopics,
      progress: subTopics.length
        ? Math.round(progressTotal / subTopics.length)
        : 0,
      isLocked:
        subTopics.length > 0 && lockedSubTopics.length === subTopics.length,
    };
  });
};

export const getSubTopicsByTopicIdService = async (topicId, userId) => {
  const { data, error } = await supabase
    .from("grammar_sub_topics")
    .select(`
      id, topic_id, title, description, order_index,
      grammar_game_stages (
        id, game_type, grammar_questions (id)
      )
    `)
    .eq("topic_id", topicId)
    .order("order_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch grammar sub-topics: ${error.message}`);
  }

  if (!userId) {
    return (data ?? []).map((subTopic) => ({
      ...subTopic,
      progress: 0,
      is_mastered: false,
      is_locked: false,
    }));
  }

  if (!data?.length) return [];

  const { data: progressRows, error: progressError } = await supabase
    .from("user_grammar_progress")
    .select("sub_topic_id, progress_percentage, is_mastered, is_locked")
    .eq("user_id", userId)
    .in("sub_topic_id", (data ?? []).map((subTopic) => subTopic.id));

  if (progressError) {
    throw new Error(`Failed to fetch grammar sub-topic progress: ${progressError.message}`);
  }

  const progressBySubTopic = new Map(
    (progressRows ?? []).map((row) => [row.sub_topic_id, row]),
  );
  return (data ?? []).map((subTopic) => {
    const progress = progressBySubTopic.get(subTopic.id);
    return {
      ...subTopic,
      progress: progress?.progress_percentage ?? 0,
      is_mastered: progress?.is_mastered ?? false,
      is_locked: progress?.is_locked ?? false,
    };
  });
};

export const getSubTopicDetailService = async (subTopicId) => {
  const { data, error } = await supabase
    .from("grammar_sub_topics")
    .select("*")
    .eq("id", subTopicId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch grammar sub-topic: ${error.message}`);
  }

  return data;
};

export const createSubTopicService = async (topicId, subTopicData) => {
  const {
    title,
    description,
    orderIndex,
    theoryContent = {},
  } = subTopicData;

  const { data, error } = await supabase
    .from("grammar_sub_topics")
    .insert([
      {
        topic_id: topicId,
        title,
        description,
        order_index: orderIndex,
        theory_content: theoryContent,
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create grammar sub-topic: ${error.message}`);
  }

  return data;
};

export const updateSubTopicTheoryService = async (
  subTopicId,
  updateData,
) => {
  const { title, description, orderIndex, theoryContent } = updateData;
  const updatePayload = {};

  if (title !== undefined) updatePayload.title = title;
  if (description !== undefined) updatePayload.description = description;
  if (orderIndex !== undefined) updatePayload.order_index = orderIndex;
  if (theoryContent !== undefined) {
    updatePayload.theory_content = theoryContent;
  }

  const { data, error } = await supabase
    .from("grammar_sub_topics")
    .update(updatePayload)
    .eq("id", subTopicId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update grammar sub-topic: ${error.message}`);
  }

  return data;
};

export const createGrammarTopicService = async (topicData) => {
  const {
    title,
    category,
    description,
    level,
    badgeColor,
    iconBg,
  } = topicData;

  const { data, error } = await supabase
    .from("grammar_topics")
    .insert([
      {
        title,
        category,
        description,
        level,
        badge_color: badgeColor,
        icon_bg: iconBg,
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create grammar topic: ${error.message}`);
  }

  return data;
};

export const getStagesBySubTopicIdService = async (subTopicId) => {
  const { data, error } = await supabase
    .from("grammar_game_stages")
    .select("*")
    .eq("sub_topic_id", subTopicId)
    .order("order_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch grammar stages: ${error.message}`);
  }

  return data;
};

export const getQuestionsByStageIdService = async (stageId, limit) => {
  let query = supabase
    .from("grammar_questions")
    .select("*")
    .eq("stage_id", stageId)
    .order("order_index", { ascending: true });

  if (limit !== undefined) {
    query = query.limit(Number(limit));
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch grammar questions: ${error.message}`);
  }

  return data;
};

export const createStageService = async (subTopicId, stageData) => {
  const { title, gameType, orderIndex } = stageData;
  const { data, error } = await supabase
    .from("grammar_game_stages")
    .insert([
      {
        sub_topic_id: subTopicId,
        title,
        game_type: gameType,
        order_index: orderIndex,
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create grammar stage: ${error.message}`);
  }

  return data;
};

export const createQuestionService = async (stageId, questionData) => {
  const { questionType, payload = {}, orderIndex } = questionData;
  const storedPayload =
    questionType === "puzzle" ? normalizePuzzlePayload(payload) : payload;
  const { data, error } = await supabase
    .from("grammar_questions")
    .insert([
      {
        stage_id: stageId,
        question_type: questionType,
        payload: storedPayload,
        order_index: orderIndex,
      },
    ])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create grammar question: ${error.message}`);
  }

  return data;
};

export const submitGameSessionService = async (sessionData) => {
  const {
    userId,
    topicId,
    subTopicId,
    score,
    correctCount,
    totalQuestions,
    isCompleted,
  } = sessionData;
  const progressPercentage = Math.round((correctCount / totalQuestions) * 100);

  const { data: existingProgress, error: existingProgressError } = await supabase
    .from("user_grammar_progress")
    .select("is_mastered")
    .eq("user_id", userId)
    .eq("sub_topic_id", subTopicId)
    .maybeSingle();

  if (existingProgressError) {
    throw new Error(`Failed to read grammar progress: ${existingProgressError.message}`);
  }

  const { data: progress, error: progressError } = await supabase
    .from("user_grammar_progress")
    .upsert(
      {
        user_id: userId,
        topic_id: topicId,
        sub_topic_id: subTopicId,
        progress_percentage: progressPercentage,
        is_mastered:
          existingProgress?.is_mastered === true ||
          (isCompleted === undefined
            ? progressPercentage >= 100
            : isCompleted),
        last_score: score,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,sub_topic_id" },
    )
    .select()
    .single();

  if (progressError) {
    throw new Error(`Failed to save grammar progress: ${progressError.message}`);
  }

  const xpGained = XP_RULES.LESSON_COMPLETE;
  const { error: xpError } = await supabase.rpc("log_user_activity", {
    p_user_id: userId,
    p_xp_earned: xpGained,
    p_words_learned: 0,
    p_words_reviewed: 0,
    p_collocations_learned: 0,
  });

  if (xpError) {
    throw new Error(`Failed to award grammar session XP: ${xpError.message}`);
  }

  return { progress, xpGained };
};

export const getUserProgressService = async (userId) => {
  const { data: progressRows, error: progressError } = await supabase
    .from("user_grammar_progress")
    .select(`
      id, user_id, topic_id, sub_topic_id, progress_percentage,
      is_mastered, last_score, is_locked, updated_at,
      grammar_topics (title),
      grammar_sub_topics (title)
    `)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (progressError) {
    throw new Error(`Failed to fetch user grammar progress: ${progressError.message}`);
  }

  return progressRows ?? [];
};

export const importFullSubTopicService = async (payload) => {
  let subTopicId;

  try {
    const {
      topicId,
      title,
      description,
      orderIndex,
      theoryContent = {},
      stages,
    } = payload;

    const { data: subTopic, error: subTopicError } = await supabase
      .from("grammar_sub_topics")
      .insert([
        {
          topic_id: topicId,
          title,
          description,
          order_index: orderIndex ?? 0,
          theory_content: theoryContent,
        },
      ])
      .select()
      .single();

    if (subTopicError) {
      throw new Error(`Failed to insert sub-topic: ${subTopicError.message}`);
    }

    subTopicId = subTopic.id;
    const importedStages = [];

    for (const [stageIndex, stageData] of stages.entries()) {
      const { data: stage, error: stageError } = await supabase
        .from("grammar_game_stages")
        .insert([
          {
            sub_topic_id: subTopicId,
            title: stageData.title,
            game_type: stageData.gameType,
            order_index: stageData.orderIndex ?? stageIndex,
          },
        ])
        .select()
        .single();

      if (stageError) {
        throw new Error(
          `Failed to insert stage ${stageIndex + 1}: ${stageError.message}`,
        );
      }

      const questions = [];
      for (const [questionIndex, questionData] of (
        stageData.questions ?? []
      ).entries()) {
        const { data: question, error: questionError } = await supabase
          .from("grammar_questions")
          .insert([
            {
              stage_id: stage.id,
              question_type: questionData.questionType,
              payload:
                questionData.questionType === "puzzle"
                  ? normalizePuzzlePayload(questionData.payload)
                  : questionData.payload ?? {},
              order_index: questionData.orderIndex ?? questionIndex,
            },
          ])
          .select()
          .single();

        if (questionError) {
          throw new Error(
            `Failed to insert question ${questionIndex + 1} in stage ${
              stageIndex + 1
            }: ${questionError.message}`,
          );
        }

        questions.push(question);
      }

      importedStages.push({ ...stage, questions });
    }

    return { ...subTopic, stages: importedStages };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected import error";

    if (subTopicId) {
      try {
        const { error: cleanupError } = await supabase
          .from("grammar_sub_topics")
          .delete()
          .eq("id", subTopicId);

        if (cleanupError) {
          throw new Error(cleanupError.message);
        }
      } catch (cleanupError) {
        throw new Error(
          `Full sub-topic import failed: ${message}. Cleanup also failed: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : "Unexpected cleanup error"
          }`,
        );
      }
    }

    throw new Error(`Full sub-topic import failed: ${message}`);
  }
};