import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <SignUp />
    </div>
  );
}
