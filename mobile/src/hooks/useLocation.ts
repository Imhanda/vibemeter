import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { DEFAULT_LOCATION } from "../config";

export interface Coords {
  lat: number;
  lng: number;
}

export interface UseLocationResult {
  coords: Coords;
  loading: boolean;
  usingGPS: boolean; // false = fell back to default
  placeName: string | null; // reverse-geocoded locality, e.g. "Cupertino"
  // Re-checks permission (prompting the OS dialog if it hasn't been decided
  // yet) and refreshes coords on success. Resolves false if permission is
  // still not granted afterwards, so the caller can fall back to nudging the
  // user toward Settings.
  requestLocation: () => Promise<boolean>;
}

export function useLocation(): UseLocationResult {
  const [coords, setCoords] = useState<Coords>(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(true);
  const [usingGPS, setUsingGPS] = useState(false);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const fetchPosition = useCallback(async () => {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("GPS timeout")), 10000)
      ),
    ]);
    if (cancelledRef.current) return;
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setCoords(c);
    setUsingGPS(true);

    // Best-effort: turn the coords into a readable area name (on-device
    // geocoder, no API key). Failure just leaves placeName null.
    Location.reverseGeocodeAsync({ latitude: c.lat, longitude: c.lng })
      .then((results) => {
        if (cancelledRef.current || !results?.length) return;
        const a = results[0];
        const name = a.district || a.city || a.subregion || a.region || null;
        if (name) setPlaceName(name);
      })
      .catch(() => {});
  }, []);

  const requestLocation = useCallback(async (): Promise<boolean> => {
    try {
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        ({ status } = await Location.requestForegroundPermissionsAsync());
      }
      if (status !== "granted") {
        setUsingGPS(false);
        return false;
      }
      await fetchPosition();
      return true;
    } catch {
      setUsingGPS(false);
      return false;
    }
  }, [fetchPosition]);

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setUsingGPS(false);
          setLoading(false);
          return;
        }
        await fetchPosition();
      } catch {
        // permission denied or device error — silently fall back to default
        setUsingGPS(false);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchPosition]);

  return { coords, loading, usingGPS, placeName, requestLocation };
}
