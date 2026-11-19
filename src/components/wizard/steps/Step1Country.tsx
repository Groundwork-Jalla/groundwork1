import { useState, useMemo } from 'react';
import { Info, MapPin, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { COUNTRIES, POPULAR_COUNTRY_CODES } from '@/lib/countries';
import { CITY_RATES, CM_CITY_CODES, hasLocalBq } from '@/lib/budget';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';

/** Major build cities for countries outside the Cameroon rate book. */
const COUNTRY_CITIES: Record<string, readonly string[]> = {
  NG: ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Enugu', 'Kano', 'Owerri', 'Asaba'],
  GH: ['Accra', 'Kumasi', 'Takoradi', 'Tamale', 'Tema', 'Cape Coast'],
  KE: ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika'],
  ZA: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Gqeberha', 'Bloemfontein'],
  UG: ['Kampala', 'Entebbe', 'Jinja', 'Mbarara', 'Gulu'],
  TZ: ['Dar es Salaam', 'Dodoma', 'Arusha', 'Mwanza', 'Zanzibar'],
  ET: ['Addis Ababa', 'Adama', 'Hawassa', 'Bahir Dar', 'Dire Dawa'],
  CI: ['Abidjan', 'Yamoussoukro', 'Bouaké', 'San-Pédro'],
  SN: ['Dakar', 'Thiès', 'Saint-Louis', 'Mbour', 'Touba'],
};

const isKnownCmCity = (city: string) =>
  CM_CITY_CODES.some(code => CITY_RATES[code].city_name === city);

export default function Step1Country() {
  const t = useT();
  const { country } = useDomainLabels();
  const { data, update, next } = useWizard();
  const [slide, setSlide] = useState<'country' | 'city'>('country');
  const [query, setQuery] = useState('');
  const [cityOther, setCityOther] = useState(false);

  // Only the eight launch-priority countries are listed; everything else is reached by search.
  const popular = useMemo(
    () => POPULAR_COUNTRY_CODES
      .map(code => COUNTRIES.find(c => c.code === code))
      .filter((c): c is (typeof COUNTRIES)[number] => !!c),
    [],
  );

  // Match on the displayed name *and* the English one, so "Ivory Coast" typed by an
  // anglophone still finds Côte d'Ivoire while French is selected, and vice versa.
  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return COUNTRIES.filter(c =>
      country(c.code).toLowerCase().includes(q)
      || c.name.toLowerCase().includes(q)
      || c.code.toLowerCase().includes(q),
    );
  }, [query, country]);

  function selectCountry(code: string) {
    if (code !== data.country) {
      update({ country: code, city: '' });
      setCityOther(false);
    } else {
      update({ country: code });
    }
    setQuery('');
  }

  const showSearch = query.trim().length > 0;
  const isCameroon = data.country === 'CM';
  const presetCities = !isCameroon && data.country ? COUNTRY_CITIES[data.country] : undefined;

  // ── Slide 2: City selection for the chosen country ─────────────────────────
  if (slide === 'city' && data.country) {
    const countryName = country(data.country);
    const hasCity = data.city.trim().length >= 2;
    const otherActive = cityOther
      || (isCameroon && data.city.length > 0 && !isKnownCmCity(data.city))
      || (!!presetCities && data.city.length > 0 && !presetCities.includes(data.city));

    return (
      <WizardShell
        canContinue={hasCity}
        onContinue={next}
        onBack={() => setSlide('country')}
      >
        <div className="pt-2" data-city-step>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-mid-grey">
            {COUNTRIES.find(c => c.code === data.country)?.flag} {countryName}
          </p>
          <h1 className="mt-1 font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
            {t('wizard.cityStep.title', { country: countryName })}
          </h1>
          <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
            {t('wizard.cityStep.subtitle')}
          </p>

          {isCameroon ? (
            <div className="mt-6 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {CM_CITY_CODES.map(code => {
                  const c = CITY_RATES[code];
                  const active = !otherActive && data.city === c.city_name;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => { setCityOther(false); update({ city: c.city_name }); }}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-xl border-2 px-3.5 py-3 text-left transition-all duration-150',
                        active
                          ? 'border-brand-near-black bg-brand-off-white'
                          : 'border-brand-border-grey hover:border-brand-dark-grey',
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-near-black">
                        <MapPin className="size-3.5 shrink-0 text-brand-mid-grey" aria-hidden />
                        {c.city_name}
                      </span>
                      {c.cost_delta_pct != null && (
                        <span className="text-[11px] text-brand-mid-grey">
                          {c.cost_delta_pct === 0
                            ? t('wizard.city.baseline')
                            : t('wizard.city.delta', {
                                delta: `${c.cost_delta_pct > 0 ? '+' : ''}${c.cost_delta_pct}%`,
                              })}
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => { setCityOther(true); if (isKnownCmCity(data.city)) update({ city: '' }); }}
                  className={cn(
                    'flex items-center justify-center rounded-xl border-2 px-3.5 py-3 text-sm font-semibold transition-all duration-150',
                    otherActive
                      ? 'border-brand-near-black bg-brand-off-white text-brand-near-black'
                      : 'border-dashed border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
                  )}
                >
                  {t('wizard.cityStep.otherCity')}
                </button>
              </div>
              {otherActive && (
                <input
                  type="text"
                  autoFocus
                  value={isKnownCmCity(data.city) ? '' : data.city}
                  onChange={e => update({ city: e.target.value })}
                  placeholder={t('wizard.cityStep.placeholder')}
                  className="w-full rounded-lg border border-brand-border-grey bg-white px-4 py-2.5 text-sm text-brand-near-black placeholder:text-brand-soft-grey focus:outline-none focus:ring-2 focus:ring-brand-near-black/30 focus:border-brand-near-black"
                />
              )}
            </div>
          ) : presetCities ? (
            <div className="mt-6 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {presetCities.map(cityName => {
                  const active = !otherActive && data.city === cityName;
                  return (
                    <button
                      key={cityName}
                      type="button"
                      onClick={() => { setCityOther(false); update({ city: cityName }); }}
                      className={cn(
                        'flex items-center gap-1.5 rounded-xl border-2 px-3.5 py-3 text-left text-sm font-semibold transition-all duration-150',
                        active
                          ? 'border-brand-near-black bg-brand-off-white text-brand-near-black'
                          : 'border-brand-border-grey text-brand-near-black hover:border-brand-dark-grey',
                      )}
                    >
                      <MapPin className="size-3.5 shrink-0 text-brand-mid-grey" aria-hidden />
                      {cityName}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => { setCityOther(true); if (presetCities.includes(data.city)) update({ city: '' }); }}
                  className={cn(
                    'flex items-center justify-center rounded-xl border-2 px-3.5 py-3 text-sm font-semibold transition-all duration-150',
                    otherActive
                      ? 'border-brand-near-black bg-brand-off-white text-brand-near-black'
                      : 'border-dashed border-brand-border-grey text-brand-mid-grey hover:border-brand-dark-grey hover:text-brand-near-black',
                  )}
                >
                  {t('wizard.cityStep.otherCity')}
                </button>
              </div>
              {otherActive && (
                <input
                  type="text"
                  autoFocus
                  value={presetCities.includes(data.city) ? '' : data.city}
                  onChange={e => update({ city: e.target.value })}
                  placeholder={t('wizard.cityStep.placeholder')}
                  className="w-full rounded-lg border border-brand-border-grey bg-white px-4 py-2.5 text-sm text-brand-near-black placeholder:text-brand-soft-grey focus:outline-none focus:ring-2 focus:ring-brand-near-black/30 focus:border-brand-near-black"
                />
              )}
            </div>
          ) : (
            <div className="mt-6">
              <input
                type="text"
                autoFocus
                value={data.city}
                onChange={e => update({ city: e.target.value })}
                placeholder={t('wizard.cityStep.placeholder')}
                className="w-full rounded-lg border border-brand-border-grey bg-white px-4 py-2.5 text-sm text-brand-near-black placeholder:text-brand-soft-grey focus:outline-none focus:ring-2 focus:ring-brand-near-black/30 focus:border-brand-near-black"
              />
            </div>
          )}
        </div>
      </WizardShell>
    );
  }

  // ── Slide 1: Country selection ─────────────────────────────────────────────
  return (
    <WizardShell canContinue={!!data.country} onContinue={() => setSlide('city')}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s1Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s1Sub')}
        </p>

        {/* Search */}
        <div className="relative mt-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-brand-mid-grey pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('wizard.searchCountry')}
            className="w-full rounded-lg border border-brand-border-grey bg-white pl-10 pr-4 py-2.5 text-sm text-brand-near-black placeholder:text-brand-soft-grey focus:outline-none focus:ring-2 focus:ring-brand-near-black/30 focus:border-brand-near-black transition-all"
          />
        </div>

        {/* Search results */}
        {showSearch && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1 rounded-lg border border-brand-border-grey bg-white shadow-sm divide-y divide-brand-border-grey overflow-hidden"
          >
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-brand-mid-grey">{t('wizard.noResultsFor', { query })}</li>
            ) : (
              filtered.slice(0, 8).map(c => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => selectCountry(c.code)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-off-white transition-colors"
                  >
                    <span className="text-lg leading-none">{c.flag}</span>
                    <span className="font-medium text-brand-near-black">{country(c.code)}</span>
                    <span className="ml-auto text-xs text-brand-mid-grey">{c.code}</span>
                  </button>
                </li>
              ))
            )}
          </motion.ul>
        )}

        {/* Popular countries, Cameroon first; the rest via search */}
        {!showSearch && (
          <div className="mt-6">
            <p className="text-xs font-medium text-brand-mid-grey uppercase tracking-widest mb-3">
              {t('wizard.mostPopular')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {popular.map(c => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => selectCountry(c.code)}
                  className={cn(
                    'relative flex flex-col items-center gap-1.5 rounded-xl border-2 py-4 px-2 transition-all duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
                    data.country === c.code
                      ? 'border-brand-near-black bg-brand-off-white'
                      : 'border-brand-border-grey hover:border-brand-dark-grey',
                  )}
                >
                  <span className="text-2xl leading-none">{c.flag}</span>
                  <span className="text-xs font-semibold text-brand-near-black text-center leading-tight">
                    {country(c.code)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected indicator */}
        {data.country && !showSearch && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 flex items-center gap-2 rounded-lg border border-brand-border-grey bg-brand-off-white px-4 py-2.5"
          >
            <span className="text-lg">{COUNTRIES.find(c => c.code === data.country)?.flag}</span>
            <span className="text-sm font-medium text-brand-near-black">{country(data.country)}</span>
            <button
              type="button"
              onClick={() => update({ country: '', city: '' })}
              className="ml-auto text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors"
            >
              {t('wizard.change')}
            </button>
          </motion.div>
        )}

        {/* Said here, where the choice is made, rather than only on step 9 after ten
            screens of work. Cameroon is the only country with real Bills of Quantity
            behind it; everywhere else is a regional index, and a beta tester filing a
            pricing report against Tanzania has no way to know that from the picker. */}
        {data.country && !showSearch && !hasLocalBq(data.country) && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-brand-mid-grey"
          >
            <Info className="mt-px size-3.5 shrink-0" />
            {t('wizard.countryUnverified', { country: country(data.country) })}
          </motion.p>
        )}
      </div>
    </WizardShell>
  );
}
