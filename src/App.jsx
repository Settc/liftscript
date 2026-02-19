import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  loadSavedWorkouts, persistWorkouts, loadLastSession, persistLastSession,
  loadDarkMode, persistDarkMode, hasSeenOnboarding, markOnboardingSeen
} from "./storage";
import {
  shareWorkout, importWorkout, nativeShare
} from "./supabase";
import {
  keepScreenAwake, allowScreenSleep,
  requestNotificationPermission, scheduleRestNotification, cancelRestNotification
} from "./native";
import {
  extractRest, parseSingleSet, parseSetLine, parseWorkouts, groupByDay,
  buildSessionSteps, formatRest, formatSet, formatEntrySummary, formatTimer,
  formatCardioTime, getAutoDate, formatDate, buildResultsText,
  METRICS, CARDIO_METRICS, computeMetric, computeCardioMetric, isCardioExercise, ONBOARDING_TEXT
} from "./parser";

/* ────────────────────────────────────────────
   ICONS
   ──────────────────────────────────────────── */

const IconSave = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
  </svg>
);

const IconFolder = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);

const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
);

const IconX = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const IconMoon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const IconSun = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

/* ────────────────────────────────────────────
   SESSION RUNNER (Auto-mode)
   ──────────────────────────────────────────── */

function SessionRunner({ exercises, onComplete, onCancel }) {
  const steps = useMemo(() => buildSessionSteps(exercises), [exercises]);
  const [stepIdx, setStepIdx] = useState(0);
  const [phase, setPhase] = useState("input"); // input | rest | confirm | done
  const [reps, setReps] = useState("");
  const [timer, setTimer] = useState(0);
  const [results, setResults] = useState([]);

  const step = steps[stepIdx] || null;

  const exerciseSetNum = useMemo(() => {
    if (!step) return 0;
    let count = 0;
    for (let i = 0; i <= stepIdx; i++) {
      if (steps[i].exercise === step.exercise) count++;
    }
    return count;
  }, [stepIdx, steps, step]);

  const exerciseTotalSets = useMemo(() => {
    if (!step) return 0;
    return steps.filter((s) => s.exercise === step.exercise).length;
  }, [steps, step]);

  useEffect(() => {
    if (!step || phase !== "input") return;
    const prev = [...results].reverse().find((r) => r.exercise === step.exercise);
    if (prev) {
      const w = prev.weight === "BW" ? "BW" : prev.weight;
      setReps(prev.reps + "*" + w);
    } else {
      const w = step.suggestedWeight === "BW" ? "BW" : step.suggestedWeight;
      setReps(step.suggestedReps + "*" + w);
    }
  }, [stepIdx, phase]);

  useEffect(() => {
    if (phase !== "rest" || timer <= 0) return;
    const id = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) {
          setPhase("input");
          setStepIdx((i) => i + 1);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, timer]);

  function handleDone() {
    // Parse the single input using the same syntax: 12x100, 12*100, 20BW
    const parsed = parseSingleSet(reps.trim());
    let r, w;
    if (parsed) {
      r = parsed.reps;
      w = parsed.weight;
    } else {
      // Fallback: treat as reps-only bodyweight
      r = parseInt(reps) || 0;
      w = "BW";
    }
    const newResults = [...results, { exercise: step.exercise, reps: r, weight: w }];
    setResults(newResults);

    const isLast = stepIdx === steps.length - 1;
    if (isLast) {
      setPhase("done");
      setTimeout(() => onComplete(newResults), 100);
      return;
    }

    if (step.rest) {
      setTimer(step.rest);
      setPhase("rest");
    } else {
      setStepIdx(stepIdx + 1);
      setPhase("input");
    }
  }

  function handleSkipRest() {
    setTimer(0);
    setPhase("input");
    setStepIdx(stepIdx + 1);
  }

  function handleEndRequest() {
    setPhase("confirm");
  }

  function handleConfirmSave() {
    if (results.length > 0) {
      onComplete(results);
    } else {
      onCancel();
    }
  }

  function handleConfirmDiscard() {
    onCancel();
  }

  function handleConfirmBack() {
    // Return to whatever phase we were in before
    if (timer > 0) {
      setPhase("rest");
    } else {
      setPhase("input");
    }
  }

  if (steps.length === 0) {
    return (
      <div style={styles.overlay} onClick={onCancel}>
        <div style={styles.sessionCard} onClick={(e) => e.stopPropagation()}>
          <div style={styles.sessionEmpty}>No exercises with entries to run.</div>
          <button style={styles.sessionSecBtn} onClick={onCancel}>Close</button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div style={styles.overlay}>
        <div style={styles.sessionCard}>
          <div style={styles.sessionDoneIcon}>{"\u2713"}</div>
          <div style={styles.sessionDoneText}>Workout Complete</div>
        </div>
      </div>
    );
  }

  if (phase === "confirm") {
    const completedExercises = [...new Set(results.map((r) => r.exercise))];
    return (
      <div style={styles.overlay}>
        <div style={styles.sessionCard} onClick={(e) => e.stopPropagation()}>
          <div style={{ ...styles.sessionExName, fontSize: 22, marginBottom: 12 }}>End Session?</div>
          {results.length > 0 ? (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
                You've completed {results.length} set{results.length !== 1 ? "s" : ""} across {completedExercises.length} exercise{completedExercises.length !== 1 ? "s" : ""}. Save what you've done?
              </div>
              <button style={styles.modalBtn} onClick={handleConfirmSave}>
                Save Completed Sets
              </button>
              <button style={{ ...styles.sessionSecBtn, marginTop: 12, color: "var(--red)" }} onClick={handleConfirmDiscard}>
                Discard All
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
                No sets completed yet.
              </div>
              <button style={{ ...styles.sessionSecBtn, color: "var(--red)" }} onClick={handleConfirmDiscard}>
                End Session
              </button>
            </>
          )}
          <button style={{ ...styles.sessionSecBtn, marginTop: 8 }} onClick={handleConfirmBack}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (phase === "rest") {
    const progress = step.rest ? (step.rest - timer) / step.rest : 0;
    return (
      <div style={styles.overlay}>
        <div style={styles.sessionCard} onClick={(e) => e.stopPropagation()}>
          <div style={styles.sessionLabel}>REST</div>
          <div style={styles.sessionTimer}>{formatTimer(timer)}</div>
          <div style={styles.sessionProgressTrack}>
            <div style={{ ...styles.sessionProgressBar, width: (progress * 100) + "%" }} />
          </div>
          <div style={styles.sessionNextHint}>
            Next: {step.exercise} — Set {exerciseSetNum + 1}
          </div>
          <button style={styles.sessionSecBtn} onClick={handleSkipRest}>Skip Rest</button>
          <button style={{ ...styles.sessionSecBtn, color: "var(--red)", marginTop: 8 }} onClick={handleEndRequest}>End Session</button>
        </div>
      </div>
    );
  }

  // Input phase
  return (
    <div style={styles.overlay}>
      <div style={styles.sessionCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sessionExName}>{step.exercise}</div>
        <div style={styles.sessionSetInfo}>Set {exerciseSetNum} of {exerciseTotalSets}</div>

        <div style={{ marginBottom: 8 }}>
          <label style={styles.sessionFieldLabel}>Reps * Weight</label>
          <input
            ref={(el) => { if (el) setTimeout(() => el.select(), 50); }}
            style={{
              ...styles.sessionInput,
              borderColor: "var(--accent)",
              marginTop: 6,
            }}
            type="text"
            inputMode="text"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="12*100 or 20BW"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleDone();
              }
            }}
          />
        </div>

        <button
          style={{ ...styles.modalBtn, marginTop: 8 }}
          onClick={handleDone}
        >
          Done
        </button>
        <button style={{ ...styles.sessionSecBtn, marginTop: 10 }} onClick={handleEndRequest}>End Session</button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   SUB-COMPONENTS
   ──────────────────────────────────────────── */

function HelpRow({ code, desc }) {
  return (
    <div style={styles.helpRow}>
      <code style={styles.helpCode}>{code}</code>
      <span style={styles.helpDesc}>{desc}</span>
    </div>
  );
}

/* ── Save Modal ── */
function SaveModal({ onSave, onClose }) {
  const [name, setName] = useState("");

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Save Workout</span>
          <button style={styles.modalClose} onClick={onClose}><IconX /></button>
        </div>
        <input
          style={styles.modalInput}
          placeholder="e.g. Upper Body"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onSave(name.trim()); } }}
        />
        <button
          style={{ ...styles.modalBtn, opacity: name.trim() ? 1 : 0.4 }}
          disabled={!name.trim()}
          onClick={() => onSave(name.trim())}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/* ── Load Drawer ── */
function LoadDrawer({ saved, onLoad, onDelete, onClose, onNew }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={styles.drawerHeader}>
          <span style={styles.drawerTitle}>Saved Workouts</span>
          <button style={styles.modalClose} onClick={onClose}><IconX /></button>
        </div>

        {saved.length === 0 ? (
          <div style={styles.drawerEmpty}>
            No saved workouts yet. Write a workout and hit save!
          </div>
        ) : (
          <div style={styles.drawerList}>
            {saved.map((w, i) => (
              <div key={i} style={styles.drawerItem}>
                <button style={styles.drawerItemBtn} onClick={() => onLoad(w)}>
                  <div style={styles.drawerItemName}>{w.name}</div>
                  <div style={styles.drawerItemMeta}>
                    {w.exerciseCount} exercise{w.exerciseCount !== 1 ? "s" : ""}
                  </div>
                </button>
                <button style={styles.drawerDeleteBtn} onClick={() => onDelete(i)}>
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        )}

        <button style={styles.drawerNewBtn} onClick={onNew}>
          <IconPlus />
          <span>New blank workout</span>
        </button>
      </div>
    </div>
  );
}

/* ── Onboarding Overlay ── */
function OnboardingOverlay({ onDismiss }) {
  const [page, setPage] = useState(0);
  const totalPages = 3;

  const touchStart = React.useRef(null);
  const handleTouchStart = (e) => { touchStart.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStart.current === null) return;
    const diff = touchStart.current - e.changedTouches[0].clientX;
    if (diff > 50 && page < totalPages - 1) setPage(page + 1);
    if (diff < -50 && page > 0) setPage(page - 1);
    touchStart.current = null;
  };

  const sampleLines = page === 0 ? [
    { code: "Squat", annotations: ["Exercise name"] },
    { code: "5*135*3", annotations: ["reps * weight * sets"] },
    { code: "5*185*3", annotations: ["New line = new day"] },
    { code: "", annotations: ["Blank = next exercise"] },
    { code: "Bench Press", annotations: [] },
    { code: "8*135, 8*155, 6*155", annotations: ["Varied sets"] },
    { code: "", annotations: [] },
    { code: "Pull-ups", annotations: [] },
    { code: "10BW", annotations: ["Bodyweight"] },
  ] : page === 1 ? [
    { code: "Run", annotations: ["Exercise name"] },
    { code: "3mi 25:00", annotations: ["distance + time"] },
    { code: "3.2mi 24:30", annotations: ["auto-paces"] },
    { code: "", annotations: [] },
    { code: "Jump Rope", annotations: [] },
    { code: "15:00", annotations: ["Time only"] },
    { code: "12:00 c200", annotations: ["c = calories"] },
    { code: "", annotations: [] },
    { code: "Bike", annotations: [] },
    { code: "10km 30:00 c350", annotations: ["All together"] },
  ] : [
    { code: "Squat r90", annotations: ["r90 = 90s rest"] },
    { code: "5*135*3", annotations: [] },
    { code: "5*185*3 // Felt strong", annotations: ["// = note"] },
    { code: "", annotations: [] },
    { code: "Bench Press", annotations: [] },
    { code: "8*135 r45, 8*155 r60, 6*155", annotations: ["Per-set rest"] },
    { code: "", annotations: [] },
    { code: "Pull-ups", annotations: [] },
    { code: "10BW", annotations: [] },
  ];

  const pageTitle = ["The basics", "Cardio", "Notes & rest timers"][page];
  const pageFooter = ["The basics \u2014 swipe for more", "Cardio tracking", "Notes, rest timers & more"][page];

  return (
    <div style={styles.obOverlay}
      onClick={onDismiss}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -55%)",
        width: "calc(100% - 48px)", maxWidth: 380,
        background: "#1C1917", borderRadius: 16, padding: "24px 20px",
        zIndex: 202, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, color: "#FAFAF9", marginBottom: 16 }}>
          {pageTitle}
        </div>
        <div style={{
          background: "#292524", borderRadius: 10, padding: "14px 16px",
          fontFamily: "'DM Mono', monospace", fontSize: 13, lineHeight: 1.9,
        }}>
          {sampleLines.map((line, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", minHeight: line.code === "" ? 20 : "auto" }}>
              <span style={{ color: "#D6D3D1", flex: 1, whiteSpace: "pre" }}>{line.code}</span>
              {line.annotations.length > 0 && (
                <span style={{
                  color: "#A8A29E", fontSize: 10, fontFamily: "'DM Sans', sans-serif",
                  marginLeft: 8, whiteSpace: "nowrap", lineHeight: "24px",
                }}>
                  {"\u2190 "}{line.annotations.join(", ")}
                </span>
              )}
            </div>
          ))}
        </div>
        {page === 2 && (
          <div style={{
            marginTop: 14, padding: "12px 14px",
            background: "#292524", borderRadius: 10,
            fontSize: 13, color: "#A8A29E", lineHeight: 1.6,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span><span style={{ color: "#D6D3D1" }}>Save</span> — save your workout</span>
            </div>
            <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span><span style={{ color: "#D6D3D1" }}>Load</span> — open saved workouts</span>
            </div>
            <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              <span><span style={{ color: "#D6D3D1" }}>Share</span> — generate a code others can import</span>
            </div>
            <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span><span style={{ color: "#D6D3D1" }}>Import</span> — load a shared workout code</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#2D8C82", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="6" height="6" viewBox="0 0 24 24" fill="#0C0A09" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
              <span><span style={{ color: "#D6D3D1" }}>Auto-mode</span> — guided sets with rest timers</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={styles.obBottom} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              width: page === i ? 20 : 8, height: 8,
              borderRadius: 4,
              background: page === i ? "#FAFAF9" : "rgba(250,250,249,0.3)",
              transition: "all 200ms ease",
            }} />
          ))}
        </div>
        <div style={styles.obFooter}>
          {pageFooter}
        </div>
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          {page > 0 && (
            <button style={{ ...styles.obDismissBtn, background: "transparent", border: "1px solid rgba(250,250,249,0.3)", flex: 1 }} onClick={() => setPage(page - 1)}>Back</button>
          )}
          {page < totalPages - 1 ? (
            <button style={{ ...styles.obDismissBtn, flex: 1 }} onClick={() => setPage(page + 1)}>Next</button>
          ) : (
            <button style={{ ...styles.obDismissBtn, flex: 1 }} onClick={onDismiss}>Got it</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Share Modal ── */
function ShareModal({ text, name, onClose }) {
  const [code, setCode] = useState(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    shareWorkout(text, name).then((c) => {
      if (c) setCode(c);
      else setError(true);
    });
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopying(true);
      setTimeout(() => setCopying(false), 1500);
    } catch {
      // Fallback: select a hidden input
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Share Workout</span>
          <button style={styles.modalClose} onClick={onClose}><IconX /></button>
        </div>
        {error ? (
          <div style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0" }}>
            Something went wrong. Try again.
          </div>
        ) : !code ? (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", textAlign: "center", padding: "16px 0" }}>
            Generating code...
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
              Share this code with someone to let them import your workout.
            </div>
            <div style={styles.shareCodeBox}>
              <span style={styles.shareCodeText}>{code}</span>
            </div>
            <button style={styles.modalBtn} onClick={handleCopy}>
              {copying ? "Copied!" : "Copy Code"}
            </button>
            <button style={{ ...styles.sessionSecBtn, marginTop: 10 }} onClick={() => nativeShare(code, name)}>
              Share via...
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Import Modal ── */
function ImportModal({ onImport, onClose }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleImport = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    const result = await importWorkout(code);
    setLoading(false);
    if (result) {
      onImport(result);
    } else {
      setError("No workout found with that code.");
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Import Workout</span>
          <button style={styles.modalClose} onClick={onClose}><IconX /></button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.5 }}>
          Enter the share code you received.
        </div>
        <input
          style={{ ...styles.modalInput, fontFamily: "'DM Mono', monospace", fontSize: 18, textAlign: "center", letterSpacing: "4px", textTransform: "uppercase" }}
          placeholder="ABC123"
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(null); }}
          autoFocus
          maxLength={6}
          onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }}
        />
        {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10, marginTop: -8 }}>{error}</div>}
        <button
          style={{ ...styles.modalBtn, opacity: code.trim().length >= 4 && !loading ? 1 : 0.4 }}
          disabled={code.trim().length < 4 || loading}
          onClick={handleImport}
        >
          {loading ? "Loading..." : "Import"}
        </button>
      </div>
    </div>
  );
}

/* ── Edit Panel ── */
function EditPanel({ text, setText, onSave, onSaveAs, onNew, currentName }) {
  const [showSaved, setShowSaved] = useState(false);
  const [showSyntax, setShowSyntax] = useState(false);
  const containerRef = React.useRef(null);
  const topRef = React.useRef(null);
  const bottomRef = React.useRef(null);
  const [taHeight, setTaHeight] = useState(300);

  useEffect(() => {
    const recalc = () => {
      if (containerRef.current && topRef.current && bottomRef.current) {
        const containerH = containerRef.current.clientHeight;
        const topH = topRef.current.clientHeight;
        const bottomH = bottomRef.current.clientHeight;
        setTaHeight(Math.max(100, containerH - topH - bottomH - 12));
      }
    };
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [showSyntax, currentName]);

  const handleQuickSave = () => {
    onSave();
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 1500);
  };

  return (
    <div ref={containerRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column" }}>
      <div ref={topRef} style={{ flexShrink: 0, padding: "6px 16px 0" }}>
        {/* Active workout label */}
        {currentName && (
          <div style={styles.activeLabel}>
            Editing: <strong>{currentName}</strong>
          </div>
        )}

        {/* Action bar */}
        <div style={styles.actionBar}>
          {currentName ? (
            <>
              <button style={styles.actionBtn} onClick={handleQuickSave}>
                <IconSave />
                <span>{showSaved ? "Saved!" : "Save"}</span>
              </button>
              <button style={styles.actionBtnSecondary} onClick={onSaveAs}>
                <span>Save As</span>
              </button>
            </>
          ) : (
            <button style={styles.actionBtn} onClick={onSaveAs}>
              <IconSave />
              <span>Save</span>
            </button>
          )}
          <button style={styles.actionBtn} onClick={onNew}>
            <IconPlus />
            <span>New</span>
          </button>
        </div>
      </div>

      <div style={{ padding: "0 16px", flex: 1, minHeight: 0 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"deadlift\n4x135x3\n4x185x3\n\npushups\n20BW\n25BW"}
          style={{ ...styles.textarea, flex: "none", height: taHeight }}
          spellCheck={false}
        />
      </div>

      {/* Syntax tray - pinned to bottom */}
      <div ref={bottomRef} style={{ flexShrink: 0, padding: "0 16px", paddingBottom: showSyntax ? 8 : 4, background: "var(--bg)" }}>
        <button style={styles.syntaxToggle} onClick={() => setShowSyntax(!showSyntax)}>
          <span style={styles.syntaxToggleText}>SYNTAX</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: showSyntax ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms ease" }}>
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>

        {showSyntax && (
          <div style={styles.helpBox}>
            <HelpRow code="4x20" desc="4 reps @ 20 lbs (* or x)" />
            <HelpRow code="4x20x3" desc="3 sets · 4 reps @ 20 lbs" />
            <HelpRow code="10x50, 9x50" desc="varied sets on one line" />
            <HelpRow code="20BW" desc="20 reps bodyweight" />
            <HelpRow code="// note" desc="workout note" />
            <HelpRow code="Squat r90" desc="90s rest between all sets" />
            <HelpRow code="5x100 r60" desc="60s rest after this set" />
            <HelpRow code="text" desc="exercise name" />
            <HelpRow code="blank line" desc="next exercise" />
            <div style={styles.helpMeta}>Each line under an exercise = a new day</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Metric Helpers ── */
function MiniChart({ data, color = "var(--accent)" }) {
  if (!data || data.length < 2) return null;

  const width = 200;
  const height = 48;
  const padY = 6;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padY + (1 - (v - min) / range) * (height - padY * 2);
    return { x, y };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ");
  const areaD = pathD + ` L${width},${height} L0,${height} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <path d={areaD} fill={color} opacity="0.08" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

/* ── View Panel ── */
function ViewPanel({ exercises }) {
  const [grouping, setGrouping] = useState("exercise");
  const [metric, setMetric] = useState("volume");
  const days = useMemo(() => groupByDay(exercises), [exercises]);

  if (exercises.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={styles.empty}>
          <div style={{ fontSize: 28, color: "var(--text-faint)", marginBottom: 8 }}>{"\u2190"}</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-secondary)" }}>No workouts yet</div>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 4, lineHeight: 1.5 }}>
            Write your workout in the editor, then switch here to see it formatted.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={styles.viewControls}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: grouping === "exercise" ? 10 : 0 }}>
          <div style={styles.pillRow}>
            <div style={{ ...styles.pillDot, background: "var(--green)" }} />
            <span style={{ ...styles.pillText, color: "var(--green)" }}>FORMATTED</span>
          </div>
          <div style={styles.groupToggle}>
            <button onClick={() => setGrouping("exercise")} className={grouping === "exercise" ? "grp-active" : "grp-inactive"} style={styles.grpBtn}>By Exercise</button>
            <button onClick={() => setGrouping("day")} className={grouping === "day" ? "grp-active" : "grp-inactive"} style={styles.grpBtn}>By Day</button>
          </div>
        </div>

        {grouping === "exercise" && (
          <div style={styles.metricBar}>
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={metric === m.key ? "metric-active" : "metric-inactive"}
                style={styles.metricBtn}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={styles.viewScroll}>

      {grouping === "exercise" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {exercises.map((ex, ei) => {
            const isCardio = isCardioExercise(ex);
            const metricsToUse = isCardio ? CARDIO_METRICS : METRICS;
            const activeMetricKey = isCardio ? (["distance","time","calories"].includes(metric) ? metric : "distance") : metric;
            const computeFn = isCardio ? computeCardioMetric : computeMetric;

            const chartData = ex.entries.length >= 2
              ? ex.entries.map((entry) => computeFn(entry.sets, activeMetricKey))
              : null;
            const allBW = !isCardio && ex.entries.every((entry) => entry.sets.every((s) => s.weight === "BW"));
            const activeMetric = metricsToUse.find((m) => m.key === activeMetricKey) || metricsToUse[0];
            const latestVal = ex.entries.length > 0
              ? computeFn(ex.entries[ex.entries.length - 1].sets, activeMetricKey)
              : null;
            const prevVal = ex.entries.length > 1
              ? computeFn(ex.entries[ex.entries.length - 2].sets, activeMetricKey)
              : null;
            const diff = latestVal !== null && prevVal !== null ? latestVal - prevVal : null;
            const displayVal = isCardio && activeMetricKey === "time" && latestVal ? formatCardioTime(latestVal) : latestVal;

            return (
              <div key={ei} style={styles.card}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={styles.cardName2}>{ex.name}</div>
                  {ex.rest && <div style={styles.restBadge}>{formatRest(ex.rest)}</div>}
                </div>
                {ex.note && <div style={styles.noteText}>{ex.note}</div>}

                {/* Chart section */}
                {chartData && !(allBW && metric === "maxWeight") && (
                  <div style={styles.chartSection}>
                    <div style={styles.chartHeader}>
                      <div>
                        <div style={styles.chartValue}>
                          {displayVal}{activeMetric.unit ? " " + activeMetric.unit : ""}
                        </div>
                        <div style={styles.chartLabel}>{activeMetric.label}</div>
                      </div>
                      {diff !== null && diff !== 0 && (
                        <div style={{
                          ...styles.chartDiff,
                          color: diff > 0 ? "var(--green)" : "var(--red)",
                        }}>
                          {diff > 0 ? "\u25B2" : "\u25BC"} {Math.abs(diff)}{activeMetric.unit ? " " + activeMetric.unit : ""}
                        </div>
                      )}
                    </div>
                    <MiniChart data={chartData} color={diff !== null && diff < 0 ? "var(--red)" : "var(--accent)"} />
                  </div>
                )}

                {allBW && metric === "maxWeight" && ex.entries.length >= 2 && (
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontStyle: "italic", marginBottom: 12 }}>
                    Bodyweight exercise — try Volume or Total Reps
                  </div>
                )}

                {ex.entries.length === 0 && <div style={{ fontSize: 13, color: "var(--text-tertiary)", fontStyle: "italic" }}>No entries yet</div>}
                {ex.entries.map((entry, di) => {
                const date = getAutoDate(di, ex.entries.length);
                const isLast = di === ex.entries.length - 1;
                return (
                  <div key={di} style={styles.entryRow}>
                    <div style={styles.timeline}>
                      <div style={styles.tlDot} />
                      {!isLast && <div style={styles.tlLine} />}
                    </div>
                    <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14 }}>
                      <div style={styles.entryDate}>{formatDate(date)}</div>
                      {entry.sets.length === 1 ? (
                        <div style={styles.entryDetail}>
                          {formatSet(entry.sets[0])}
                          {entry.sets[0].rest && <span style={styles.restTag}>{formatRest(entry.sets[0].rest)}</span>}
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {entry.sets.map((s, si) => (
                            <div key={si} style={styles.entryDetail}>
                              <span style={styles.setNum}>Set {si + 1}</span> {formatSet(s)}
                              {s.rest && <span style={styles.restTag}>{formatRest(s.rest)}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {entry.note && <div style={styles.entryNote}>{entry.note}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {days.map((day, i) => {
            const date = getAutoDate(day.dayIndex, day.totalDays);
            return (
              <div key={i} style={styles.card}>
                <div style={styles.dayHeader}>
                  <div style={styles.dayDate}>{formatDate(date)}</div>
                  <div style={styles.dayCount}>{day.items.length} exercise{day.items.length !== 1 ? "s" : ""}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {day.items.map((item, j) => (
                    <div key={j} style={styles.dayItem}>
                      <div style={styles.dayExName}>{item.name}</div>
                      {item.sets.length === 1 ? (
                        <div style={styles.dayExDetail}>{formatSet(item.sets[0])}</div>
                      ) : (
                        <div style={styles.dayExDetail}>{formatEntrySummary(item.sets)}</div>
                      )}
                      {item.note && <div style={styles.noteTextSmall}>{item.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────
   MAIN APP
   ──────────────────────────────────────────── */

export default function App() {
  const [text, setText] = useState("");
  const [tab, setTab] = useState("edit");
  const [saved, setSaved] = useState([]);
  const [showSave, setShowSave] = useState(false);
  const [showLoad, setShowLoad] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [currentName, setCurrentName] = useState(null); // tracks active workout name
  const [dark, setDark] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const exercises = useMemo(() => parseWorkouts(text), [text]);

  const hasRunnableExercises = exercises.some((e) => e.entries.length > 0);

  // Load persisted data on mount
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const [workouts, session] = await Promise.all([loadSavedWorkouts(), loadLastSession()]);
      if (cancelled) return;
      setSaved(workouts);
      if (!session) {
        setText(ONBOARDING_TEXT);
        setShowOnboarding(true);
      } else {
        setText(session);
      }
      setLoaded(true);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Auto-save current session
  useEffect(() => {
    if (loaded) persistLastSession(text);
  }, [text, loaded]);

  const handleSave = useCallback(async (name) => {
    const parsed = parseWorkouts(text);
    const uniqueNames = new Set(parsed.map((e) => e.name));
    const exerciseCount = uniqueNames.size;
    const newWorkout = { name, text, exerciseCount, savedAt: Date.now() };
    const existingIndex = saved.findIndex((w) => w.name.toLowerCase() === name.toLowerCase());
    let updated;
    if (existingIndex >= 0) {
      updated = [...saved];
      updated[existingIndex] = newWorkout;
    } else {
      updated = [...saved, newWorkout];
    }
    setSaved(updated);
    setCurrentName(name);
    await persistWorkouts(updated);
    setShowSave(false);
  }, [text, saved]);

  const quickSave = useCallback(async () => {
    if (!currentName) return;
    const parsed = parseWorkouts(text);
    const uniqueNames = new Set(parsed.map((e) => e.name));
    const exerciseCount = uniqueNames.size;
    const newWorkout = { name: currentName, text, exerciseCount, savedAt: Date.now() };
    const existingIndex = saved.findIndex((w) => w.name.toLowerCase() === currentName.toLowerCase());
    let updated;
    if (existingIndex >= 0) {
      updated = [...saved];
      updated[existingIndex] = newWorkout;
    } else {
      updated = [...saved, newWorkout];
    }
    setSaved(updated);
    await persistWorkouts(updated);
  }, [text, saved, currentName]);

  const handleDelete = useCallback(async (index) => {
    const updated = saved.filter((_, i) => i !== index);
    setSaved(updated);
    await persistWorkouts(updated);
  }, [saved]);

  const handleLoad = useCallback((workout) => {
    setText(workout.text);
    setCurrentName(workout.name);
    setShowLoad(false);
  }, []);

  const handleNew = useCallback(() => {
    setText("");
    setCurrentName(null);
    setShowLoad(false);
  }, []);

  const handleImport = useCallback((data) => {
    setText(data.text);
    setCurrentName(data.name || null);
    setShowImport(false);
  }, []);

  const handleSessionComplete = useCallback((results) => {
    setText(buildResultsText(results, text));
    setSessionActive(false);
  }, [text]);

  if (!loaded) {
    return (
      <div style={{ ...styles.app, alignItems: "center", justifyContent: "center" }}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div style={{ color: "var(--text-tertiary)", fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={dark ? "dark" : ""} style={styles.app}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Header */}
      <div style={styles.header} data-header>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={styles.logo}>
            <div style={styles.logoBar} />
            <span style={styles.logoText}>liftscript</span>
          </div>
          <div style={styles.toggle}>
            <button onClick={() => setTab("edit")} className={tab === "edit" ? "tab-active" : "tab-inactive"} style={styles.toggleBtn}>Edit</button>
            <button onClick={() => setTab("view")} className={tab === "view" ? "tab-active" : "tab-inactive"} style={styles.toggleBtn}>View</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, width: "100%" }}>
          <button style={styles.workoutsHeaderBtn} onClick={() => setShowLoad(true)}>
            <IconFolder />
            {saved.length > 0 && <span style={styles.badge}>{saved.length}</span>}
          </button>
          <button style={styles.workoutsHeaderBtn} onClick={() => setShowImport(true)} title="Import">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button style={styles.themeBtn} onClick={() => setShowShare(true)} title="Share">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
          </button>
          <div style={{ flex: 1 }} />
          <button style={styles.themeBtn} onClick={() => setShowOnboarding(true)} title="Help">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </button>
          <button style={styles.themeBtn} onClick={() => setDark(!dark)}>
            {dark ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </div>

      {/* Dots */}
      <div style={styles.dots}>
        <div className={tab === "edit" ? "dot-on" : "dot-off"} />
        <div className={tab === "view" ? "dot-on" : "dot-off"} />
      </div>

      {/* Content */}
      <div style={styles.content}>
        {tab === "edit" ? (
          <EditPanel
            text={text}
            setText={setText}
            onSave={quickSave}
            onSaveAs={() => setShowSave(true)}
            onNew={() => { setText(""); setCurrentName(null); }}
            currentName={currentName}
          />
        ) : (
          <ViewPanel exercises={exercises} />
        )}
      </div>

      {/* Onboarding */}
      {showOnboarding && (
        <OnboardingOverlay onDismiss={() => setShowOnboarding(false)} />
      )}

      {/* Modals */}
      {showSave && <SaveModal onSave={handleSave} onClose={() => setShowSave(false)} />}
      {showLoad && <LoadDrawer saved={saved} onLoad={handleLoad} onDelete={handleDelete} onClose={() => setShowLoad(false)} onNew={handleNew} />}
      {showShare && <ShareModal text={text} name={currentName} onClose={() => setShowShare(false)} />}
      {showImport && <ImportModal onImport={handleImport} onClose={() => setShowImport(false)} />}

      {/* Floating Start Button */}
      {hasRunnableExercises && !sessionActive && (
        <button style={styles.fab} onClick={() => setSessionActive(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      )}

      {/* Session Runner */}
      {sessionActive && (
        <SessionRunner
          exercises={exercises}
          onComplete={handleSessionComplete}
          onCancel={() => setSessionActive(false)}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   CSS
   ──────────────────────────────────────────── */

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&family=Instrument+Serif&display=swap');

  :root {
    --bg: #FAFAF9;
    --surface: #FFFFFF;
    --surface-hover: #F5F5F4;
    --border: #E7E5E4;
    --border-light: #F5F5F4;
    --text: #1C1917;
    --text-secondary: #78716C;
    --text-tertiary: #A8A29E;
    --text-faint: #D6D3D1;
    --accent: #1C1917;
    --accent-inverse: #FAFAF9;
    --green: #16A34A;
    --red: #DC2626;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.03);
    --shadow: 0 1px 3px rgba(0,0,0,0.06);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
    --overlay: rgba(28, 25, 23, 0.3);
  }

  .dark {
    --bg: #0C0A09;
    --surface: #1C1917;
    --surface-hover: #292524;
    --border: #292524;
    --border-light: #1C1917;
    --text: #FAFAF9;
    --text-secondary: #A8A29E;
    --text-tertiary: #78716C;
    --text-faint: #44403C;
    --accent: #FAFAF9;
    --accent-inverse: #0C0A09;
    --green: #4ADE80;
    --red: #F87171;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.2);
    --shadow: 0 1px 3px rgba(0,0,0,0.3);
    --shadow-lg: 0 8px 30px rgba(0,0,0,0.4);
    --overlay: rgba(0, 0, 0, 0.5);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #root { height: 100%; }
  body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  textarea::placeholder { color: var(--text-faint); }
  textarea { -webkit-overflow-scrolling: touch; overflow-y: auto !important; }
  textarea:focus { border-color: var(--text-tertiary) !important; outline: none; }
  input:focus { outline: none; border-color: var(--text) !important; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  .tab-active { background: var(--surface) !important; color: var(--text) !important; box-shadow: var(--shadow); }
  .tab-inactive { background: transparent !important; color: var(--text-tertiary) !important; }
  .tab-inactive:hover { color: var(--text-secondary) !important; }

  .dot-on { width: 20px; height: 6px; border-radius: 3px; background: var(--accent); transition: all 250ms ease; }
  .dot-off { width: 6px; height: 6px; border-radius: 50%; background: var(--border); transition: all 250ms ease; }

  .grp-active { background: var(--accent) !important; color: var(--accent-inverse) !important; }
  .grp-inactive { background: transparent !important; color: var(--text-tertiary) !important; }
  .grp-inactive:hover { color: var(--text-secondary) !important; }

  .metric-active { background: var(--accent) !important; color: var(--accent-inverse) !important; }
  .metric-inactive { background: transparent !important; color: var(--text-tertiary) !important; }
  .metric-inactive:hover { color: var(--text-secondary) !important; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes slideDrawer { from { transform: translateY(100%); } to { transform: translateY(0); } }
`;

/* ────────────────────────────────────────────
   STYLES
   ──────────────────────────────────────────── */

const styles = {
  app: { maxWidth: 520, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" },
  header: { padding: "14px 16px 0", display: "flex", flexDirection: "column", alignItems: "stretch", flexShrink: 0 },
  logo: { display: "flex", alignItems: "center", gap: 10 },
  workoutsHeaderBtn: {
    display: "flex", alignItems: "center", gap: 4,
    border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8,
    padding: "6px 8px", cursor: "pointer", color: "var(--text-secondary)",
    transition: "all 150ms ease", boxShadow: "var(--shadow-sm)",
  },
  logoBar: { width: 8, height: 22, background: "var(--accent)", borderRadius: 2 },
  logoText: { fontFamily: "'Instrument Serif', serif", fontSize: 26, letterSpacing: "-0.5px", color: "var(--text)" },
  themeBtn: {
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8,
    padding: 6, cursor: "pointer", color: "var(--text-secondary)",
    transition: "all 150ms ease", boxShadow: "var(--shadow-sm)",
  },
  toggle: { display: "flex", gap: 2, background: "var(--surface-hover)", borderRadius: 8, padding: 3 },
  toggleBtn: { border: "none", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, padding: "6px 16px", borderRadius: 6, cursor: "pointer", transition: "all 150ms ease" },
  dots: { display: "flex", justifyContent: "center", gap: 6, padding: "14px 0 8px", flexShrink: 0 },
  content: { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" },
  panelInner: { padding: "6px 16px 0", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" },

  // View controls (sticky top)
  viewControls: {
    flexShrink: 0,
    padding: "6px 16px 8px",
    background: "var(--bg)",
  },
  viewScroll: {
    flex: 1,
    overflow: "auto",
    padding: "0 16px 40px",
  },

  // Action bar
  actionBar: { display: "flex", gap: 8, marginBottom: 12 },
  actionBtn: {
    display: "flex", alignItems: "center", gap: 6,
    border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 8,
    padding: "8px 14px", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500,
    color: "var(--text)", cursor: "pointer", transition: "all 150ms ease",
    boxShadow: "var(--shadow-sm)",
  },
  actionBtnSecondary: {
    display: "flex", alignItems: "center", gap: 6,
    border: "1px solid var(--border)", background: "transparent", borderRadius: 8,
    padding: "8px 14px", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500,
    color: "var(--text-secondary)", cursor: "pointer", transition: "all 150ms ease",
  },
  activeLabel: {
    fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "var(--text-secondary)",
    marginBottom: 10, padding: "6px 0",
  },
  badge: {
    background: "var(--accent)", color: "var(--accent-inverse)", fontSize: 10, fontWeight: 600,
    padding: "1px 6px", borderRadius: 10, marginLeft: 2,
  },

  // Pills
  pillRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 0 },
  pillDot: { width: 7, height: 7, borderRadius: "50%" },
  pillText: { fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: "1.5px" },

  // Group toggle
  groupToggle: { display: "flex", gap: 2, background: "var(--surface-hover)", borderRadius: 6, padding: 2 },
  grpBtn: { border: "none", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 500, padding: "5px 10px", borderRadius: 5, cursor: "pointer", transition: "all 150ms ease" },

  // Metric toggle
  metricBar: { display: "flex", gap: 2, background: "var(--surface-hover)", borderRadius: 6, padding: 2, marginBottom: 14 },
  metricBtn: { flex: 1, border: "none", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 500, padding: "6px 8px", borderRadius: 5, cursor: "pointer", transition: "all 150ms ease", textAlign: "center" },

  // Chart
  chartSection: { marginBottom: 14, padding: "12px 14px", background: "var(--surface-hover)", borderRadius: 10, border: "1px solid var(--border-light)" },
  chartHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  chartValue: { fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 500, color: "var(--text)", letterSpacing: "-0.5px" },
  chartLabel: { fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--text-tertiary)", letterSpacing: "0.5px", marginTop: 1 },
  chartDiff: { fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 500, marginTop: 2 },

  // Editor
  textarea: { width: "100%", flex: 1, minHeight: 0, overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", fontFamily: "'DM Mono', monospace", fontSize: 14, lineHeight: 1.75, color: "var(--text)", background: "var(--surface)", resize: "none", boxShadow: "var(--shadow-sm)" },
  syntaxToggle: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    width: "100%", marginTop: 10, padding: "10px 0",
    border: "none", background: "transparent",
    cursor: "pointer", color: "var(--text-tertiary)",
  },
  syntaxToggleText: {
    fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
    color: "var(--text-tertiary)", letterSpacing: "1.2px",
  },
  helpBox: { padding: "10px 16px 14px", background: "var(--surface-hover)", borderRadius: 10 },
  helpTitle: { fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500, color: "var(--text-tertiary)", letterSpacing: "1.2px", marginBottom: 10 },
  helpRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 5 },
  helpCode: { fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--text)", background: "var(--surface)", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", minWidth: 80, textAlign: "center", display: "inline-block" },
  helpDesc: { fontSize: 12, color: "var(--text-secondary)" },
  helpMeta: { marginTop: 10, fontSize: 11, color: "var(--text-tertiary)", fontStyle: "italic" },

  // Empty
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", textAlign: "center" },

  // Cards
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", boxShadow: "var(--shadow-sm)" },
  cardName: { fontFamily: "'Instrument Serif', serif", fontSize: 20, marginBottom: 16, letterSpacing: "-0.3px", color: "var(--text)" },
  cardName2: { fontFamily: "'Instrument Serif', serif", fontSize: 20, letterSpacing: "-0.3px", color: "var(--text)" },

  // Rest
  restBadge: {
    fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
    color: "var(--text-tertiary)", background: "var(--surface-hover)",
    border: "1px solid var(--border)", borderRadius: 5,
    padding: "3px 8px", letterSpacing: "0.3px", flexShrink: 0,
  },
  restTag: {
    fontFamily: "'DM Mono', monospace", fontSize: 10,
    color: "var(--text-tertiary)", marginLeft: 8,
  },

  // Timeline
  entryRow: { display: "flex", gap: 14 },
  timeline: { display: "flex", flexDirection: "column", alignItems: "center", width: 12, flexShrink: 0 },
  tlDot: { width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", marginTop: 5, flexShrink: 0 },
  tlLine: { width: 1.5, flex: 1, background: "var(--border)", marginTop: 4, marginBottom: 4 },
  entryDate: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-tertiary)", marginBottom: 3, letterSpacing: "0.3px" },
  entryDetail: { fontSize: 14, fontWeight: 500, color: "var(--text)" },
  setNum: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-tertiary)", marginRight: 6 },

  // Day view
  dayHeader: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 },
  dayDate: { fontFamily: "'Instrument Serif', serif", fontSize: 20, letterSpacing: "-0.3px", color: "var(--text)" },
  dayCount: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.3px" },
  dayItem: { padding: "10px 14px", background: "var(--surface-hover)", borderRadius: 8, border: "1px solid var(--border-light)" },
  dayExName: { fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 },
  dayExDetail: { fontSize: 13, color: "var(--text-secondary)" },

  // Notes
  noteText: { fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic", marginTop: 2, marginBottom: 12, lineHeight: 1.4 },
  entryNote: { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic", marginTop: 4, lineHeight: 1.4 },
  noteTextSmall: { fontSize: 12, color: "var(--text-tertiary)", fontStyle: "italic", marginTop: 3 },

  // Onboarding
  obOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.4)",
    zIndex: 200, animation: "fadeIn 200ms ease",
  },
  obBubble: {
    position: "fixed",
    background: "#1C1917", borderRadius: 8,
    padding: "6px 12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    zIndex: 201,
  },
  obLabel: {
    fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 500,
    color: "#FAFAF9",
  },
  obDetail: {
    fontFamily: "'DM Sans', sans-serif", fontSize: 10,
    color: "#A8A29E", marginTop: 1,
  },
  obBottom: {
    position: "fixed", bottom: 0, left: 0, right: 0,
    padding: "20px 24px 32px",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
    zIndex: 201,
  },
  obFooter: {
    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500,
    color: "#FAFAF9", textAlign: "center",
  },
  obDismissBtn: {
    border: "none", borderRadius: 10, padding: "12px 40px",
    background: "#FAFAF9", color: "#1C1917",
    fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500,
    cursor: "pointer",
  },
  obHeaderLabel: {
    background: "#1C1917", borderRadius: 8,
    padding: "6px 12px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    zIndex: 201,
  },

  // Overlay
  overlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "var(--overlay)", backdropFilter: "blur(4px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 100, animation: "fadeIn 150ms ease",
  },

  // Save Modal
  modal: {
    background: "var(--surface)", borderRadius: 16, padding: 24, width: "calc(100% - 48px)", maxWidth: 380,
    boxShadow: "var(--shadow-lg)", animation: "slideUp 200ms ease",
  },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  modalTitle: { fontFamily: "'Instrument Serif', serif", fontSize: 20, color: "var(--text)" },
  modalClose: { border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", padding: 4, display: "flex" },
  modalInput: {
    width: "100%", padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 10,
    fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "var(--text)", background: "var(--bg)", marginBottom: 14,
    transition: "border-color 150ms ease",
  },
  modalBtn: {
    width: "100%", padding: "12px 0", border: "none", borderRadius: 10,
    background: "var(--accent)", color: "var(--accent-inverse)", fontFamily: "'DM Sans', sans-serif",
    fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "opacity 150ms ease",
  },
  shareCodeBox: {
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "18px 20px", marginBottom: 14,
    background: "var(--bg)", border: "2px dashed var(--border)",
    borderRadius: 12,
  },
  shareCodeText: {
    fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 500,
    color: "var(--text)", letterSpacing: "6px",
  },

  // Load Drawer
  drawer: {
    position: "fixed", bottom: 0, left: 0, right: 0,
    background: "var(--surface)", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: "20px 22px 28px", maxHeight: "70vh", overflow: "auto",
    boxShadow: "0 -4px 20px rgba(0,0,0,0.1)", animation: "slideDrawer 250ms ease",
  },
  drawerHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  drawerTitle: { fontFamily: "'Instrument Serif', serif", fontSize: 20, color: "var(--text)" },
  drawerEmpty: { padding: "30px 0", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 },
  drawerList: { display: "flex", flexDirection: "column", gap: 6 },
  drawerItem: {
    display: "flex", alignItems: "center", gap: 8,
    border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
  },
  drawerItemBtn: {
    flex: 1, display: "flex", flexDirection: "column", gap: 2,
    padding: "14px 16px", border: "none", background: "transparent",
    textAlign: "left", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
  },
  drawerItemName: { fontSize: 14, fontWeight: 500, color: "var(--text)" },
  drawerItemMeta: { fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--text-tertiary)" },
  drawerDeleteBtn: {
    border: "none", background: "transparent", color: "var(--text-faint)",
    cursor: "pointer", padding: "14px 16px", display: "flex", alignItems: "center",
    transition: "color 150ms ease",
  },
  drawerNewBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    width: "100%", padding: "14px 0", marginTop: 14,
    border: "1px dashed var(--text-faint)", borderRadius: 10, background: "transparent",
    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500,
    color: "var(--text-secondary)", cursor: "pointer",
  },

  // Floating Action Button
  fab: {
    position: "fixed", bottom: "calc(28px + env(safe-area-inset-bottom))", right: 20,
    width: 56, height: 56, borderRadius: "50%",
    background: "#2D8C82", color: "#0C0A09",
    border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
    transition: "transform 150ms ease, box-shadow 150ms ease",
    zIndex: 50, paddingLeft: 3,
  },

  // Session Runner
  sessionCard: {
    background: "var(--surface)", borderRadius: 20, padding: "32px 28px",
    width: "calc(100% - 48px)", maxWidth: 380,
    boxShadow: "var(--shadow-lg)", animation: "slideUp 250ms ease",
    textAlign: "center",
  },
  sessionExName: {
    fontFamily: "'Instrument Serif', serif", fontSize: 28, color: "var(--text)",
    marginBottom: 4, letterSpacing: "-0.5px",
  },
  sessionSetInfo: {
    fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--text-tertiary)",
    letterSpacing: "0.5px", marginBottom: 24,
  },
  sessionFields: {
    display: "flex", gap: 12, marginBottom: 8,
  },
  sessionFieldGroup: {
    flex: 1, display: "flex", flexDirection: "column", gap: 6,
  },
  sessionFieldLabel: {
    fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
    color: "var(--text-tertiary)", letterSpacing: "1px", textTransform: "uppercase",
    textAlign: "left",
  },
  sessionInput: {
    width: "100%", padding: "14px 16px",
    border: "2px solid var(--border)", borderRadius: 12,
    fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 500,
    color: "var(--text)", background: "var(--bg)",
    textAlign: "center", transition: "border-color 150ms ease",
    outline: "none",
  },
  sessionSecBtn: {
    border: "none", background: "transparent",
    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 500,
    color: "var(--text-tertiary)", cursor: "pointer",
    padding: "8px 16px",
  },
  sessionLabel: {
    fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 500,
    color: "var(--text-tertiary)", letterSpacing: "2px", marginBottom: 12,
  },
  sessionTimer: {
    fontFamily: "'DM Mono', monospace", fontSize: 56, fontWeight: 500,
    color: "var(--text)", letterSpacing: "-2px", marginBottom: 16,
  },
  sessionProgressTrack: {
    width: "100%", height: 4, borderRadius: 2,
    background: "var(--border)", marginBottom: 20, overflow: "hidden",
  },
  sessionProgressBar: {
    height: "100%", borderRadius: 2, background: "var(--accent)",
    transition: "width 1s linear",
  },
  sessionNextHint: {
    fontFamily: "'DM Sans', sans-serif", fontSize: 13,
    color: "var(--text-secondary)", marginBottom: 16,
  },
  sessionEmpty: {
    fontSize: 14, color: "var(--text-tertiary)", padding: "20px 0",
  },
  sessionDoneIcon: {
    fontSize: 48, color: "var(--green)", marginBottom: 12,
  },
  sessionDoneText: {
    fontFamily: "'Instrument Serif', serif", fontSize: 24, color: "var(--text)",
  },
};
