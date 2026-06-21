import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Colors } from "../src/styles/theme";
import { loadQuizzes, loadProgress } from "../src/services/storage";
import { pullFromCloud } from "../src/services/storage";
import type { Quiz } from "../src/types/quiz";

export default function HomeScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [boxCounts, setBoxCounts] = useState<Record<string, Record<number, number>>>({});

  const refresh = useCallback(async () => {
    const q = await loadQuizzes();
    setQuizzes(q);
    const progress = await loadProgress();
    const counts: Record<string, Record<number, number>> = {};
    for (const quiz of q) {
      const bc: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const question of quiz.questions) {
        const box = progress[question.id]?.box ?? 1;
        bc[box] = (bc[box] ?? 0) + 1;
      }
      counts[quiz.id] = bc;
    }
    setBoxCounts(counts);
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const syncCloud = async () => {
    const ok = await pullFromCloud();
    if (ok) {
      await refresh();
      Alert.alert("Sync", "Daten von der Cloud geladen!");
    } else {
      Alert.alert("Sync", "Firebase nicht konfiguriert oder Fehler.");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { backgroundColor: c.primary }]}>
        <Text style={styles.headerTitle}>Lerntrainer</Text>
        <Text style={styles.headerSub}>
          {quizzes.length} Quiz{quizzes.length !== 1 ? "zes" : ""} · Bereit zum Lernen
        </Text>
      </View>

      <FlatList
        data={quizzes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={[styles.emptyCard, { backgroundColor: c.card }]}>
            <Text style={[styles.emptyText, { color: c.textLight }]}>
              Noch keine Quizzes. Importiere ein Quiz aus der Desktop-App oder synchronisiere mit der Cloud.
            </Text>
            <TouchableOpacity
              style={[styles.syncBtn, { backgroundColor: c.primary }]}
              onPress={syncCloud}
            >
              <Text style={styles.syncBtnText}>Cloud Sync</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => {
          const bc = boxCounts[item.id] ?? {};
          return (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => router.push({ pathname: "/quiz/[id]", params: { id: item.id } })}
              activeOpacity={0.7}
            >
              <View style={[styles.accent, { backgroundColor: c.primary }]} />
              <View style={styles.cardContent}>
                <Text style={[styles.cardTitle, { color: c.text }]}>{item.name}</Text>
                <Text style={[styles.cardSub, { color: c.textLight }]}>
                  {item.questions.length} Fragen
                  {item.exam_date ? ` · Klausur: ${item.exam_date}` : ""}
                </Text>
                <View style={styles.boxes}>
                  {[1, 2, 3, 4, 5].map((b) => (
                    <View
                      key={b}
                      style={[styles.boxBadge, { backgroundColor: c[`box${b}` as keyof typeof c] as string }]}
                    >
                      <Text style={styles.boxText}>{bc[b] ?? 0}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <View style={styles.bottomActions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: c.primary }]}
          onPress={syncCloud}
        >
          <Text style={styles.actionBtnText}>Cloud Sync</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 60, paddingBottom: 20, paddingHorizontal: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  headerTitle: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  headerSub: { fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  list: { padding: 16 },
  card: { flexDirection: "row", borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  accent: { width: 5, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  cardContent: { flex: 1, padding: 15 },
  cardTitle: { fontSize: 17, fontWeight: "bold" },
  cardSub: { fontSize: 13, marginTop: 3 },
  boxes: { flexDirection: "row", marginTop: 8, gap: 4 },
  boxBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  boxText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  emptyCard: { margin: 20, padding: 30, borderRadius: 12, alignItems: "center" },
  emptyText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  syncBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  syncBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  bottomActions: { padding: 16, flexDirection: "row", justifyContent: "center" },
  actionBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  actionBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
});
