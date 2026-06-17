import { useState, useEffect, useRef } from "react";

export function useCarousel(length: number, interval = 5500) {
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setIndex((i) => (i + 1) % length), interval);
  };

  useEffect(() => {
    reset();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [length, interval]);

  const goTo = (n: number) => {
    setIndex(n);
    reset();
  };

  return [index, goTo] as const;
}
