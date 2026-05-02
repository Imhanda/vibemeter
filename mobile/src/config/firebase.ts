import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyCq9eR3ZCff6Ob0YBNcofugDEmXGxdIVWk",
  authDomain: "vibemeter-eebb6.firebaseapp.com",
  projectId: "vibemeter-eebb6",
  storageBucket: "vibemeter-eebb6.firebasestorage.app",
  messagingSenderId: "368682546170",
  appId: "1:368682546170:ios:aefee48c90d5e29193ea43",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = initializeAuth(firebaseApp, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});
