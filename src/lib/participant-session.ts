import type { Participant } from "@/lib/types";

export async function continueParticipantAcrossLots(
  currentParticipant: Participant | null,
  previousUsername: string | null | undefined,
  joinAuction: (username: string) => Promise<Participant>,
) {
  if (currentParticipant) return currentParticipant;

  const username = previousUsername?.trim();
  if (!username) return null;

  return joinAuction(username);
}
