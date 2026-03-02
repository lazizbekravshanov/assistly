/* ── derot Challenges System ── */

const CHALLENGE_POOL = [
  {
    id: "early_bird",
    name: "Early Bird",
    description: "Start 3 focus sessions before 9 AM",
    target: 3,
    xp: 50,
    evaluate: (stats, state) => {
      const hour = new Date().getHours();
      return hour < 9 && state.focusActive ? 1 : 0;
    }
  },
  {
    id: "fortress",
    name: "Fortress",
    description: "Block 50 distractions this week",
    target: 50,
    xp: 40,
    evaluate: (stats) => {
      return weeklySum(stats.dailyBlocked);
    }
  },
  {
    id: "marathon",
    name: "Marathon",
    description: "Accumulate 10 hours of focus this week",
    target: 600,
    xp: 80,
    evaluate: (stats) => {
      return weeklySum(stats.dailyFocus);
    }
  },
  {
    id: "triple_threat",
    name: "Triple Threat",
    description: "Complete 3 pomodoros in one day",
    target: 3,
    xp: 30,
    evaluate: (stats) => {
      const d = new Date().toISOString().split("T")[0];
      return (stats.dailyPomodoros || {})[d] || 0;
    }
  },
  {
    id: "consistent",
    name: "Consistency King",
    description: "Focus every day this week (7 days)",
    target: 7,
    xp: 60,
    evaluate: (stats) => {
      const days = getWeekDays();
      let count = 0;
      for (const d of days) {
        if ((stats.dailyFocus?.[d] || 0) > 0) count++;
      }
      return count;
    }
  },
  {
    id: "deep_dive",
    name: "Deep Dive",
    description: "Have a single focus session lasting 2+ hours",
    target: 1,
    xp: 50,
    evaluate: (stats, state) => {
      if (state.focusActive && state.focusStartTime) {
        const elapsed = (Date.now() - state.focusStartTime) / 60000;
        if (elapsed >= 120) return 1;
      }
      return 0;
    }
  },
  {
    id: "power_hour",
    name: "Power Hour",
    description: "Focus for 60+ minutes on 5 different days",
    target: 5,
    xp: 60,
    evaluate: (stats) => {
      const days = getWeekDays();
      let count = 0;
      for (const d of days) {
        if ((stats.dailyFocus?.[d] || 0) >= 60) count++;
      }
      return count;
    }
  },
  {
    id: "goal_crusher",
    name: "Goal Crusher",
    description: "Hit your daily focus goal 5 times this week",
    target: 5,
    xp: 70,
    evaluate: (stats) => {
      const days = getWeekDays();
      let count = 0;
      for (const d of days) {
        if ((stats.goalsCompleted || {})[d]) count++;
      }
      return count;
    }
  }
];

const RANKS = [
  { name: "Apprentice", xp: 0 },
  { name: "Scholar", xp: 100 },
  { name: "Adept", xp: 300 },
  { name: "Master", xp: 600 },
  { name: "Sage", xp: 1000 },
  { name: "Legend", xp: 2000 }
];

function getWeekDays() {
  const days = [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

function weeklySum(dailyObj) {
  if (!dailyObj) return 0;
  const days = getWeekDays();
  let sum = 0;
  for (const d of days) {
    sum += dailyObj[d] || 0;
  }
  return sum;
}

function getMonday() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  return monday.toISOString().split("T")[0];
}

function pickWeeklyChallenges() {
  // Shuffle and pick 4
  const shuffled = [...CHALLENGE_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 4).map(ch => ({
    id: ch.id,
    name: ch.name,
    description: ch.description,
    target: ch.target,
    xp: ch.xp,
    progress: 0,
    completed: false
  }));
}

function getRankForXp(xp) {
  let rank = RANKS[0].name;
  for (const r of RANKS) {
    if (xp >= r.xp) rank = r.name;
  }
  return rank;
}
