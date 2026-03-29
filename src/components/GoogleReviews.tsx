import { useEffect, useState, useCallback } from 'react';
import { Star, MapPin, ExternalLink, ChevronLeft, ChevronRight, Quote, RefreshCw } from 'lucide-react';
import {
  getReviews,
  refreshReviews,
  getReviewCacheStatus,
  getGoogleReviewsUrl,

  type GoogleReview,
} from '@/api/reviews';

export default function GoogleReviews() {
  const [reviews, setReviews] = useState<GoogleReview[]>([]);
  const [currentReview, setCurrentReview] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  // Load reviews on mount
  useEffect(() => {
    loadReviews();
  }, []);

  const loadReviews = async () => {
    const data = await getReviews();
    setReviews(data);
    const status = getReviewCacheStatus();
    setLastFetched(status.lastFetched);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    const data = await refreshReviews();
    setReviews(data);
    const status = getReviewCacheStatus();
    setLastFetched(status.lastFetched);
    setIsRefreshing(false);
  };

  const goToReview = useCallback((index: number) => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrentReview(index);
    setTimeout(() => setIsAnimating(false), 400);
  }, [isAnimating]);

  const nextReview = useCallback(() => {
    if (reviews.length === 0) return;
    goToReview((currentReview + 1) % reviews.length);
  }, [currentReview, reviews.length, goToReview]);

  // Auto-advance every 6 seconds
  useEffect(() => {
    if (reviews.length === 0) return;
    const interval = setInterval(nextReview, 6000);
    return () => clearInterval(interval);
  }, [nextReview, reviews.length]);

  const prevReview = () => {
    if (reviews.length === 0) return;
    goToReview((currentReview - 1 + reviews.length) % reviews.length);
  };

  if (reviews.length === 0) return null;

  const review = reviews[currentReview];
  const googleUrl = getGoogleReviewsUrl();

  return (
    <div>
      {/* Rating Summary Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-10 bg-white/5 rounded-xl p-5">
        <div className="flex items-center gap-4">
          {/* Google "G" icon */}
          <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold" style={{
              background: 'linear-gradient(135deg, #4285F4 25%, #EA4335 25%, #EA4335 50%, #FBBC05 50%, #FBBC05 75%, #34A853 75%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>G</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold text-white">5.0</span>
              <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={20} className="text-yellow-400 fill-yellow-400" />
                ))}
              </div>
            </div>
            <p className="text-white/50 text-sm">
              Showing {reviews.length} five-star reviews
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Last updated indicator */}
          {lastFetched && (
            <span className="text-white/30 text-xs hidden sm:block">
              Updated {new Date(lastFetched).toLocaleDateString()}
            </span>
          )}

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Check for new reviews"
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>

          {/* See all on Google */}
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-[#FF4D2E] hover:underline"
          >
            <MapPin size={14} />
            See all reviews on Google
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      {/* Featured Review Card */}
      <div className="relative">
        <button
          onClick={prevReview}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/5 hover:bg-[#FF4D2E] text-white transition-all -translate-x-1/2"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          onClick={() => nextReview()}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/5 hover:bg-[#FF4D2E] text-white transition-all translate-x-1/2"
        >
          <ChevronRight size={22} />
        </button>

        <div
          className={`bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 md:p-10 transition-all duration-400 ${
            isAnimating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
          }`}
        >
          <Quote size={36} className="text-[#FF4D2E]/30 mb-4" />

          <p className="text-white/90 text-lg md:text-xl leading-relaxed mb-6 italic">
            "{review.text}"
          </p>

          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className="w-12 h-12 rounded-full bg-[#FF4D2E]/20 flex items-center justify-center overflow-hidden">
                {review.profilePhoto ? (
                  <img src={review.profilePhoto} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[#FF4D2E] font-bold text-lg">
                    {review.name.charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <p className="text-white font-semibold">{review.name}</p>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} size={14} className="text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <span className="text-white/40 text-sm">· {review.relativeTime}</span>
                </div>
              </div>
            </div>

            {/* Source badge */}
            <span className="text-[10px] text-white/30 bg-white/5 px-2 py-1 rounded capitalize">
              {review.source}
            </span>
          </div>
        </div>
      </div>

      {/* Review Dots */}
      <div className="flex justify-center gap-2 mt-6">
        {reviews.map((_, i) => (
          <button
            key={i}
            onClick={() => goToReview(i)}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i === currentReview
                ? 'bg-[#FF4D2E] w-6'
                : 'bg-white/20 hover:bg-white/40'
            }`}
          />
        ))}
      </div>

      {/* Mini review cards — show 3 others */}
      <div className="grid md:grid-cols-3 gap-4 mt-10">
        {reviews
          .filter((_, i) => i !== currentReview)
          .slice(0, 3)
          .map((r, idx) => (
            <div
              key={r.id || idx}
              onClick={() => goToReview(reviews.indexOf(r))}
              className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5 cursor-pointer hover:border-[#FF4D2E]/20 transition-all group"
            >
              <div className="flex items-center gap-0.5 mb-3">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={14} className="text-yellow-400 fill-yellow-400" />
                ))}
              </div>
              <p className="text-white/70 text-sm line-clamp-3 mb-3 group-hover:text-white/90 transition-colors">
                "{r.text}"
              </p>
              <div className="flex items-center justify-between">
                <span className="text-white/50 text-sm font-medium">{r.name}</span>
                <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded capitalize">{r.source}</span>
              </div>
            </div>
          ))}
      </div>

      {/* "See all reviews" link */}
      <div className="text-center mt-8">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-white/50 hover:text-[#FF4D2E] text-sm transition-colors"
        >
          See all reviews on Google Maps
          <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}
