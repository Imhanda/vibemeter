import { api } from "./client";
import { auth } from "../config/firebase";
import { deleteUser } from "firebase/auth";

/**
 * Permanently deletes the signed-in user's account.
 *
 * 1. DELETE /v1/me — the API anonymises the user's vibe history (scores stay
 *    intact) and removes everything that identifies them.
 * 2. deleteUser() — removes the Firebase Auth record.
 *
 * Firebase throws `auth/requires-recent-login` if the session is old; callers
 * should catch that and ask the user to sign in again before retrying.
 */
export async function deleteAccount(): Promise<void> {
  await api.delete<void>("/v1/me");
  const user = auth.currentUser;
  if (user) {
    await deleteUser(user);
  }
}
