import { router } from "expo-router";

import { Welcome } from "@/components/welcome";

export default function WelcomeScreen() {
  return <Welcome onGetStarted={() => router.replace("/onboarding")} onSignIn={() => router.push("/sign-in")} />;
}
