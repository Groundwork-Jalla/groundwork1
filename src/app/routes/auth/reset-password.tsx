import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p className="text-center text-sm text-brand-mid-grey">
        Check your email for a reset link.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h1 className="font-['Playfair_Display'] text-2xl font-medium text-brand-near-black">
        Reset password
      </h1>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-brand-mid-grey">{error}</p>}
      <Button type="submit" className="w-full">
        Send reset link
      </Button>
    </form>
  );
}
