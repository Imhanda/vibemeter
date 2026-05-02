import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  GoogleSignin,
  GoogleSigninButton,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { GoogleAuthProvider, signInWithCredential, onAuthStateChanged } from "firebase/auth";
import { auth } from "../config/firebase";
import { useAuthStore } from "../store/useAuthStore";

const WEB_CLIENT_ID = "368682546170-5qc6715smlda3k29i39cia6tj51p0uvi.apps.googleusercontent.com";

GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  iosClientId: "368682546170-26n1ubcieuamj7508msrh7082qkdigre.apps.googleusercontent.com",
  offlineAccess: true,
});

export function LoginScreen() {
  const { setUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore existing session
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const token = await user.getIdToken();
        setUser(user.uid, token, user.displayName, user.photoURL);
      }
    });
    return unsub;
  }, []);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken;
      if (!idToken) {
        console.warn("No ID token in signIn response", JSON.stringify(userInfo));
        return;
      }
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      const firebaseToken = await result.user.getIdToken();
      setUser(result.user.uid, firebaseToken, result.user.displayName, result.user.photoURL);
    } catch (e: any) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) {
        // user cancelled, no error needed
      } else if (e.code === statusCodes.IN_PROGRESS) {
        setError("Sign-in already in progress");
      } else if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError("Google Play Services not available");
      } else {
        setError(e.message ?? "Google sign-in failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>🎵</Text>
      <Text style={styles.title}>VibeMeter</Text>
      <Text style={styles.subtitle}>Find the vibe before you arrive</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color="#14b8a6" size="large" style={{ marginTop: 40 }} />
      ) : (
        <GoogleSigninButton
          style={styles.googleBtn}
          size={GoogleSigninButton.Size.Wide}
          color={GoogleSigninButton.Color.Dark}
          onPress={handleGoogleSignIn}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f0f14",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  logo: { fontSize: 64, marginBottom: 16 },
  title: { color: "#fff", fontSize: 32, fontWeight: "800", letterSpacing: 1 },
  subtitle: { color: "#555", fontSize: 15, marginTop: 8, marginBottom: 48 },
  error: { color: "#ef4444", fontSize: 13, textAlign: "center", marginBottom: 16 },
  googleBtn: { width: 240, height: 56, marginTop: 8 },
});
