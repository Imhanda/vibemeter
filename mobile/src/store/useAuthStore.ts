import { create } from "zustand";

interface AuthState {
  userId: string | null;
  idToken: string | null;
  displayName: string | null;
  photoURL: string | null;
  setUser: (userId: string, idToken: string, displayName: string | null, photoURL: string | null) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  idToken: null,
  displayName: null,
  photoURL: null,
  setUser: (userId, idToken, displayName, photoURL) =>
    set({ userId, idToken, displayName, photoURL }),
  clearUser: () => set({ userId: null, idToken: null, displayName: null, photoURL: null }),
}));
