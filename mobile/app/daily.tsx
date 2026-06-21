import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useColorScheme,
  TextInput,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Colors } from "../src/styles/theme";
import { loadQuizzes, loadProgress, loadDailyState, saveDailyState } from "../src/services/storage";
import type { Quiz, DailyState } from "../src/types/quiz";

export default function DailyScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [dailyState, setDailyState] = useState<DailyState | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const [totalToday, setTotalToday] = useState(0);
  const [extraCount, setExtraCount] = useState("10");

  const today = new Date().toISOString().slice(0, 10);

  const refresh = useCallback(async () => {
    const q = await loadQuizzes();
    setQuizzes(q);
    const ds = await loadDailyState();
    setDailyState(ds);

    const progress = await loadProgress();
    let questionsToday = 0;
    let totalQuestions = 0;

    for (const quiz of q) {
      if (!quiz.exam_date) continue;
      const daysLeft = Math.ceil((new Date(quiz.exam_date).getTime() - Date.now()) / 86400000);
      if (daysLeft < 0) continue;

      let notMastered = 0;
      for (const question of quiz.questions) {
        const box = progress[question.id]?.box ?? 1;
        if (box < 5) notMastered++;
      }
      totalQuestions += quiz.questions.length;
      const daily = Math.max(1, Math.ceil(notMastered / Math.max(1, daysLeft)));
      questionsToday += daily;
    }

    setTotalToday(questionsToday);
    setTodayCount(ds?.date === today ? (ds.completed?.length ?? 0) : 0);
  }, [today]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const startDaily = () => {
    if (quizzes.length === 0) return;
    const quizzesWithExam = quizzes.filter((q) => q.exam_date);
    const target = quizzesWithExam.length > 0 ? quizzesWithExam[0] : quizzes[0];

    if (!dailyState || dailyState.date !== today) {
      saveDailyState({ date: today, completed: [], wrong: [], extra_done: false });
    }

    router.push({
      pathname: "/quiz/play",
      params: { quizId: target.id, mode: "weak", count: String(totalToday) },
    });
  };

  const startExtra = () => {
    if (quizzes.length === 0) return;
    const n = parseInt(extraCount) || 10;
    router.push({
      pathname: "/quiz/play",
      params: { quizId: quizzes[0].id, mode: "weak", count: String(n) },
    });
  };

  const completed = todayCount >= totalToday && totalToday > 0;

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={[styles.title, { color: c.text }]}>Tägliches Lernen</Text>
        <Text style={[styles.sub, { color: c.textLight }]}>
          Dein persönlicher Lernplan für heute
        </Text>

        {totalToday === 0 ? (
          <Text style={[styles.emptyText, { color: c.textLight }]}>
            Erstelle Quizzes mit Klausurterminen, um einen täglichen Lernplan zu bekommen.
          </Text>
        ) : (
          <>
            <View style={styles.progressSection}>
              <Text style={[styles.progressLabel, { color: c.text }]}>
                {todayCount} / {totalToday} Fragen
              </Text>
              <View style={[styles.progressBg, { backgroundColor: c.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: completed ? c.success : c.primary,
                      width: `${Math.min(100, (todayCount / Math.max(totalToday, 1)) * 100)}%`,
                    },
                  ]}
                />
              </View>
            </View>

            {completed ? (
              <View style={[styles.doneCard, { backgroundColor: c.success + "20" }]}>
                <Text style={[styles.doneText, { color: c.success }]}>
                  Tagespensum geschafft!
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.btn, { backgroundColor: c.primary }]}
              onPress={startDaily}
            >
              <Text style={styles.btnText}>
                {completed ? "Nochmal lernen" : "Jetzt lernen"}
              </Text>
            </TouchableOpacity>

            {completed && (
              <View style={styles.extraSection}>
                <Text style={[styles.extraLabel, { color: c.text }]}>Zusätzlich lernen:</Text>
                <View style={styles.extraRow}>
                  <TextInput
                    style={[styles.extraInput, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
                    value={extraCount}
                    onChangeText={setExtraCount}
                    keyboardType="number-pad"
                  />
                  <TouchableOpacity
                    style={[styles.btnSmall, { backgroundColor: c.primaryLight }]}
                    onPress={startExtra}
                  >
                    <Text style={styles.btnSmallText}>Start</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </View>

      {/* Quiz exam overview */}
      {quizzes.filter((q) => q.exam_date).map((quiz) => {
        const daysLeft = Math.ceil((new Date(quiz.exam_date).getTime() - Date.now()) / 86400000);
        return (
          <View key={quiz.id} style={[styles.examCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.examName, { color: c.text }]}>{quiz.name}</Text>
            <Text style={[styles.examDate, { color: daysLeft <= 7 ? c.danger : c.textLight }]}>
              {daysLeft > 0 ? `Klausur in ${daysLeft} Tagen` : daysLeft === 0 ? "Heute!" : "Vergangen"}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { margin: 16, padding: 20, borderRadius: 12 },
  title: { fontSize: 22, fontWeight: "bold" },
  sub: { fontSize: 14, marginTop: 4, marginBottom: 16 },
  emptyText: { fontSize: 14, textAlign: "center", marginVertical: 20, lineHeight: 22 },
  progressSection: { marginBottom: 16 },
  progressLabel: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  progressBg: { height: 8, borderRadius: 4 },
  progressFill: { height: 8, borderRadius: 4 },
  doneCard: { padding: 12, borderRadius: 8, marginBottom: 12, alignItems: "center" },
  doneText: { fontSize: 16, fontWeight: "bold" },
  btn: { paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  extraSection: { marginTop: 16 },
  extraLabel: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  extraRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  extraInput: { borderWidth: 1, borderRadius: 8, padding: 10, width: 80, fontSize: 15, textAlign: "center" },
  btnSmall: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  btnSmallText: { color: "#fff", fontWeight: "600" },
  examCard: { marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 10, borderWidth: 1 },
  examName: { fontSize: 15, fontWeight: "600" },
  examDate: { fontSize: 13, marginTop: 3 },
});
