// ─── Parser ───
// Pure functions — no side effects, no storage, no UI.
// This is the core syntax engine for Lift.

export function extractRest(str) {
  const match = str.match(/\s+r(\d+)\s*$/i);
  if (match) {
    return [str.slice(0, match.index).trim(), parseInt(match[1])];
  }
  return [str, null];
}

export function parseSingleSet(segment) {
  const [cleaned, rest] = extractRest(segment.trim());
  const trimmed = cleaned.toUpperCase();

  // Bodyweight with sets: "10xBWx3" or "10*BW*3"
  const bwSetsMatch = trimmed.match(/^(\d+)\s*[X*]\s*BW\s*[X*]\s*(\d+)$/);
  if (bwSetsMatch) {
    return { reps: parseInt(bwSetsMatch[1]), weight: 'BW', sets: parseInt(bwSetsMatch[2]), rest };
  }

  // Bodyweight simple: "20BW"
  const bwMatch = trimmed.match(/^(\d+)\s*BW$/);
  if (bwMatch) {
    return { reps: parseInt(bwMatch[1]), weight: 'BW', sets: 1, rest };
  }

  // Bodyweight with separator: "10xBW" or "10*BW"
  const bwXMatch = trimmed.match(/^(\d+)\s*[X*]\s*BW$/);
  if (bwXMatch) {
    return { reps: parseInt(bwXMatch[1]), weight: 'BW', sets: 1, rest };
  }

  // RxWxS — 4x20x3 or 4*20*3 or mixed
  const fullMatch = trimmed.match(/^(\d+)\s*[X*]\s*(\d+(?:\.\d+)?)\s*[X*]\s*(\d+)$/);
  if (fullMatch) return { reps: parseInt(fullMatch[1]), weight: parseFloat(fullMatch[2]), sets: parseInt(fullMatch[3]), rest };

  // RxW — 4x20 or 4*20
  const simpleMatch = trimmed.match(/^(\d+)\s*[X*]\s*(\d+(?:\.\d+)?)$/);
  if (simpleMatch) return { reps: parseInt(simpleMatch[1]), weight: parseFloat(simpleMatch[2]), sets: 1, rest };

  return null;
}

export function parseSetLine(line) {
  if (line.includes(',')) {
    const segments = line.split(',');
    const parsed = segments.map((s) => parseSingleSet(s));
    if (parsed.every((p) => p !== null)) {
      return parsed;
    }
    return null;
  }

  const result = parseSingleSet(line);
  return result ? [result] : null;
}

export function parseWorkouts(text) {
  const lines = text.split('\n');
  const exercises = [];
  let current = null;

  for (const line of lines) {
    const raw = line.trim();
    if (raw === '') { current = null; continue; }

    let content = raw;
    let note = null;
    const commentIdx = raw.indexOf('//');
    if (commentIdx !== -1) {
      content = raw.slice(0, commentIdx).trim();
      note = raw.slice(commentIdx + 2).trim() || null;
    }

    if (!content && note) {
      if (current) {
        if (current.entries.length > 0) {
          const lastEntry = current.entries[current.entries.length - 1];
          lastEntry.note = lastEntry.note ? lastEntry.note + ' ' + note : note;
        } else {
          current.note = current.note ? current.note + ' ' + note : note;
        }
      }
      continue;
    }

    if (!content) continue;

    const setData = parseSetLine(content);
    if (setData !== null) {
      if (current === null) { current = { name: 'Unnamed', entries: [], note: null, rest: null }; exercises.push(current); }
      current.entries.push({ sets: setData, note: note });
    } else {
      const [exName, exRest] = extractRest(content);
      current = { name: exName, entries: [], note: note, rest: exRest };
      exercises.push(current);
    }
  }
  return exercises;
}

export function groupByDay(exercises) {
  const maxDays = Math.max(0, ...exercises.map((e) => e.entries.length));
  const days = [];
  for (let d = 0; d < maxDays; d++) {
    const items = [];
    for (const ex of exercises) {
      if (d < ex.entries.length) items.push({ name: ex.name, sets: ex.entries[d].sets, note: ex.entries[d].note, rest: ex.rest });
    }
    if (items.length > 0) days.push({ dayIndex: d, totalDays: maxDays, items });
  }
  return days;
}

// ─── Session Builder ───

export function buildSessionSteps(exercises) {
  const steps = [];
  for (const ex of exercises) {
    if (ex.entries.length === 0) continue;
    const firstEntry = ex.entries[0];
    const sets = firstEntry.sets;

    for (let si = 0; si < sets.length; si++) {
      const s = sets[si];
      const count = s.sets || 1;
      for (let ri = 0; ri < count; ri++) {
        const rest = s.rest || ex.rest || null;
        steps.push({
          exercise: ex.name,
          setIndex: si,
          repIndex: ri,
          totalSetsForSegment: count,
          suggestedReps: s.reps,
          suggestedWeight: s.weight,
          rest: rest,
        });
      }
    }
  }
  return steps;
}

// ─── Formatters ───

export function formatRest(seconds) {
  if (!seconds) return null;
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? m + 'm ' + s + 's rest' : m + 'm rest';
  }
  return seconds + 's rest';
}

export function formatSet(s) {
  const w = s.weight === 'BW' ? 'bodyweight' : s.weight + ' lbs';
  if (s.sets > 1) return s.sets + ' sets \u00D7 ' + s.reps + ' reps @ ' + w;
  return s.reps + ' reps @ ' + w;
}

export function formatEntrySummary(sets) {
  const totalSets = sets.reduce((sum, s) => sum + s.sets, 0);
  const totalReps = sets.reduce((sum, s) => sum + s.reps * s.sets, 0);
  const weights = [...new Set(sets.map((s) => s.weight === 'BW' ? 'BW' : s.weight))];
  const wStr = weights.map((w) => w === 'BW' ? 'bodyweight' : w + ' lbs').join(', ');
  return totalSets + ' sets \u00B7 ' + totalReps + ' total reps @ ' + wStr;
}

export function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (m > 0 ? m + ':' : '') + (s < 10 && m > 0 ? '0' : '') + s;
}

export function getAutoDate(index, total) {
  const now = new Date();
  const daysBack = total - 1 - index;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
}

export function formatDate(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
}

// ─── Session Results → Text ───

export function buildResultsText(results, existingText) {
  const grouped = [];
  let currentEx = null;
  for (const r of results) {
    if (!currentEx || currentEx.name !== r.exercise) {
      currentEx = { name: r.exercise, sets: [] };
      grouped.push(currentEx);
    }
    currentEx.sets.push(r);
  }

  const lines = existingText.split('\n');
  const newLines = [...lines];

  for (const group of grouped) {
    let exLineIdx = -1;
    for (let i = 0; i < newLines.length; i++) {
      const clean = newLines[i].trim();
      if (!clean) continue;
      const commentIdx = clean.indexOf('//');
      const content = commentIdx !== -1 ? clean.slice(0, commentIdx).trim() : clean;
      const [exName] = extractRest(content);
      if (exName.toLowerCase() === group.name.toLowerCase()) {
        exLineIdx = i;
        break;
      }
    }

    if (exLineIdx === -1) continue;

    let insertIdx = exLineIdx + 1;
    while (insertIdx < newLines.length && newLines[insertIdx].trim() !== '') {
      insertIdx++;
    }

    let setLine;
    if (group.sets.length === 1) {
      const s = group.sets[0];
      const w = s.weight === 'BW' ? 'BW' : s.weight;
      setLine = s.reps + '*' + w;
    } else {
      const allSame = group.sets.every((s) =>
        s.reps === group.sets[0].reps && s.weight === group.sets[0].weight
      );
      if (allSame) {
        const s = group.sets[0];
        const w = s.weight === 'BW' ? 'BW' : s.weight;
        setLine = s.reps + '*' + w + '*' + group.sets.length;
      } else {
        setLine = group.sets.map((s) => {
          const w = s.weight === 'BW' ? 'BW' : s.weight;
          return s.reps + '*' + w;
        }).join(', ');
      }
    }

    newLines.splice(insertIdx, 0, setLine);
  }

  return newLines.join('\n');
}

// ─── Metric Computation ───

export const METRICS = [
  { key: 'volume', label: 'Volume', unit: '' },
  { key: 'maxWeight', label: 'Max Weight', unit: 'lbs' },
  { key: 'totalReps', label: 'Total Reps', unit: '' },
];

export function computeMetric(sets, metric) {
  switch (metric) {
    case 'volume':
      return sets.reduce((sum, s) => {
        const w = s.weight === 'BW' ? 0 : s.weight;
        return sum + s.reps * w * s.sets;
      }, 0);
    case 'maxWeight':
      return Math.max(...sets.map((s) => (s.weight === 'BW' ? 0 : s.weight)));
    case 'totalReps':
      return sets.reduce((sum, s) => sum + s.reps * s.sets, 0);
    default:
      return 0;
  }
}

// ─── Constants ───

export const ONBOARDING_TEXT = [
  'Squat r90',
  '5*135*3',
  '5*185*3 // Felt strong',
  '',
  'Bench Press',
  '8*135 r45, 8*155 r60, 6*155',
  '',
  'Pull-ups',
  '10BW',
].join('\n');
