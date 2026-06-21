import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { Colors } from "../src/styles/theme";

export default function RootLayout() {
  const scheme = useColorScheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textLight,
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "bold" },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: "Home", tabBarLabel: "Home", tabBarIcon: () => null }}
        />
        <Tabs.Screen
          name="daily"
          options={{ title: "Daily", tabBarLabel: "Daily", tabBarIcon: () => null }}
        />
        <Tabs.Screen
          name="chat"
          options={{ title: "KI-Chat", tabBarLabel: "Chat", tabBarIcon: () => null }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: "Einstellungen", tabBarLabel: "Settings", tabBarIcon: () => null }}
        />
        <Tabs.Screen
          name="quiz/[id]"
          options={{ href: null, title: "Quiz" }}
        />
        <Tabs.Screen
          name="quiz/play"
          options={{ href: null, title: "Frage" }}
        />
      </Tabs>
    </>
  );
}
