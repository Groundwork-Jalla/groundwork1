import { useEffect, useState } from "react";

export const LAUNCH_DATE = new Date("2026-09-03T00:00:00Z");

function getTimeLeft() {
  const diff = Math.max(0, LAUNCH_DATE.getTime() - Date.now());
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

export default function CountdownClock() {
  const [time, setTime] = useState(getTimeLeft);

  useEffect(() => {
    const interval = setInterval(() => setTime(getTimeLeft()), 1000);
    return () => clearInterval(interval);
  }, []);

  const units = [
    { value: time.days, label: "Days" },
    { value: time.hours, label: "Hours" },
    { value: time.minutes, label: "Mins" },
    { value: time.seconds, label: "Secs" },
  ];

  return (
    <div className="flex items-center justify-center gap-3 sm:gap-4">
      {units.map((unit) => (
        <div
          key={unit.label}
          className="flex flex-col items-center justify-center bg-brand-near-black rounded-xl w-16 sm:w-20 py-3"
        >
          <span className="font-sans text-2xl sm:text-3xl font-bold text-white tabular-nums">
            {String(unit.value).padStart(2, "0")}
          </span>
          <span className="text-[10px] sm:text-xs text-white/50 mt-0.5">{unit.label}</span>
        </div>
      ))}
    </div>
  );
}
