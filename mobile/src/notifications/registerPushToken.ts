import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "../api/client";

export async function registerForPushNotifications(): Promise<void> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") {
      console.warn("Push notification permission denied");
      return;
    }

    // projectId is required for Expo Go — read from EAS config or fall back to slug
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.expoConfig?.slug;

    console.log("Fetching push token with projectId:", projectId);
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    console.log("Got push token:", tokenData.data);

    await api.post("/v1/user/push-token", { token: tokenData.data });
    console.log("Push token registered with backend");
  } catch (e) {
    console.warn("Push token registration failed:", e);
  }
}
