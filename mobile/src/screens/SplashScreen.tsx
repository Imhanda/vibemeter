import React, { useEffect } from "react";
import { View, Image, StyleSheet, Animated } from "react-native";

interface Props {
  onDone: () => void;
}

export function SplashScreen({ onDone }: Props) {
  const opacity = new Animated.Value(0);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => onDone());
  }, []);

  return (
    <View style={styles.container}>
      <Animated.Image
        source={require("../../assets/logo.png")}
        style={[styles.logo, { opacity }]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: "80%",
    height: 260,
  },
});
