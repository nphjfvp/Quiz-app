import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Alert,
  Share,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Colors } from "../src/styles/theme";
import { loadSettings, saveSettings, loadQuizzes, saveQuizzes } from "../src/services/storage";
import { pullFromCloud, pushToCloud } from "../src/services/storage";
import { isConfigured, getSyncCode, setSyncCode } from "../src/services/firebase";
import type { Quiz } from "../src/types/quiz";

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [syncCode, setSyncCodeState] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setApiKey(s.api_key ?? "");
      setModel(s.model ?? "");
    });
    getSyncCode().then((code) => setSyncCodeState(code));
  }, []);

  const save = async () => {
    const s = await loadSettings();
    s.api_key = apiKey.trim();
    s.model = model.trim() || "deepseek/deepseek-chat";
    await saveSettings(s);
    await setSyncCode(syncCode);
    Alert.alert("Gespeichert", "Einstellungen gespeichert!");
  };

  const uploadCloud = async () => {
    if (!syncCode.trim()) {
      Alert.alert("Sync", "Bitte zuerst einen Sync-Code eingeben.");
      return;
    }
    setSyncBusy(true);
    await setSyncCode(syncCode);
    const ok = await pushToCloud();
    setSyncBusy(false);
    Alert.alert("Sync", ok ? "In die Cloud hochgeladen!" : "Fehler beim Hochladen.");
  };

  const downloadCloud = async () => {
    if (!syncCode.trim()) {
      Alert.alert("Sync", "Bitte zuerst einen Sync-Code eingeben.");
      return;
    }
    setSyncBusy(true);
    await setSyncCode(syncCode);
    const ok = await pullFromCloud();
    setSyncBusy(false);
    Alert.alert("Sync", ok ? "Daten aus der Cloud geladen!" : "Keine Daten für diesen Code gefunden.");
  };

  const importQuiz = async () => {
    try {
      const result = await (DocumentPicker as any).getDocumentAsync({ type: "application/json" });
      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      const resp = await fetch(uri);
      const data = await resp.json();

      const quiz: Quiz = {
        id: Math.random().toString(36).slice(2),
        name: data.name ?? "Importiertes Quiz",
        description: data.description ?? "",
        questions: (data.questions ?? []).map((q: any) => ({
          ...q,
          id: Math.random().toString(36).slice(2),
        })),
        created: data.created ?? new Date().toISOString(),
        exam_date: data.exam_date ?? "",
        weight: data.weight ?? 1.0,
      };

      const quizzes = await loadQuizzes();
      quizzes.push(quiz);
      await saveQuizzes(quizzes);
      Alert.alert("Import", `Quiz "${quiz.name}" mit ${quiz.questions.length} Fragen importiert!`);
    } catch (e: any) {
      Alert.alert("Fehler", `Import fehlgeschlagen: ${e.message}`);
    }
  };

  const cloudSync = async () => {
    const ok = await pullFromCloud();
    Alert.alert("Sync", ok ? "Daten von der Cloud geladen!" : "Fehler oder nicht konfiguriert.");
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={[styles.section, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>API-Einstellungen</Text>

        <Text style={[styles.label, { color: c.text }]}>OpenRouter API-Key</Text>
        <TextInput
          style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="sk-or-..."
          placeholderTextColor={c.textLight}
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={[styles.label, { color: c.text }]}>Modell</Text>
        <TextInput
          style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
          value={model}
          onChangeText={setModel}
          placeholder="deepseek/deepseek-chat"
          placeholderTextColor={c.textLight}
          autoCapitalize="none"
        />

        <TouchableOpacity style={[styles.btn, { backgroundColor: c.success }]} onPress={save}>
          <Text style={styles.btnText}>Speichern</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Cloud-Sync</Text>
        <Text style={[styles.hint, { color: c.textLight, marginTop: 0, marginBottom: 4 }]}>
          Gib auf jedem Gerät (PC, iPad, iPhone) denselben Sync-Code ein. Alle
          Geräte teilen sich dann dieselben Quizzes und den Lernfortschritt.
        </Text>

        <Text style={[styles.label, { color: c.text }]}>Sync-Code</Text>
        <TextInput
          style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.inputBg }]}
          value={syncCode}
          onChangeText={setSyncCodeState}
          placeholder="z.B. pius-lernen-2026"
          placeholderTextColor={c.textLight}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: c.primary, opacity: syncBusy ? 0.6 : 1 }]}
          onPress={uploadCloud}
          disabled={syncBusy}
        >
          <Text style={styles.btnText}>{syncBusy ? "..." : "In Cloud hochladen"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: c.primaryLight, marginTop: 10, opacity: syncBusy ? 0.6 : 1 }]}
          onPress={downloadCloud}
          disabled={syncBusy}
        >
          <Text style={styles.btnText}>{syncBusy ? "..." : "Aus Cloud laden"}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Daten</Text>

        <TouchableOpacity style={[styles.btn, { backgroundColor: c.primary }]} onPress={importQuiz}>
          <Text style={styles.btnText}>Quiz importieren (JSON)</Text>
        </TouchableOpacity>

        <Text style={[styles.hint, { color: c.textLight }]}>
          Importiere ein einzelnes Quiz als JSON-Datei. Für Geräte-Sync nutze
          besser den Sync-Code oben.
        </Text>
      </View>

      <View style={[styles.section, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Info</Text>
        <Text style={[styles.hint, { color: c.textLight }]}>
          Lerntrainer Mobile v1.0.0
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { margin: 16, marginBottom: 0, padding: 20, borderRadius: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 14 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  btn: { paddingVertical: 14, borderRadius: 10, alignItems: "center", marginTop: 14 },
  btnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  hint: { fontSize: 13, marginTop: 12, lineHeight: 19 },
});
