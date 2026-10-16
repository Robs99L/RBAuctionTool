export type ParticipantProfile = {
  username: string;
  email: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeParticipantProfile(
  usernameValue: string,
  emailValue: string,
): ParticipantProfile | null {
  const username = usernameValue.trim();
  const email = emailValue.trim().toLowerCase();

  if (username.length < 1 || username.length > 120) return null;
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;

  return { username, email };
}
