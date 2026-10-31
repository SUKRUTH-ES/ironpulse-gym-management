// "30s", "60s each side", "15 min" are held/timed, not counted in reps
export const isTimed = (reps = '') => /^\d+\s*(s|sec|min)\b/.test(reps);
