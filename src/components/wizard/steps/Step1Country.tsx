import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { motion } from 'framer-motion';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { COUNTRIES, POPULAR_COUNTRY_CODES } from '@/lib/countries';
import { cn } from '@/lib/utils';

export default function Step1Country() {
  const { data, update, next } = useWizard();
  const [query, setQuery] = useState('');

  const popular = COUNTRIES.filter(c => POPULAR_COUNTRY_CODES.includes(c.code));

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [query]);

  function selectCountry(code: string, name: string) {
    update({ country: code, countryName: name });
    setQuery('');
  }

  const showSearch = query.trim().length > 0;

  return (
    <WizardShell canContinue={!!data.country} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          Where will you be building?
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          We tailor cost estimates and verification coverage to your region.
        </p>

        {/* Search */}
        <div className="relative mt-6">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-brand-mid-grey pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search country…"
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
              <li className="px-4 py-3 text-sm text-brand-mid-grey">No results for "{query}"</li>
            ) : (
              filtered.slice(0, 8).map(c => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => selectCountry(c.code, c.name)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-brand-off-white transition-colors"
                  >
                    <span className="text-lg leading-none">{c.flag}</span>
                    <span className="font-medium text-brand-near-black">{c.name}</span>
                    <span className="ml-auto text-xs text-brand-mid-grey">{c.code}</span>
                  </button>
                </li>
              ))
            )}
          </motion.ul>
        )}

        {/* Popular countries */}
        {!showSearch && (
          <div className="mt-6">
            <p className="text-xs font-medium text-brand-mid-grey uppercase tracking-widest mb-3">
              Popular
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {popular.map(c => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => selectCountry(c.code, c.name)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border-2 py-4 px-2 transition-all duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
                    data.country === c.code
                      ? 'border-brand-near-black bg-brand-off-white'
                      : 'border-brand-border-grey hover:border-brand-dark-grey',
                  )}
                >
                  <span className="text-2xl leading-none">{c.flag}</span>
                  <span className="text-xs font-semibold text-brand-near-black text-center leading-tight">
                    {c.name}
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
            <span className="text-sm font-medium text-brand-near-black">{data.countryName}</span>
            <button
              type="button"
              onClick={() => update({ country: '', countryName: '' })}
              className="ml-auto text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors"
            >
              Change
            </button>
          </motion.div>
        )}
      </div>
    </WizardShell>
  );
}
