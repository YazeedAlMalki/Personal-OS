// Forecast thresholds — spec §9.2 keeps these as a single dial-board so a
// statistical/model upgrade can replace one heuristic without touching callers.

export const FORECAST_THRESHOLDS = {
  // Deadline miss.
  focusHoursPerDay: 8,
  deadlineMissFlag: 0.6, // ≥ 0.6 raises an insight
  // Goal trajectory.
  goalOnTrackGap: -10, // pts of progress vs expected; gap ≥ -10 = on track
  goalAtRiskGap: -25, // -10 > gap ≥ -25 = at risk; below = off track
  // Task completion risk.
  taskRiskFlag: 0.65,
  // Sleep / activity.
  sleepLowMinutes: 7 * 60,
  stepsLow: 8000,
  consecutiveLowNights: 3,
  // Workout consistency.
  workoutSessionsPerWeekTarget: 3,
  // Pipeline.
  pipelineWowDropFlag: 0.2, // 20% week-over-week drop fires
  // Risk exposure.
  riskExposureHighScore: 12,
};
