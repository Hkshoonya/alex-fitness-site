import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { asset } from '@/lib/assets';
import { getTransformations, type Transformation } from '@/api/transformations';

// Fallback gallery — used when no admin uploads exist. Once Alex
// uploads via the admin Transformations tab, those take over (newest
// first). Keeps the section populated during the first-upload window.
const DEFAULT_TRANSFORMATIONS = [
  asset('/images/transform-1.jpg'),
  asset('/images/transform-2.jpg'),
  asset('/images/transform-3.jpg'),
  asset('/images/transform-4.jpg'),
  asset('/images/transform-5.jpg'),
  asset('/images/transform-6.jpg'),
  asset('/images/transform-7.jpg'),
  asset('/images/transform-8.jpg'),
  asset('/images/transform-9.jpg'),
  asset('/images/transform-10.jpg'),
  asset('/images/transform-11.jpg'),
  asset('/images/transform-12.jpg'),
];

export default function TransformationGallery() {
  const [current, setCurrent] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [adminTransformations, setAdminTransformations] = useState<Transformation[]>([]);

  // Fetch admin-uploaded transformations on mount. Empty/error → fallback
  // to bundled defaults so the section never goes blank.
  useEffect(() => {
    let cancelled = false;
    getTransformations()
      .then(list => {
        if (!cancelled && list.length > 0) {
          setAdminTransformations(list);
          setCurrent(0); // reset cursor when source array changes
        }
      })
      .catch(() => { /* silent fallback */ });
    return () => { cancelled = true; };
  }, []);

  // Admin uploads take priority — newest first (worker order). Otherwise
  // fall back to bundled defaults.
  const transformations = useMemo(
    () => (adminTransformations.length > 0
      ? adminTransformations.map(t => t.dataUrl)
      : DEFAULT_TRANSFORMATIONS),
    [adminTransformations],
  );

  const goTo = useCallback((index: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrent(index);
    setTimeout(() => setIsTransitioning(false), 600);
  }, [isTransitioning]);

  const next = useCallback(() => {
    goTo((current + 1) % transformations.length);
  }, [current, goTo, transformations.length]);

  const prev = useCallback(() => {
    goTo((current - 1 + transformations.length) % transformations.length);
  }, [current, goTo, transformations.length]);

  // Auto-advance every 4 seconds. transformations.length is captured by
  // the `next` callback dependency above so the interval recreates if
  // admin photos load mid-session and shrink the array.
  useEffect(() => {
    if (transformations.length <= 1) return;
    const timer = setInterval(next, 4000);
    return () => clearInterval(timer);
  }, [next, transformations.length]);

  return (
    <>
      {/* Solid black base behind images */}
      <div className="absolute inset-0 bg-black" />

      {/* Background images - stacked with crossfade */}
      {transformations.map((src, i) => (
        <div
          key={i}
          className="absolute inset-0 flex items-center justify-center transition-opacity duration-700 ease-in-out"
          style={{ opacity: i === current ? 1 : 0 }}
        >
          {/* Blurred background fill so no black bars show */}
          <img
            src={src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40"
          />
          {/* Main image — fully visible, no cropping */}
          <img
            src={src}
            alt={`Client transformation ${i + 1}`}
            className="relative z-[1] max-w-full max-h-full object-contain"
            style={{ maxHeight: '100vh' }}
          />
        </div>
      ))}

      {/* Dark overlay — lighter so image stays sharp */}
      <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/50 via-black/30 to-black/60" />

      {/* Navigation arrows */}
      <button
        onClick={prev}
        className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/50 hover:bg-[#FF4D2E] text-white transition-all backdrop-blur-sm border border-white/10"
      >
        <ChevronLeft size={24} />
      </button>
      <button
        onClick={next}
        className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black/50 hover:bg-[#FF4D2E] text-white transition-all backdrop-blur-sm border border-white/10"
      >
        <ChevronRight size={24} />
      </button>

      {/* Dot indicators */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-2">
        {transformations.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === current
                ? 'bg-[#FF4D2E] w-6'
                : 'bg-white/40 w-2 hover:bg-white/60'
            }`}
          />
        ))}
      </div>

      {/* Counter */}
      <div className="absolute bottom-8 right-6 md:right-10 z-20 text-white/50 text-sm font-mono">
        {String(current + 1).padStart(2, '0')} / {transformations.length}
      </div>
    </>
  );
}
