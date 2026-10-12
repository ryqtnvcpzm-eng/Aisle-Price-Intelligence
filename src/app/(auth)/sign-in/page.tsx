import { redirect } from "next/navigation";
import { AuthForm } from "@/components/settings/auth-form";
import { env } from "@/server/env";
import { getContext } from "@/server/workspace/context";

export const metadata = { title: "Sign in" };

export default async function SignIn() {
  if (await getContext()) redirect("/");
  return <AuthForm mode="sign-in" demoEnabled={env.DEMO_ACCOUNT_ENABLED === "true"} />;
}
