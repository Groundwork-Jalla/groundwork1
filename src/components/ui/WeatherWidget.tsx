import { useEffect, useState } from 'react';
import { Wind, Droplets } from 'lucide-react';
import { findCountry } from '@/lib/countries';

// ── Country capitals for weather API ──────────────────────

const COUNTRY_COORDS: Record<string, { lat: number; lon: number; city: string }> = {
  NG: { lat:  9.0765,  lon:  7.3986,  city: 'Abuja'       },
  CM: { lat:  3.8667,  lon: 11.5167,  city: 'Yaoundé'     },
  GH: { lat:  5.6037,  lon: -0.1870,  city: 'Accra'       },
  ZA: { lat: -25.7461, lon: 28.1881,  city: 'Pretoria'    },
  TZ: { lat: -6.1731,  lon: 35.7395,  city: 'Dodoma'      },
  KE: { lat: -1.2921,  lon: 36.8219,  city: 'Nairobi'     },
  SN: { lat: 14.6928,  lon: -17.4467, city: 'Dakar'       },
  CI: { lat:  5.3599,  lon: -4.0083,  city: 'Abidjan'     },
  ET: { lat:  9.0320,  lon: 38.7492,  city: 'Addis Ababa' },
  EG: { lat: 30.0626,  lon: 31.2497,  city: 'Cairo'       },
  MA: { lat: 34.0209,  lon: -6.8416,  city: 'Rabat'       },
  RW: { lat: -1.9441,  lon: 30.0619,  city: 'Kigali'      },
  UG: { lat:  0.3476,  lon: 32.5825,  city: 'Kampala'     },
  TG: { lat:  6.1375,  lon:  1.2123,  city: 'Lomé'        },
  BJ: { lat:  6.3654,  lon:  2.4183,  city: 'Cotonou'     },
  GB: { lat: 51.5074,  lon: -0.1278,  city: 'London'      },
  US: { lat: 38.9072,  lon: -77.0369, city: 'Washington'  },
};

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function wmoInfo(code: number): { label: string; emoji: string } {
  if (code === 0)  return { label: 'Clear sky',     emoji: '☀️'  };
  if (code <= 2)   return { label: 'Partly cloudy', emoji: '⛅'  };
  if (code <= 3)   return { label: 'Overcast',      emoji: '☁️'  };
  if (code <= 48)  return { label: 'Foggy',         emoji: '🌫️' };
  if (code <= 57)  return { label: 'Drizzle',       emoji: '🌦️' };
  if (code <= 67)  return { label: 'Rain',          emoji: '🌧️' };
  if (code <= 77)  return { label: 'Snow',          emoji: '❄️'  };
  if (code <= 82)  return { label: 'Rain showers',  emoji: '🌦️' };
  return                  { label: 'Thunderstorm',  emoji: '⛈️'  };
}

interface WeatherDay {
  date: string;
  high: number;
  low: number;
  precipPct: number;
  code: number;
}

interface WeatherData {
  city: string;
  currentTemp: number;
  currentCode: number;
  windspeed: number;
  forecast: WeatherDay[];
}

function useWeather(countryCode: string | null) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!countryCode) return;
    const coords = COUNTRY_COORDS[countryCode];
    if (!coords) return;
    setLoading(true);
    setWeather(null);
    fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
      `&current_weather=true&forecast_days=5&timezone=auto`
    )
      .then(r => r.json())
      .then((data: {
        current_weather: { temperature: number; windspeed: number; weathercode: number };
        daily: {
          time: string[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
          precipitation_probability_max: number[];
          weathercode: number[];
        };
      }) => {
        const d = data.daily;
        setWeather({
          city: coords.city,
          currentTemp: Math.round(data.current_weather.temperature),
          currentCode: data.current_weather.weathercode,
          windspeed:   Math.round(data.current_weather.windspeed),
          forecast: d.time.map((date, i) => ({
            date,
            high:      Math.round(d.temperature_2m_max[i]),
            low:       Math.round(d.temperature_2m_min[i]),
            precipPct: d.precipitation_probability_max[i] ?? 0,
            code:      d.weathercode[i],
          })),
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [countryCode]);

  return { weather, loading };
}

// ── Component ─────────────────────────────────────────────

export function WeatherWidget({ countryCode }: { countryCode: string | null | undefined }) {
  const { weather, loading } = useWeather(countryCode ?? null);
  const coords = countryCode ? COUNTRY_COORDS[countryCode] : null;

  if (!countryCode || !coords) return null;

  const countryName = findCountry(countryCode)?.name ?? countryCode;

  if (loading) {
    return (
      <div className="rounded-xl border border-brand-border-grey bg-white p-5 animate-pulse">
        <div className="h-3 w-28 bg-brand-light-grey rounded mb-3" />
        <div className="flex items-baseline gap-3 mb-2">
          <div className="h-8 w-20 bg-brand-light-grey rounded" />
          <div className="h-3 w-24 bg-brand-light-grey rounded" />
        </div>
        <div className="grid grid-cols-5 gap-2 mt-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-brand-light-grey rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!weather) return null;

  const today = weather.forecast[0];
  const { label, emoji } = wmoInfo(weather.currentCode);

  function buildingAdvice(precipPct: number): string {
    if (precipPct >= 70) return '⚠️ High rain probability — delay concrete pours and earthworks';
    if (precipPct >= 40) return '🌦️ Some rain expected — monitor conditions before outdoor work';
    return '✓ Good conditions for construction work today';
  }

  return (
    <div className="rounded-xl border border-brand-border-grey bg-white overflow-hidden">
      {/* Header label */}
      <div className="px-5 py-3 border-b border-brand-border-grey flex items-center justify-between">
        <span className="text-xs font-semibold text-brand-near-black">Site Weather</span>
        <span className="text-[10px] text-brand-mid-grey">{coords.city}, {countryName}</span>
      </div>

      {/* Current conditions */}
      <div className="px-5 py-4 flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-brand-near-black">{weather.currentTemp}°C</span>
            <span className="text-sm text-brand-mid-grey">{label}</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-brand-mid-grey flex-wrap">
            <span className="flex items-center gap-1">
              <Droplets className="size-3" /> Rain: {today.precipPct}%
            </span>
            <span className="flex items-center gap-1">
              <Wind className="size-3" /> {weather.windspeed} km/h
            </span>
            <span>H: {today.high}° · L: {today.low}°</span>
          </div>
        </div>
        <span className="text-4xl leading-none" aria-hidden="true">{emoji}</span>
      </div>

      {/* 5-day forecast */}
      <div className="grid grid-cols-5 gap-2 px-5 pb-4">
        {weather.forecast.map((day, i) => {
          const d = new Date(day.date + 'T12:00:00');
          const dayLabel = i === 0 ? 'Today' : DAYS_SHORT[d.getDay()];
          const { emoji: dayEmoji } = wmoInfo(day.code);
          return (
            <div key={day.date} className={`flex flex-col items-center gap-1 rounded-xl py-2.5 px-1 ${
              i === 0 ? 'bg-brand-near-black' : 'bg-brand-off-white'
            }`}>
              <span className={`text-[9px] font-semibold uppercase tracking-wide ${
                i === 0 ? 'text-white/60' : 'text-brand-mid-grey'
              }`}>{dayLabel}</span>
              <span className="text-base leading-none">{dayEmoji}</span>
              <span className={`text-xs font-bold tabular-nums ${i === 0 ? 'text-white' : 'text-brand-near-black'}`}>
                {day.high}°
              </span>
              <span className={`text-[10px] tabular-nums ${i === 0 ? 'text-white/50' : 'text-brand-mid-grey'}`}>
                {day.low}°
              </span>
            </div>
          );
        })}
      </div>

      {/* Construction advice */}
      <div className="px-5 py-3 border-t border-brand-border-grey bg-brand-off-white">
        <p className="text-[10px] text-brand-mid-grey leading-relaxed">
          {buildingAdvice(today.precipPct)}
        </p>
      </div>
    </div>
  );
}
