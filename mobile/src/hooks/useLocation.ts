import { useEffect, useState } from "react";
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
}

export function useLocation(): UseLocationResult {
  const [coords, setCoords] = useState<Coords>(DEFAULT_LOCATION);
  const [loading, setLoading] = useState(true);
  const [usingGPS, setUsingGPS] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setUsingGPS(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setUsingGPS(true);
        }
      } catch {
        // permission denied or device error — silently fall back to default
        setUsingGPS(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { coords, loading, usingGPS };
}
