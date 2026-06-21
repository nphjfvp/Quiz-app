import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useColorScheme,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors } from "../../src/styles/theme";
import { loadQuizzes, loadProgress } from "../../src/services/storage";
import type { Quiz, Question } from "../../src/types/quiz";

export default function QuizDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);

  useEffect(() => {
    loadQuizzes().then((quizzes) => {
      const found = quizzes.find((q) => q.id === id);
      setQuiz(found ?? null);
    });
  }, [id]);

  if (!quiz) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <Text style={[styles.loading, { color: c.textLight }]}>Laden...</Text>
      </View>
    );
  }

  const startQuiz = (mode: string, count?: number) => {
    router.push({
      pathname: "/quiz/play",
      params: { quizId: quiz.id, mode, count: String(count ?? quiz.questions.length) },
    });
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }]}>{quiz.name}</Text>
        {quiz.description ? (
          <Text style={[styles.desc, { color: c.textLight }]}>{quiz.description}</Text>
        ) : null}
        <Text style={[styles.info, { color: c.textLight }]}>
          {quiz.questions.length} Fragen
          {quiz.exam_date ? ` · Klausur: ${quiz.exam_date}` : ""}
        </Text>
      </View>

      <View style={styles.modes}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Lernmodus wählen</Text>

        <TouchableOpacity
          style={[styles.modeCard, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => startQuiz("single")}
        >
          <Text style={[styles.modeTitle, { color: c.primary }]}>Einzelfragen</Text>
          <Text style={[styles.modeDesc, { color: c.textLight }]}>
            Frage für Frage mit sofortigem Feedback
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeCard, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => startQuiz("weak", 20)}
        >
          <Text style={[styles.modeTitle, { color: c.warning }]}>Schwächen üben</Text>
          <Text style={[styles.modeDesc, { color: c.textLight }]}>
            20 Fragen priorisiert nach Schwächen
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeCard, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => startQuiz("exam")}
        >
          <Text style={[styles.modeTitle, { color: c.danger }]}>Klausur-Simulation</Text>
          <Text style={[styles.modeDesc, { color: c.textLight }]}>
            Alle Fragen, Auswertung am Ende
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { fontSize: 16, textAlign: "center", marginTop: 40 },
  header: { margin: 16, padding: 20, borderRadius: 12, borderWidth: 1 },
  title: { fontSize: 22, fontWeight: "bold" },
  desc: { fontSize: 14, marginTop: 4 },
  info: { fontSize: 13, marginTop: 8 },
  modes: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 12 },
  modeCard: { padding: 18, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  modeTitle: { fontSize: 17, fontWeight: "bold" },
  modeDesc: { fontSize: 13, marginTop: 4 },
});
