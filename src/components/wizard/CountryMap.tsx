import { useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { COUNTRIES } from '@/lib/countries';

function getFlag(code: string): string {
  return COUNTRIES.find(c => c.code === code)?.flag ?? '';
}

// Country centre coordinates: [lat, lng, zoom]
const COORDS: Record<string, [number, number, number]> = {
  NG: [9.08,   8.67,   6],  ZA: [-30.56, 22.94,  5],
  GH: [7.96,  -1.02,   7],  KE: [-0.02,  37.90,  6],
  UG: [1.37,  32.29,   7],  TZ: [-6.37,  34.89,  6],
  CM: [3.85,  11.50,   6],  RW: [-1.94,  29.87,  8],
  ET: [9.15,  40.49,   6],  SN: [14.49, -14.45,  7],
  CI: [7.54,  -5.55,   7],  ZM: [-13.13, 27.85,  6],
  ZW: [-19.02, 29.15,  7],  MA: [31.79,  -7.09,  6],
  EG: [26.82,  30.80,  6],  AO: [-11.20, 17.87,  6],
  MZ: [-18.67, 35.53,  6],  BJ: [9.31,   2.32,   7],
  MW: [-13.25, 34.30,  7],  MG: [-18.77, 46.87,  6],
  GB: [55.38,  -3.44,  5],  DE: [51.17,  10.45,  6],
  FR: [46.23,   2.21,  6],  NL: [52.13,   5.29,  7],
  IE: [53.41,  -8.24,  7],  IT: [41.87,  12.57,  6],
  PT: [39.40,  -8.22,  7],  ES: [40.46,  -3.75,  6],
  BE: [50.50,   4.47,  7],  SE: [60.13,  18.64,  5],
  NO: [60.47,   8.47,  5],  FI: [61.92,  25.74,  6],
  CA: [56.13,-106.35,  4],  US: [37.09, -95.71,  4],
  AU: [-25.27, 133.78, 4],  NZ: [-40.90, 174.89, 5],
  AE: [23.42,  53.85,  7],  SA: [23.89,  45.08,  6],
  QA: [25.35,  51.18,  9],  IN: [20.59,  78.96,  5],
  SG: [1.35,  103.82, 11],  ZZ: [4,       20,    3],
};

function getCoords(code: string): [number, number, number] {
  return COORDS[code] ?? COORDS.ZZ;
}

// ── Map component ─────────────────────────────────────────────

interface CountryMapProps {
  countryCode: string;
  countryName: string;
}

export function CountryMap({ countryCode, countryName }: CountryMapProps) {
  const flag = getFlag(countryCode);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<import('leaflet').Map | null>(null);
  const markerRef    = useRef<import('leaflet').Marker | null>(null);

  useEffect(() => {
    let map: import('leaflet').Map;

    // Dynamically import Leaflet (avoids SSR issues)
    import('leaflet').then(L => {
      // Only init once
      if (mapRef.current || !containerRef.current) return;

      // Import leaflet CSS once
      if (!document.querySelector('#leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      const [lat, lng, zoom] = getCoords(countryCode);

      map = L.map(containerRef.current!, {
        zoomControl:       false,
        scrollWheelZoom:   false,
        doubleClickZoom:   false,
        dragging:          true,
        attributionControl: false,
      }).setView([lat, lng], zoom);

      // ESRI World Imagery — free satellite tiles, no API key
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 17,
          attribution: 'Imagery © Esri',
        },
      ).addTo(map);

      // Country label overlay
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 17, opacity: 0.7 },
      ).addTo(map);

      // Custom marker
      const icon = L.divIcon({
        html: `<div style="
          width:36px;height:36px;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          background:#0a0a0a;
          border:3px solid white;
          box-shadow:0 4px 14px rgba(0,0,0,0.35);
          display:flex;align-items:center;justify-content:center;
        "></div>`,
        className: '',
        iconSize:   [36, 36],
        iconAnchor: [18, 36],
      });
      markerRef.current = L.marker([lat, lng], { icon }).addTo(map);

      mapRef.current = map;
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current  = null;
        markerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to new country when selection changes
  useEffect(() => {
    if (!mapRef.current) return;
    const [lat, lng, zoom] = getCoords(countryCode);

    import('leaflet').then(L => {
      if (!mapRef.current) return;
      mapRef.current.flyTo([lat, lng], zoom, { duration: 1.6, easeLinearity: 0.25 });
      markerRef.current?.setLatLng([lat, lng]);

      // Update custom icon with flag emoji
      markerRef.current?.setIcon(L.divIcon({
        html: `<div style="
          width:40px;height:40px;
          border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          background:#0a0a0a;
          border:3px solid white;
          box-shadow:0 4px 14px rgba(0,0,0,0.35);
          display:flex;align-items:center;justify-content:center;
          overflow:hidden;
        "><span style="transform:rotate(45deg);font-size:18px;line-height:1">${flag}</span></div>`,
        className: '',
        iconSize:   [40, 40],
        iconAnchor: [20, 40],
      }));
    });
  }, [countryCode, flag]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Map container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Location badge overlay */}
      <AnimatePresence>
        {countryCode && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-500"
          >
            <motion.div
              animate={{ y: [0, -5, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
              className="flex items-center gap-2 bg-brand-near-black text-white rounded-full px-4 py-2.5 text-sm font-semibold shadow-[0_6px_24px_rgba(0,0,0,0.35)] whitespace-nowrap"
            >
              <MapPin className="size-4 shrink-0" />
              <span>{flag} {countryName}</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subtle vignette overlay */}
      <div className="absolute inset-0 pointer-events-none z-400"
          style={{ boxShadow: 'inset 0 0 60px rgba(0,0,0,0.25)' }} />
    </div>
  );
}

// ── Empty state (no country selected) ─────────────────────────

export function MapEmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
      {/* Blueprint dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(10,10,10,0.18) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
      <motion.div
        animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="relative z-10"
      >
        <MapPin className="size-12 text-brand-near-black opacity-30" />
      </motion.div>
      <p className="relative z-10 text-xs text-brand-mid-grey font-medium text-center px-6">
        Select a country to see it on the map
      </p>
    </div>
  );
}
