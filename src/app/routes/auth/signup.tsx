import { useState } from "react";
import { Link } from "react-router";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <p className="text-center text-sm text-brand-mid-grey">
        Check your email to confirm your account.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="font-['Playfair_Display'] text-2xl font-medium text-brand-near-black">
        Sign up
      </h1>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-brand-mid-grey">{error}</p>}
      <Button type="submit" className="w-full">
        Create account
      </Button>
      <p className="text-center text-sm text-brand-mid-grey">
        Already have an account? <Link to="/auth/login" className="underline">Log in</Link>
      </p>
    </form>
  );
}
