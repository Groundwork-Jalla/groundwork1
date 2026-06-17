import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function CTASection() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleJoin() {
    if (!email) return;
    console.log("join request:", email);
    setSubmitted(true);
  }

  return (
    <section id="join" className="bg-white py-20 text-center px-7">
      <div className="max-w-[460px] mx-auto">
        <div className="text-4xl mb-3">🏠</div>
        <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black">
          Protect Your Build Before It Starts.
        </h2>
        <p className="text-brand-mid-grey mt-4">
          Join the community of diaspora builders who never lost track of their money.
        </p>

        {submitted ? (
          <div className="mt-8 inline-block bg-brand-light-grey text-brand-near-black text-sm font-medium rounded-full px-5 py-2.5">
            ✓ You're in. Welcome.
          </div>
        ) : (
          <div className="flex max-w-[380px] mx-auto rounded-lg overflow-hidden border-2 border-brand-near-black mt-8">
            <Input
              type="email"
              placeholder="your@email.com"
              className="flex-1 border-none rounded-none focus-visible:ring-0"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              onClick={handleJoin}
              className="rounded-none bg-brand-near-black text-white font-bold text-sm px-6 h-auto hover:bg-brand-black"
            >
              Join Free →
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
