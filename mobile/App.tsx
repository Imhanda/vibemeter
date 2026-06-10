import React, { useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text, TouchableOpacity } from "react-native";
import { registerForPushNotifications } from "./src/notifications/registerPushToken";

import { VenueListScreen } from "./src/screens/VenueListScreen";
import { VenueDetailScreen } from "./src/screens/VenueDetailScreen";
import { CheckInScreen } from "./src/screens/CheckInScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { SplashScreen } from "./src/screens/SplashScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { useAuthStore } from "./src/store/useAuthStore";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./src/config/firebase";
import { C } from "./src/theme";

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
const Tab   = createBottomTabNavigator<TabParamList>();

const STACK_HEADER = {
  headerStyle: { backgroundColor: C.bgSurface },
  headerShadowVisible: false,
  headerTintColor: C.teal,
  headerTitleStyle: { color: C.textPrimary, fontWeight: "700" as const },
  contentStyle: { backgroundColor: C.bgBase },
};

function VenueStack() {
  return (
    <Stack.Navigator screenOptions={STACK_HEADER}>
      <Stack.Screen
        name="VenueList"
        component={VenueListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VenueDetail"
        component={VenueDetailScreen}
        options={({ route }) => ({ title: (route.params as any).name })}
      />
      <Stack.Screen
        name="CheckIn"
        component={CheckInScreen}
        options={({ navigation }) => ({
          title: "Check the Vibe",
          presentation: "formSheet",
          headerLeft: () => (
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
              <Text style={{ color: C.raging, fontSize: 16, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
          ),
        })}
      />
    </Stack.Navigator>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.bgSurface,
          borderTopColor: C.border,
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 24,
          paddingTop: 8,
        },
        tabBarActiveTintColor: C.teal,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" as const },
      }}
    >
      <Tab.Screen
        name="Venues"
        component={VenueStack}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>📍</Text>,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>👤</Text>,
          headerShown: true,
          headerTitle: "My Profile",
          ...STACK_HEADER,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const { userId, setUser, clearUser } = useAuthStore();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const token = await user.getIdToken();
        setUser(user.uid, token, user.displayName, user.photoURL);
        registerForPushNotifications();
      } else {
        clearUser();
      }
    });
    return unsub;
  }, []);

  if (showSplash) return (
    <>
      <StatusBar style="light" />
      <SplashScreen onDone={() => setShowSplash(false)} />
    </>
  );

  if (!userId) return (
    <>
      <StatusBar style="light" />
      <LoginScreen />
    </>
  );

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={Tabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
