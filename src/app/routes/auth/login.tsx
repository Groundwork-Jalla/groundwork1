import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    navigate("/dashboard", { replace: true });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="font-['Playfair_Display'] text-2xl font-medium text-brand-near-black">
        Log in
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
        Log in
      </Button>
      <p className="text-center text-sm text-brand-mid-grey">
        <Link to="/auth/reset-password" className="underline">Forgot password?</Link>
      </p>
      <p className="text-center text-sm text-brand-mid-grey">
        No account? <Link to="/auth/signup" className="underline">Sign up</Link>
      </p>
    </form>
  );
}
