import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";

import { VenueListScreen } from "./src/screens/VenueListScreen";
import { VenueDetailScreen } from "./src/screens/VenueDetailScreen";
import { CheckInScreen } from "./src/screens/CheckInScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";

// ── Navigator param types ─────────────────────────────────────────────────────

export type RootStackParamList = {
  Tabs: undefined;
  VenueList: undefined;
  VenueDetail: { placeId: string; name: string };
  CheckIn: { placeId: string; name: string };
};

type TabParamList = {
  Venues: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// ── Bottom tab navigator ──────────────────────────────────────────────────────

function VenueStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0f0f14" },
        headerTintColor: "#14b8a6",
        headerTitleStyle: { color: "#fff", fontWeight: "700" },
        contentStyle: { backgroundColor: "#0f0f14" },
      }}
    >
      <Stack.Screen
        name="VenueList"
        component={VenueListScreen}
        options={{ title: "Nearby Venues" }}
      />
      <Stack.Screen
        name="VenueDetail"
        component={VenueDetailScreen}
        options={({ route }) => ({ title: (route.params as any).name })}
      />
      <Stack.Screen
        name="CheckIn"
        component={CheckInScreen}
        options={{ title: "Check the Vibe", presentation: "modal" }}
      />
    </Stack.Navigator>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "#0f0f14", borderTopColor: "#1a1a22" },
        tabBarActiveTintColor: "#14b8a6",
        tabBarInactiveTintColor: "#555",
      }}
    >
      <Tab.Screen
        name="Venues"
        component={VenueStack}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📍</Text>,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>👤</Text>,
          headerShown: true,
          headerTitle: "My Profile",
          headerStyle: { backgroundColor: "#0f0f14" },
          headerTitleStyle: { color: "#fff", fontWeight: "700" },
        }}
      />
    </Tab.Navigator>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={Tabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
