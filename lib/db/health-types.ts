// Row types for Phase 5 health/fitness module. Mirrors the §5.6 schema.

export type HealthDailyRow = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  steps: number | null;
  sleep_minutes: number | null;
  sleep_start: string | null;
  sleep_end: string | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  resting_heart_rate: number | null;
  hrv: number | null;
  vo2_max: number | null;
  active_energy_burned: number | null;
  workouts_count: number | null;
  workout_minutes: number | null;
  weight: number | null;
  body_fat_percentage: number | null;
  calories_consumed: number | null;
  protein_grams: number | null;
  recovery_score: number | null;
  activity_score: number | null;
  nutrition_score: number | null;
  source: "healthkit" | "shortcut" | "manual";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkoutRow = {
  id: string;
  user_id: string;
  date: string;
  workout_type: string | null;
  duration_minutes: number | null;
  calories_burned: number | null;
  distance: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  source: "healthkit" | "shortcut" | "manual";
  notes: string | null;
  created_at: string;
};

export type NutritionLogRow = {
  id: string;
  user_id: string;
  date: string;
  meal_name: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: string[];
  source: "healthkit" | "shortcut" | "manual";
  notes: string | null;
  created_at: string;
};
