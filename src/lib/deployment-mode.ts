export function shouldUseDemoMode({
  forced,
  configured,
  production,
}: {
  forced: boolean;
  configured: boolean;
  production: boolean;
}) {
  return forced || (!production && !configured);
}

export function browserDemoMode(configured: boolean) {
  return shouldUseDemoMode({
    forced: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
    configured,
    production: process.env.NODE_ENV === "production",
  });
}
