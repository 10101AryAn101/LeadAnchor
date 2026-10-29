"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { signIn, signUp } from "@/lib/auth-client";

const signInSchema = z.object({
  email: z.email("Enter your email"),
  password: z.string().min(1, "Enter your password"),
});

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
});

/** Only allow redirects back into this app. */
const safeNext = (value: string | null) => (value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard");

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const form = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await signIn.email(values);
    if (error) {
      toast.error(error.message ?? "That email and password don't match.");
      return;
    }
    router.replace(safeNext(params.get("next")));
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormHeading title="Welcome back" description="Sign in to see who called and what they need." />
      <FieldGroup className="mt-8">
        <Field data-invalid={!!form.formState.errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
          <FieldError errors={[form.formState.errors.email]} />
        </Field>
        <Field data-invalid={!!form.formState.errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
          <FieldError errors={[form.formState.errors.password]} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />} Sign in
        </Button>
      </FieldGroup>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to LeadAnchor?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const form = useForm<z.infer<typeof signUpSchema>>({ resolver: zodResolver(signUpSchema), defaultValues: { name: "", email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await signUp.email(values);
    if (error) {
      toast.error(error.message ?? "We couldn't create your account.");
      return;
    }
    router.replace("/onboarding");
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormHeading title="Stop losing calls" description="Set up takes about two minutes. No card needed." />
      <FieldGroup className="mt-8">
        <Field data-invalid={!!form.formState.errors.name}>
          <FieldLabel htmlFor="name">Your name</FieldLabel>
          <Input id="name" autoComplete="name" {...form.register("name")} />
          <FieldError errors={[form.formState.errors.name]} />
        </Field>
        <Field data-invalid={!!form.formState.errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
          <FieldError errors={[form.formState.errors.email]} />
        </Field>
        <Field data-invalid={!!form.formState.errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
          <FieldError errors={[form.formState.errors.password]} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Spinner />} Create account
        </Button>
      </FieldGroup>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function FormHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-2">
      <h1 className="font-display text-3xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
