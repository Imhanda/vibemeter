package handlers

import (
	"log"
	"net/http"
	"vibemeter/cache"
	"vibemeter/db"
	"vibemeter/middleware"

	"github.com/gin-gonic/gin"
)

// DeleteMe handles DELETE /v1/me — in-app account deletion (App Store
// guideline 5.1.1(v)).
//
// Vibe contributions and trust-audit rows are anonymised (user_id -> NULL) so
// aggregate venue scores stay stable; everything that identifies the user is
// hard-deleted. The client deletes the Firebase Auth record itself
// (firebaseUser.delete()) after this returns 204 — the API owns only the
// Postgres/Redis side. A 30-day backstop for encrypted backups is documented
// in the privacy policy.
func DeleteMe(c *gin.Context) {
	userID := c.GetString(middleware.UserIDKey)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}

	// Capture followed venues before the rows go, to clean Redis subscriber
	// hashes afterwards.
	var followed []string
	_ = db.DB.Select(&followed,
		`SELECT place_id FROM notification_subscriptions WHERE user_id = $1`, userID)

	tx, err := db.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not start deletion"})
		return
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`UPDATE vibe_contributions SET user_id = NULL WHERE user_id = $1`, userID); err != nil {
		log.Println("delete-me: anonymise contributions:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to anonymise contributions"})
		return
	}
	if _, err := tx.Exec(`UPDATE trust_events SET user_id = NULL WHERE user_id = $1`, userID); err != nil {
		log.Println("delete-me: anonymise trust_events:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to anonymise trust events"})
		return
	}
	// Keep reports for moderation history, but detach the reporter.
	_, _ = tx.Exec(`UPDATE venue_reports SET reporter_id = NULL WHERE reporter_id = $1`, userID)

	_, _ = tx.Exec(`DELETE FROM badges WHERE user_id = $1`, userID)
	_, _ = tx.Exec(`DELETE FROM notification_subscriptions WHERE user_id = $1`, userID)
	_, _ = tx.Exec(`DELETE FROM push_tokens WHERE user_id = $1`, userID)
	if _, err := tx.Exec(`DELETE FROM users WHERE id = $1`, userID); err != nil {
		log.Println("delete-me: delete user:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete account"})
		return
	}

	if err := tx.Commit(); err != nil {
		log.Println("delete-me: commit:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to finalise deletion"})
		return
	}

	ctx := c.Request.Context()
	for _, placeID := range followed {
		_ = cache.RemoveVenueSubscriber(ctx, placeID, userID)
	}
	cache.PurgeUser(ctx, userID)

	c.Status(http.StatusNoContent)
}
