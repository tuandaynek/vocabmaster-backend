export const VALID_SRS_RATINGS = ["again", "hard", "good", "easy"];

export const calculateNextReview = ({
  rating,
  currentStep,
  currentInterval,
  easeFactor,
}) => {
  const step = Number(currentStep ?? 0);
  const interval = Number(currentInterval ?? 1.0);
  const ease = Number(easeFactor ?? 2.5);

  let nextStep = step;
  let nextInterval = interval;
  let nextEase = ease;

  switch (rating) {
    case "again":
      nextStep = 0;
      nextInterval = 1.0;
      nextEase = Math.max(1.3, ease - 0.2);
      break;

    case "hard":
      nextStep = step;
      nextInterval = interval === 1.0 ? 5.0 : Math.max(5.0, interval * 1.2);
      nextEase = Math.max(1.3, ease - 0.15);
      break;

    case "good":
      nextStep = step + 1;
      nextInterval = interval === 1.0 ? 10.0 : interval * ease;
      nextEase = ease;
      break;

    case "easy":
      nextStep = step + 2;
      nextInterval = interval === 1.0 ? 1440.0 : interval * ease * 1.5;
      nextEase = Math.min(3.0, ease + 0.15);
      break;

    default:
      throw new Error(
        "Rating không hợp lệ. Các giá trị cho phép: again, hard, good, easy",
      );
  }

  return {
    step: nextStep,
    interval: Number(nextInterval.toFixed(2)),
    ease_factor: Number(nextEase.toFixed(2)),
  };
};

export const buildSrsUpdatePayload = (nextState) => {
  const newIntervalMinutes = Number(nextState.interval);
  const nextReview = new Date(
    Date.now() + newIntervalMinutes * 60 * 1000,
  ).toISOString();

  return {
    step: nextState.step,
    interval: newIntervalMinutes,
    ease_factor: nextState.ease_factor,
    next_review: nextReview,
    status: newIntervalMinutes >= 43200 ? "mastered" : "learning",
  };
};
