import type { Participant } from "@/lib/types";

export type ParticipantIdentity = {
  username: string;
  email: string;
};

export async function continueParticipantAcrossLots(
  currentParticipant: Participant | null,
  previousIdentity: ParticipantIdentity | null | undefined,
  joinAuction: (username: string, email: string) => Promise<Participant>,
) {
  if (currentParticipant?.email) return currentParticipant;

  const username = (currentParticipant?.username ?? previousIdentity?.username)?.trim();
  const email = (currentParticipant?.email ?? previousIdentity?.email)?.trim().toLowerCase();
  if (!username || !email) return null;

  return joinAuction(username, email);
}
