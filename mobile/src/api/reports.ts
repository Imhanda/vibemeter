import { api } from "./client";

export type ReportReason = "wrong" | "closed" | "spam" | "unsafe";

export const REPORT_REASONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: "wrong", label: "Score is wrong", hint: "The vibe score doesn't match what it's actually like here" },
  { id: "closed", label: "Venue has closed", hint: "This place is permanently closed" },
  { id: "spam", label: "Fake check-ins", hint: "The score looks manipulated or spammed" },
  { id: "unsafe", label: "Safety concern", hint: "Something here is unsafe or inappropriate" },
];

export interface CreateReportResponse {
  status: string;
  report_id: string;
  review_sla_hours: number;
}

export function reportVenue(
  placeId: string,
  reason: ReportReason,
  detail?: string,
  vibeId?: string,
): Promise<CreateReportResponse> {
  return api.post<CreateReportResponse>(`/v1/venues/${placeId}/reports`, {
    reason,
    detail: detail ?? "",
    vibe_id: vibeId ?? null,
  });
}
