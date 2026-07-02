import { getScoredSections } from "../data/checklistConfig";

const CALIFICATION_BASE_SCORE = 212;

export function getMatrixAnswerId(itemId, sprayerNumber) {
  return `${itemId}_asp_${sprayerNumber}`;
}

function clampSprayerCount(section, sprayerCounts = {}) {
  const configuredCount = Number(sprayerCounts[section.id]);
  const fallbackCount = section.matrix?.defaultSprayerCount ?? 1;
  const maxCount = section.matrix?.maxSprayerCount ?? fallbackCount;
  const count = Number.isFinite(configuredCount) && configuredCount > 0
    ? configuredCount
    : fallbackCount;

  return Math.min(Math.max(Math.round(count), 1), maxCount);
}

function getMatrixConvertedScore(rawEarnedScore, rawMaxScore, answeredCount) {
  if (answeredCount === 0 || rawMaxScore <= 0) {
    return 0;
  }

  const rawPercent = (rawEarnedScore / rawMaxScore) * 100;

  if (rawPercent >= 90) {
    return 90;
  }

  if (rawPercent >= 80) {
    return 60;
  }

  return 30;
}

export function calculateMatrixSection(section, answers, sprayerCount) {
  const count = Math.min(
    Math.max(Math.round(Number(sprayerCount) || section.matrix.defaultSprayerCount), 1),
    section.matrix.maxSprayerCount
  );
  let rawEarnedScore = 0;
  let rawMaxScore = 0;
  let answeredCount = 0;

  for (const item of section.items) {
    const cellWeight = item.weight / count;

    for (let sprayerNumber = 1; sprayerNumber <= count; sprayerNumber += 1) {
      const answerId = getMatrixAnswerId(item.id, sprayerNumber);
      const answer = answers[answerId] ?? {};

      rawMaxScore += cellWeight;

      if (answer.status) {
        answeredCount += 1;
      }

      if (answer.status === "yes") {
        rawEarnedScore += cellWeight;
      }
    }
  }

  const rawPercent = rawMaxScore > 0 ? (rawEarnedScore / rawMaxScore) * 100 : 0;
  const convertedScore = getMatrixConvertedScore(rawEarnedScore, rawMaxScore, answeredCount);

  return {
    sprayerCount: count,
    rawEarnedScore,
    rawMaxScore,
    rawPercent,
    convertedScore,
    convertedMaxScore: section.matrix.totalWeight,
    answeredCount
  };
}

export function buildInitialAnswers() {
  return getScoredSections().reduce((answers, section) => {
    if (section.matrix) {
      for (const item of section.items) {
        for (let sprayerNumber = 1; sprayerNumber <= section.matrix.maxSprayerCount; sprayerNumber += 1) {
          answers[getMatrixAnswerId(item.id, sprayerNumber)] = {
            status: null,
            value: "",
            observation: ""
          };
        }
      }

      return answers;
    }

    for (const item of section.items) {
      answers[item.id] = {
        status: null,
        value: "",
        observation: ""
      };
    }

    return answers;
  }, {});
}

export function calculateScore(answers, options = {}) {
  const sections = getScoredSections();
  let earnedScore = 0;
  let maxScore = 0;
  let nonCompliantScore = 0;
  let answerableCount = 0;
  let answeredCount = 0;
  const compliant = [];
  const nonCompliant = [];

  for (const section of sections) {
    if (section.matrix) {
      const sprayerCount = clampSprayerCount(section, options.sprayerCounts);
      const matrixResult = calculateMatrixSection(section, answers, sprayerCount);

      for (const item of section.items) {
        const cellWeight = item.weight / sprayerCount;

        for (let sprayerNumber = 1; sprayerNumber <= sprayerCount; sprayerNumber += 1) {
          const itemId = getMatrixAnswerId(item.id, sprayerNumber);
          const answer = answers[itemId] ?? {};
          const row = {
            sectionId: section.id,
            sectionTitle: section.title,
            itemId,
            itemLabel: `${item.label} - Asperjador ${sprayerNumber}`,
            criterion: item.criterion,
            weight: cellWeight,
            rawWeight: cellWeight,
            value: answer.value ?? "",
            observation: answer.observation ?? ""
          };

          answerableCount += 1;

          if (answer.status) {
            answeredCount += 1;
          }

          if (answer.status === "yes") {
            compliant.push(row);
          } else if (answer.status === "no") {
            nonCompliant.push(row);
          }
        }
      }

      earnedScore += matrixResult.convertedScore;
      maxScore += matrixResult.convertedMaxScore;
      nonCompliantScore += matrixResult.convertedMaxScore - matrixResult.convertedScore;

      continue;
    }

    for (const item of section.items) {
      const answer = answers[item.id] ?? {};
      const row = {
        sectionId: section.id,
        sectionTitle: section.title,
        itemId: item.id,
        itemLabel: item.label,
        criterion: item.criterion,
        weight: item.weight,
        value: answer.value ?? "",
        observation: answer.observation ?? ""
      };

      maxScore += item.weight;
      answerableCount += 1;

      if (answer.status) {
        answeredCount += 1;
      }

      if (answer.status === "yes") {
        earnedScore += item.weight;
        compliant.push(row);
      } else if (answer.status === "no") {
        nonCompliantScore += item.weight;
        nonCompliant.push(row);
      }
    }
  }

  const missingScore = maxScore - earnedScore;
  const compliancePercent = maxScore > 0 ? (earnedScore / maxScore) * 100 : 0;
  const calificationPercent = (earnedScore / CALIFICATION_BASE_SCORE) * 100;

  return {
    earnedScore,
    maxScore,
    nonCompliantScore,
    calificationBaseScore: CALIFICATION_BASE_SCORE,
    calificationPercent,
    missingScore,
    compliancePercent,
    answerableCount,
    answeredCount,
    compliant,
    nonCompliant
  };
}

export function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: value % 1 === 0 ? 0 : digits,
    maximumFractionDigits: digits
  }).format(value);
}
