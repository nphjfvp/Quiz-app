import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors } from "../../src/styles/theme";
import { loadQuizzes, loadProgress, saveProgress } from "../../src/services/storage";
import { checkAnswer, updateProgress } from "../../src/services/quiz-engine";
import { getHint, getExplanation } from "../../src/services/ai";
import type { Quiz, Question, AnswerResult } from "../../src/types/quiz";

export default function PlayScreen() {
  const { quizId, mode, count } = useLocalSearchParams<{ quizId: string; mode: string; count: string }>();
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const router = useRouter();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerResult>>({});
  const [selectedOption, setSelectedOption] = useState(-1);
  const [selectedMultiple, setSelectedMultiple] = useState<Set<number>>(new Set());
  const [textAnswer, setTextAnswer] = useState("");
  const [blankAnswers, setBlankAnswers] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [lastResult, setLastResult] = useState<AnswerResult | null>(null);
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const progressRef = useRef<Record<string, any>>({});

  useEffect(() => {
    (async () => {
      const quizzes = await loadQuizzes();
      const quiz = quizzes.find((q) => q.id === quizId);
      if (!quiz) return;
      progressRef.current = await loadProgress();

      let qs = [...quiz.questions];
      if (mode === "weak") {
        qs.sort((a, b) => {
          const ba = progressRef.current[a.id]?.box ?? 1;
          const bb = progressRef.current[b.id]?.box ?? 1;
          return ba - bb;
        });
      } else if (mode !== "exam") {
        qs.sort(() => Math.random() - 0.5);
      }
      const n = parseInt(count ?? "0") || qs.length;
      setQuestions(qs.slice(0, n));
    })();
  }, [quizId, mode, count]);

  const q = questions[currentIdx];
  const total = questions.length;
  const isFinished = currentIdx >= total;

  const resetAnswerState = () => {
    setSelectedOption(-1);
    setSelectedMultiple(new Set());
    setTextAnswer("");
    setBlankAnswers([]);
    setSubmitted(false);
    setLastResult(null);
    setAiResponse("");
  };

  const getUserInput = () => {
    if (!q) return null;
    switch (q.question_type) {
      case "single_choice": return selectedOption;
      case "multiple_choice": return [...selectedMultiple];
      case "free_text": case "math_formula": return textAnswer;
      case "fill_blank": return blankAnswers;
      default: return textAnswer;
    }
  };

  const handleSubmit = async () => {
    if (!q) return;
    const input = getUserInput();
    const result = checkAnswer(q, input);
    setLastResult(result);
    setSubmitted(true);
    setAnswers((prev) => ({ ...prev, [q.id]: result }));
    progressRef.current = updateProgress(progressRef.current, q.id, result.is_correct);
    await saveProgress(progressRef.current);

    if (mode === "exam") {
      goNext();
    }
  };

  const goNext = () => {
    resetAnswerState();
    if (currentIdx + 1 >= total) {
      setCurrentIdx(total);
    } else {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const requestHint = async () => {
    if (!q || aiLoading) return;
    setAiLoading(true);
    const hint = await getHint(q.text, q.question_type);
    setAiResponse(hint ?? "Keine Antwort erhalten.");
    setAiLoading(false);
  };

  if (questions.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <Text style={[styles.loading, { color: c.textLight }]}>Laden...</Text>
      </View>
    );
  }

  if (isFinished) {
    const totalScore = Object.values(answers).reduce((s, a) => s + a.score, 0);
    const maxScore = questions.reduce((s, q) => s + q.points, 0);
    const correct = Object.values(answers).filter((a) => a.is_correct).length;
    const pct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

    return (
      <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={[styles.resultsCard, { backgroundColor: c.card }]}>
          <Text style={[styles.resultsTitle, { color: c.text }]}>Ergebnis</Text>
          <Text style={[styles.resultsPct, { color: pct >= 50 ? c.success : c.danger }]}>
            {pct}%
          </Text>
          <Text style={[styles.resultsDetail, { color: c.textLight }]}>
            {correct}/{total} richtig · {totalScore}/{maxScore} Punkte
          </Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: c.primary, marginTop: 20 }]}
            onPress={() => router.back()}
          >
            <Text style={styles.btnText}>Zurück</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
      {/* Progress */}
      <View style={styles.progressRow}>
        <View style={[styles.progressBg, { backgroundColor: c.border }]}>
          <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${((currentIdx) / total) * 100}%` }]} />
        </View>
        <Text style={[styles.progressText, { color: c.textLight }]}>
          {currentIdx + 1}/{total}
        </Text>
      </View>

      {/* Question */}
      <View style={[styles.questionCard, { backgroundColor: c.card }]}>
        {q.title ? <Text style={[styles.qTitle, { color: c.text }]}>{q.title}</Text> : null}
        <Text style={[styles.qText, { color: c.text }]}>{q.text}</Text>
      </View>

      {/* Answer area */}
      <View style={[styles.answerCard, { backgroundColor: c.card }]}>
        {q.question_type === "single_choice" && q.options.map((opt, i) => (
          <TouchableOpacity
            key={i}
            disabled={submitted}
            style={[
              styles.optionBtn,
              { borderColor: selectedOption === i ? c.primary : c.border },
              submitted && opt.is_correct && { borderColor: c.success, backgroundColor: c.success + "20" },
              submitted && selectedOption === i && !opt.is_correct && { borderColor: c.danger, backgroundColor: c.danger + "20" },
            ]}
            onPress={() => setSelectedOption(i)}
          >
            <View style={[styles.radio, selectedOption === i && { backgroundColor: c.primary }]} />
            <Text style={[styles.optionText, { color: c.text }]}>{opt.text}</Text>
          </TouchableOpacity>
        ))}

        {q.question_type === "multiple_choice" && q.options.map((opt, i) => (
          <TouchableOpacity
            key={i}
            disabled={submitted}
            style={[
              styles.optionBtn,
              { borderColor: selectedMultiple.has(i) ? c.primary : c.border },
              submitted && opt.is_correct && { borderColor: c.success, backgroundColor: c.success + "20" },
              submitted && selectedMultiple.has(i) && !opt.is_correct && { borderColor: c.danger, backgroundColor: c.danger + "20" },
            ]}
            onPress={() => {
              const next = new Set(selectedMultiple);
              next.has(i) ? next.delete(i) : next.add(i);
              setSelectedMultiple(next);
            }}
          >
            <View style={[styles.checkbox, selectedMultiple.has(i) && { backgroundColor: c.primary }]} />
            <Text style={[styles.optionText, { color: c.text }]}>{opt.text}</Text>
          </TouchableOpacity>
        ))}

        {(q.question_type === "free_text" || q.question_type === "math_formula") && (
          <TextInput
            style={[styles.textInput, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
            value={textAnswer}
            onChangeText={setTextAnswer}
            editable={!submitted}
            placeholder={q.question_type === "math_formula" ? "Formel oder Zahl eingeben..." : "Deine Antwort..."}
            placeholderTextColor={c.textLight}
          />
        )}

        {q.question_type === "fill_blank" && q.blanks.map((_, i) => (
          <View key={i} style={styles.blankRow}>
            <Text style={[styles.blankLabel, { color: c.textLight }]}>Lücke {i + 1}:</Text>
            <TextInput
              style={[styles.blankInput, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
              value={blankAnswers[i] ?? ""}
              onChangeText={(t) => {
                const next = [...blankAnswers];
                next[i] = t;
                setBlankAnswers(next);
              }}
              editable={!submitted}
              placeholderTextColor={c.textLight}
            />
          </View>
        ))}

        {q.question_type === "drag_drop" && (
          <Text style={[styles.ddHint, { color: c.textLight }]}>
            Drag & Drop wird in der nächsten Version unterstützt. Tippe die Zuordnung als Text ein.
          </Text>
        )}
      </View>

      {/* Feedback */}
      {submitted && lastResult && mode !== "exam" && (
        <View style={[styles.feedback, { backgroundColor: lastResult.is_correct ? c.success : c.danger }]}>
          <Text style={styles.feedbackTitle}>
            {lastResult.is_correct ? "Richtig!" : "Falsch!"}
          </Text>
          <Text style={styles.feedbackScore}>
            {lastResult.score}/{lastResult.max_score} Punkte
          </Text>
          {!lastResult.is_correct && (
            <Text style={styles.feedbackCorrect}>
              Richtige Antwort: {lastResult.correct_answer}
            </Text>
          )}
          {q.explanation ? (
            <Text style={styles.feedbackExpl}>{q.explanation}</Text>
          ) : null}
        </View>
      )}

      {/* AI response */}
      {aiResponse ? (
        <View style={[styles.aiCard, { backgroundColor: c.card, borderColor: c.primaryLight }]}>
          <Text style={[styles.aiTitle, { color: c.primary }]}>KI-Hilfe</Text>
          <Text style={[styles.aiText, { color: c.text }]}>{aiResponse}</Text>
        </View>
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        {!submitted ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: c.primary }]}
            onPress={handleSubmit}
          >
            <Text style={styles.btnText}>
              {mode === "exam" ? "Weiter" : "Antwort prüfen"}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: c.success }]}
            onPress={goNext}
          >
            <Text style={styles.btnText}>Nächste Frage</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.btnSmall, { backgroundColor: c.primaryLight }]}
          onPress={requestHint}
          disabled={aiLoading}
        >
          <Text style={styles.btnSmallText}>{aiLoading ? "..." : "Hinweis"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnSmall, { backgroundColor: c.danger }]}
          onPress={() => {
            setCurrentIdx(total);
          }}
        >
          <Text style={styles.btnSmallText}>Auswertung</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { fontSize: 16, textAlign: "center", marginTop: 40 },
  progressRow: { flexDirection: "row", alignItems: "center", padding: 16, gap: 10 },
  progressBg: { flex: 1, height: 6, borderRadius: 3 },
  progressFill: { height: 6, borderRadius: 3 },
  progressText: { fontSize: 13, fontWeight: "600" },
  questionCard: { margin: 16, marginTop: 0, padding: 18, borderRadius: 12 },
  qTitle: { fontSize: 17, fontWeight: "bold", marginBottom: 6 },
  qText: { fontSize: 15, lineHeight: 22 },
  answerCard: { marginHorizontal: 16, padding: 16, borderRadius: 12 },
  optionBtn: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 10, borderWidth: 1.5, marginBottom: 8 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#ccc", marginRight: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: "#ccc", marginRight: 12 },
  optionText: { fontSize: 15, flex: 1 },
  textInput: { borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 15, marginTop: 4 },
  blankRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  blankLabel: { fontSize: 13, marginRight: 8, width: 65 },
  blankInput: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
  ddHint: { fontSize: 14, fontStyle: "italic", textAlign: "center", padding: 20 },
  feedback: { marginHorizontal: 16, marginTop: 10, padding: 16, borderRadius: 12 },
  feedbackTitle: { fontSize: 18, fontWeight: "bold", color: "#fff" },
  feedbackScore: { fontSize: 14, color: "rgba(255,255,255,0.9)", marginTop: 4 },
  feedbackCorrect: { fontSize: 14, color: "rgba(255,255,255,0.9)", marginTop: 6 },
  feedbackExpl: { fontSize: 13, color: "rgba(255,255,255,0.85)", marginTop: 8, fontStyle: "italic" },
  aiCard: { marginHorizontal: 16, marginTop: 10, padding: 16, borderRadius: 12, borderWidth: 1 },
  aiTitle: { fontSize: 14, fontWeight: "bold", marginBottom: 6 },
  aiText: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", justifyContent: "center", gap: 8, padding: 16, flexWrap: "wrap" },
  btn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  btnSmall: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnSmallText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  resultsCard: { margin: 20, padding: 30, borderRadius: 16, alignItems: "center" as const },
  resultsTitle: { fontSize: 24, fontWeight: "bold" as const, marginBottom: 10 },
  resultsPct: { fontSize: 60, fontWeight: "bold" as const },
  resultsDetail: { fontSize: 16, marginTop: 8 },
});
