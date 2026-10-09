import WelcomeClient from "./WelcomeClient";

// Landing page after login: pick a workspace (only offered when you have
// access to more than one — see WelcomeClient). The proxy sends every
// logged-in session without a workspace here first.
export const metadata = { title: "Reline Project — Choose your workspace" };

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  return <WelcomeClient denied={denied} />;
}
