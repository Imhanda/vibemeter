import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  GoogleSignin,
  GoogleSigninButton,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  onAuthStateChanged,
} from "firebase/auth";
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
  const [appleAvailable, setAppleAvailable] = useState(false);

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

  useEffect(() => {
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
    }
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

  async function handleAppleSignIn() {
    setLoading(true);
    setError(null);
    try {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );

      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      const { identityToken, fullName } = appleCredential;
      if (!identityToken) {
        setError("Apple didn't return an identity token");
        return;
      }

      const provider = new OAuthProvider("apple.com");
      const firebaseCred = provider.credential({ idToken: identityToken, rawNonce });
      const result = await signInWithCredential(auth, firebaseCred);

      // Apple only sends the name on the very first authorization.
      const appleName = [fullName?.givenName, fullName?.familyName].filter(Boolean).join(" ");
      const displayName = result.user.displayName ?? (appleName || null);
      const token = await result.user.getIdToken();
      setUser(result.user.uid, token, displayName, result.user.photoURL);
    } catch (e: any) {
      if (e.code === "ERR_REQUEST_CANCELED") {
        // user cancelled
      } else {
        setError(e.message ?? "Apple sign-in failed");
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
        <View style={styles.buttons}>
          {appleAvailable && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={8}
              style={styles.appleBtn}
              onPress={handleAppleSignIn}
            />
          )}
          <GoogleSigninButton
            style={styles.googleBtn}
            size={GoogleSigninButton.Size.Wide}
            color={GoogleSigninButton.Color.Dark}
            onPress={handleGoogleSignIn}
          />
        </View>
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
  subtitle: { color: "#8A82A8", fontSize: 15, marginTop: 8, marginBottom: 48 },
  error: { color: "#ef4444", fontSize: 13, textAlign: "center", marginBottom: 16 },
  buttons: { alignItems: "center", gap: 14 },
  appleBtn: { width: 240, height: 48 },
  googleBtn: { width: 240, height: 56 },
});
