import { useEffect, useState } from 'react';
import {
  Wind, Droplets, Sun, CloudSun, Cloud, CloudFog,
  CloudDrizzle, CloudRain, Snowflake, CloudLightning, AlertTriangle, Check,
} from 'lucide-react';
import { useT, type TKey } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';

// ── Coordinates for the weather API ───────────────────────

interface Coords { lat: number; lon: number; city: string }

/**
 * Build cities, checked before the country capital.
 *
 * The widget used to key off country alone, so a Douala build was shown Yaoundé's
 * weather — 200km away, different coast, different rain. The point of this panel is
 * to tell an owner abroad whether their site can be poured this week, and a capital
 * that is not the site cannot answer that.
 *
 * Keyed on the lower-cased city string stored on the project. Anything not listed
 * falls back to the capital, which is still better than nothing.
 */
const CITY_COORDS: Record<string, Coords> = {
  douala:      { lat:  4.0511, lon:  9.7679, city: 'Douala'      },
  'yaoundé':   { lat:  3.8480, lon: 11.5021, city: 'Yaoundé'     },
  yaounde:     { lat:  3.8480, lon: 11.5021, city: 'Yaoundé'     },
  kribi:       { lat:  2.9370, lon:  9.9100, city: 'Kribi'       },
  buea:        { lat:  4.1527, lon:  9.2920, city: 'Buea'        },
  limbe:       { lat:  4.0186, lon:  9.1950, city: 'Limbe'       },
  bamenda:     { lat:  5.9597, lon: 10.1459, city: 'Bamenda'     },
  // Bali left the wizard's city list when it was renamed to Bamenda, but projects
  // created before that still store 'Bali' as free text — see CITY_ALIASES in
  // budget/model.ts. Dropping this row would leave those projects with no weather.
  bali:        { lat:  5.8833, lon: 10.0167, city: 'Bali'        },
  'ngaoundéré':{ lat:  7.3167, lon: 13.5833, city: 'Ngaoundéré'  },
  ngaoundere:  { lat:  7.3167, lon: 13.5833, city: 'Ngaoundéré'  },
  adamawa:     { lat:  7.3167, lon: 13.5833, city: 'Ngaoundéré'  },
  lagos:       { lat:  6.5244, lon:  3.3792, city: 'Lagos'       },
  abuja:       { lat:  9.0765, lon:  7.3986, city: 'Abuja'       },
  accra:       { lat:  5.6037, lon: -0.1870, city: 'Accra'       },
  nairobi:     { lat: -1.2921, lon: 36.8219, city: 'Nairobi'     },
};

const COUNTRY_COORDS: Record<string, Coords> = {
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

// Day abbreviations come from the dictionary — 'Mon'/'Tue' are not French.
const DAY_KEYS: TKey[] = [
  'weather.days.sun', 'weather.days.mon', 'weather.days.tue', 'weather.days.wed',
  'weather.days.thu', 'weather.days.fri', 'weather.days.sat',
];

type WmoIcon = typeof Sun;

/** WMO weather code → a monochrome icon and a dictionary key for its label. */
function wmoInfo(code: number): { labelKey: TKey; Icon: WmoIcon } {
  if (code === 0)  return { labelKey: 'weather.clear',        Icon: Sun            };
  if (code <= 2)   return { labelKey: 'weather.partlyCloudy', Icon: CloudSun       };
  if (code <= 3)   return { labelKey: 'weather.overcast',     Icon: Cloud          };
  if (code <= 48)  return { labelKey: 'weather.foggy',        Icon: CloudFog       };
  if (code <= 57)  return { labelKey: 'weather.drizzle',      Icon: CloudDrizzle   };
  if (code <= 67)  return { labelKey: 'weather.rain',         Icon: CloudRain      };
  if (code <= 77)  return { labelKey: 'weather.snow',         Icon: Snowflake      };
  if (code <= 82)  return { labelKey: 'weather.showers',      Icon: CloudDrizzle   };
  return                  { labelKey: 'weather.thunderstorm', Icon: CloudLightning };
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

/** The build city if we know it, otherwise the country capital. */
function resolveCoords(countryCode: string | null, city: string | null): Coords | null {
  const byCity = city ? CITY_COORDS[city.trim().toLowerCase()] : undefined;
  if (byCity) return byCity;
  return countryCode ? COUNTRY_COORDS[countryCode] ?? null : null;
}

function useWeather(countryCode: string | null, city: string | null) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const coords = resolveCoords(countryCode, city);
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
  }, [countryCode, city]);

  return { weather, loading };
}

// ── Component ─────────────────────────────────────────────

export function WeatherWidget({ countryCode, city }: {
  countryCode: string | null | undefined;
  /** Build city. Falls back to the country capital when unrecognised. */
  city?: string | null;
}) {
  const t = useT();
  const { weather, loading } = useWeather(countryCode ?? null, city ?? null);
  const { country } = useDomainLabels();
  const coords = resolveCoords(countryCode ?? null, city ?? null);

  if (!coords) return null;

  const countryName = country(countryCode);

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
  const { labelKey, Icon: CurrentIcon } = wmoInfo(weather.currentCode);

  function buildingAdvice(precipPct: number): { key: TKey; Icon: WmoIcon; alert: boolean } {
    if (precipPct >= 70) return { key: 'weather.adviceHighRain', Icon: AlertTriangle, alert: true  };
    if (precipPct >= 40) return { key: 'weather.adviceSomeRain', Icon: CloudDrizzle,  alert: false };
    return                      { key: 'weather.adviceGood',     Icon: Check,         alert: false };
  }

  return (
    <div className="rounded-xl border border-brand-border-grey bg-white overflow-hidden">
      {/* Header label */}
      <div className="px-5 py-3 border-b border-brand-border-grey flex items-center justify-between">
        <span className="text-xs font-semibold text-brand-near-black">{t('weather.siteWeather')}</span>
        <span className="text-[10px] text-brand-mid-grey">{coords.city}, {countryName}</span>
      </div>

      {/* Current conditions */}
      <div className="px-5 py-4 flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-brand-near-black">{weather.currentTemp}°C</span>
            <span className="text-sm text-brand-mid-grey">{t(labelKey)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-brand-mid-grey flex-wrap">
            <span className="flex items-center gap-1">
              <Droplets className="size-3" /> {t('weather.rain')}: {today.precipPct}%
            </span>
            <span className="flex items-center gap-1">
              <Wind className="size-3" /> {weather.windspeed} km/h
            </span>
            <span>H: {today.high}° · L: {today.low}°</span>
          </div>
        </div>
        <CurrentIcon className="size-10 shrink-0 text-brand-mid-grey" aria-hidden="true" strokeWidth={1.5} />
      </div>

      {/* 5-day forecast */}
      <div className="grid grid-cols-5 gap-2 px-5 pb-4">
        {weather.forecast.map((day, i) => {
          const d = new Date(day.date + 'T12:00:00');
          const dayLabel = i === 0 ? t('weather.today') : t(DAY_KEYS[d.getDay()]);
          const { Icon: DayIcon, labelKey: dayLabelKey } = wmoInfo(day.code);
          return (
            <div key={day.date} className={`flex flex-col items-center gap-1 rounded-xl py-2.5 px-1 ${
              i === 0 ? 'bg-brand-near-black' : 'bg-brand-off-white'
            }`}>
              <span className={`text-[9px] font-semibold uppercase tracking-wide ${
                i === 0 ? 'text-white/60' : 'text-brand-mid-grey'
              }`}>{dayLabel}</span>
              <DayIcon
                aria-label={t(dayLabelKey)}
                className={`size-4 ${i === 0 ? 'text-white' : 'text-brand-mid-grey'}`}
              />
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
        {(() => {
          const advice = buildingAdvice(today.precipPct);
          return (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-brand-mid-grey">
              <advice.Icon className={`mt-px size-3 shrink-0 ${advice.alert ? 'text-state-alert' : 'text-brand-mid-grey'}`} />
              {t(advice.key)}
            </p>
          );
        })()}
      </div>
    </div>
  );
}
