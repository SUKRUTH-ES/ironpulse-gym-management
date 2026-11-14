// "30s", "60s each side", "15 min" are held/timed, not counted in reps
export const isTimed = (reps = '') => /^\d+\s*(s|sec|min)\b/.test(reps);

// Unit the member types a timed set in: 'min' for "20 min", 'sec' for "30s"
export const timeUnit = (reps = '') => (/^\d+\s*min\b/.test(reps) ? 'min' : 'sec');
