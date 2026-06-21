import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Colors } from "../src/styles/theme";
import { chatWithAI } from "../src/services/ai";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatScreen() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? Colors.dark : Colors.light;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setLoading(true);

    const resp = await chatWithAI(newMessages);
    const assistantMsg: Message = { role: "assistant", content: resp ?? "Keine Antwort erhalten. Prüfe deinen API-Key in den Einstellungen." };
    setMessages([...newMessages, assistantMsg]);
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyTitle, { color: c.text }]}>KI-Lern-Chat</Text>
            <Text style={[styles.emptyText, { color: c.textLight }]}>
              Stelle Fragen zu deinem Lernstoff, bitte um Erklärungen, Eselsbrücken oder Zusammenfassungen.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user"
                ? [styles.userBubble, { backgroundColor: c.primary }]
                : [styles.aiBubble, { backgroundColor: c.card }],
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                { color: item.role === "user" ? "#fff" : c.text },
              ]}
            >
              {item.content}
            </Text>
          </View>
        )}
      />

      {loading && (
        <View style={[styles.loadingBar, { backgroundColor: c.card }]}>
          <Text style={[styles.loadingText, { color: c.textLight }]}>KI denkt nach...</Text>
        </View>
      )}

      <View style={[styles.inputRow, { backgroundColor: c.card, borderTopColor: c.border }]}>
        <TextInput
          style={[styles.input, { color: c.text, backgroundColor: c.inputBg }]}
          value={input}
          onChangeText={setInput}
          placeholder="Nachricht eingeben..."
          placeholderTextColor={c.textLight}
          multiline
          maxLength={2000}
          onSubmitEditing={send}
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: c.primary }]}
          onPress={send}
          disabled={loading || !input.trim()}
        >
          <Text style={styles.sendText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 8 },
  emptyContainer: { alignItems: "center", marginTop: 60, paddingHorizontal: 30 },
  emptyTitle: { fontSize: 22, fontWeight: "bold", marginBottom: 10 },
  emptyText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  bubble: { maxWidth: "85%", padding: 14, borderRadius: 16, marginBottom: 8 },
  userBubble: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  loadingBar: { paddingHorizontal: 16, paddingVertical: 8 },
  loadingText: { fontSize: 13, fontStyle: "italic" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", padding: 10, borderTopWidth: 1, gap: 8 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
});
