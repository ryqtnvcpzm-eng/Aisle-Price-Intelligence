import { redirect } from "next/navigation";
import { AuthForm } from "@/components/settings/auth-form";
import { env } from "@/server/env";
import { getContext } from "@/server/workspace/context";

export const metadata = { title: "Create account" };

export default async function SignUp() {
  if (await getContext()) redirect("/");
  return <AuthForm mode="sign-up" demoEnabled={env.DEMO_ACCOUNT_ENABLED === "true"} />;
}
