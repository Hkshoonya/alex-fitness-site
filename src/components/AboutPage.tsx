import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Phone,
  Mail,
  Dumbbell,
  Target,
  Users,
  Heart,
  Trophy,
  Shield,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

interface AboutPageProps {
  onBack: () => void;
  onBooking: () => void;
}

const studioImages = [
  '/images/studio-1.jpg',
  '/images/studio-2.jpg',
  '/images/studio-3.jpg',
  '/images/studio-4.jpg',
  '/images/studio-5.jpg',
  '/images/studio-6.jpg',
  '/images/studio-7.jpg',
  '/images/studio-8.jpg',
  '/images/studio-9.jpg',
  '/images/studio-10.jpg',
  '/images/studio-11.jpg',
  '/images/studio-12.jpg',
];

const timeline = [
  {
    year: 'Early Days',
    title: 'The Spark',
    text: 'Alex discovered his passion for fitness as a Division 1 collegiate wrestler, learning discipline, body mechanics, and the power of structured training.',
    icon: Trophy,
  },
  {
    year: '15+ Years Ago',
    title: 'Coaching Begins',
    text: 'Turned a lifelong obsession into a mission — started coaching clients one-on-one, earning NASM certification as a Personal Trainer and Corrective Exercise Specialist.',
    icon: Target,
  },
  {
    year: 'The Vision',
    title: 'Private Studio Born',
    text: 'Frustrated by crowded gyms and cookie-cutter programs, Alex built a private training studio in Temple Terrace — a space designed for focus, progress, and zero distractions.',
    icon: Dumbbell,
  },
  {
    year: 'Today',
    title: '500+ Lives Changed',
    text: 'A thriving fitness community with hundreds of transformations, 5-star reviews, and a reputation built entirely on real results. The studio has grown with premium equipment and a loyal client base.',
    icon: Heart,
  },
];

const values = [
  {
    icon: Shield,
    title: 'No Judgment Zone',
    text: 'A private studio means no crowds, no intimidation — just you and your coach working toward your goals.',
  },
  {
    icon: Target,
    title: 'Science-Based Training',
    text: 'Every program is built on exercise science, corrective movement patterns, and progressive overload — not trends.',
  },
  {
    icon: Users,
    title: 'Truly Personal',
    text: 'No group classes disguised as personal training. Every session is 1-on-1, every plan is built for you specifically.',
  },
  {
    icon: Heart,
    title: 'Results That Last',
    text: 'We build habits, not dependencies. The goal is to make you stronger, more confident, and self-sufficient.',
  },
];

export default function AboutPage({ onBack, onBooking }: AboutPageProps) {
  const [studioIndex, setStudioIndex] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const valuesRef = useRef<HTMLDivElement>(null);

  const nextStudio = () => setStudioIndex((p) => (p + 1) % studioImages.length);
  const prevStudio = () => setStudioIndex((p) => (p - 1 + studioImages.length) % studioImages.length);

  // Auto-advance studio gallery
  useEffect(() => {
    const timer = setInterval(nextStudio, 3500);
    return () => clearInterval(timer);
  }, []);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // GSAP animations
  useEffect(() => {
    // Hero entrance
    const heroTl = gsap.timeline();
    heroTl
      .fromTo('.about-hero-bg', { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 1.1, ease: 'power2.out' })
      .fromTo('.about-hero-label', { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, 0.15)
      .fromTo('.about-hero-headline', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9 }, 0.25)
      .fromTo('.about-hero-sub', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.55)
      .fromTo('.about-hero-cta', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.7);

    // Timeline items
    if (storyRef.current) {
      gsap.fromTo('.timeline-item',
        { x: -40, opacity: 0 },
        {
          x: 0, opacity: 1, duration: 0.6, stagger: 0.2, ease: 'power2.out',
          scrollTrigger: { trigger: storyRef.current, start: 'top 75%', toggleActions: 'play none none reverse' },
        }
      );
    }

    // Studio section
    if (studioRef.current) {
      gsap.fromTo('.studio-content',
        { y: 50, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.8, ease: 'power2.out',
          scrollTrigger: { trigger: studioRef.current, start: 'top 80%', toggleActions: 'play none none reverse' },
        }
      );
    }

    // Values cards
    if (valuesRef.current) {
      gsap.fromTo('.value-card',
        { y: 30, opacity: 0, scale: 0.95 },
        {
          y: 0, opacity: 1, scale: 1, duration: 0.5, stagger: 0.12, ease: 'back.out(1.4)',
          scrollTrigger: { trigger: valuesRef.current, start: 'top 75%', toggleActions: 'play none none reverse' },
        }
      );
    }

    return () => { ScrollTrigger.getAll().forEach((st) => st.kill()); };
  }, []);

  return (
    <div className="relative bg-[#0B0B0D] min-h-screen">
      <div className="grain-overlay" />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0B0D]/90 backdrop-blur-sm border-b border-white/5">
        <div className="flex items-center justify-between px-6 lg:px-12 py-4">
          <button onClick={onBack} className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm">
            <ArrowLeft size={18} />
            Back to Home
          </button>
          <div className="flex items-center gap-3">
            <div className="logo-shine logo-glow rounded-lg">
              <img src="/images/logo-circle.png" alt="Alex Davis Fitness" className="h-10 w-auto" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-white hidden sm:block">ALEX'S FITNESS</span>
          </div>
          <button onClick={onBooking} className="btn-primary text-xs">Book Now</button>
        </div>
      </nav>

      {/* Hero — studio background */}
      <section ref={heroRef} className="relative min-h-screen flex items-center">
        <div className="absolute inset-0 about-hero-bg">
          <img src="/images/studio-interior.jpg" alt="Alex's Fitness Studio" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
        </div>

        <div className="relative z-10 px-6 lg:px-[6vw] pt-24 pb-16 w-full">
          <div className="max-w-2xl">
            <p className="about-hero-label micro-label text-[#FF4D2E]/80 mb-6">EST. TEMPLE TERRACE, FL</p>
            <h1 className="about-hero-headline headline-xl text-white text-4xl sm:text-6xl lg:text-7xl xl:text-8xl mb-6 break-words">
              MORE THAN<br />A GYM.
            </h1>
            <p className="about-hero-sub text-white/80 text-lg lg:text-xl max-w-lg mb-10">
              A private training studio built on one belief: every person deserves coaching that actually works. No shortcuts. No gimmicks. Just science, sweat, and someone who gives a damn.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 about-hero-cta">
              <button onClick={onBooking} className="btn-primary flex items-center justify-center gap-2">
                <Calendar size={18} />
                Book Your Free Consultation
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Our Story Timeline */}
      <section ref={storyRef} className="relative py-24 px-6 lg:px-[6vw]">
        {/* Blurred ambient background */}
        <div className="absolute inset-0">
          <img src="/images/alex-portrait.jpg" alt="" aria-hidden="true" className="w-full h-full object-cover blur-3xl scale-125 opacity-20" />
          <div className="absolute inset-0 bg-black/70" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="micro-label text-[#FF4D2E]/80 mb-4">THE JOURNEY</p>
            <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-4">OUR STORY.</h2>
            <p className="text-white/60 text-lg max-w-2xl mx-auto">
              From a D1 wrestling mat to a private studio in Temple Terrace — built one client at a time.
            </p>
          </div>

          {/* Timeline */}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-[#FF4D2E] via-white/10 to-transparent hidden md:block" />

            <div className="space-y-12">
              {timeline.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div key={idx} className="timeline-item flex gap-6 md:gap-10">
                    {/* Icon */}
                    <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] flex items-center justify-center relative z-10">
                      <Icon size={24} className="text-[#FF4D2E]" />
                    </div>
                    {/* Content */}
                    <div className="flex-1 bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-2xl p-6 lg:p-8">
                      <p className="text-[#FF4D2E] text-sm font-semibold uppercase tracking-wider mb-1">{item.year}</p>
                      <h3 className="text-white font-display font-bold text-xl mb-3">{item.title}</h3>
                      <p className="text-white/70 leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* The Studio — Then & Now */}
      <section ref={studioRef} className="relative py-24 px-6 lg:px-[6vw] bg-[#0B0B0D]">
        <div className="max-w-6xl mx-auto studio-content">
          <div className="text-center mb-12">
            <p className="micro-label text-[#FF4D2E]/80 mb-4">THE SPACE</p>
            <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-4">THE STUDIO.</h2>
            <p className="text-white/60 text-lg max-w-2xl mx-auto">
              A private, judgment-free training environment designed for one thing — your results.
            </p>
          </div>

          {/* Studio Gallery — large featured image with thumbnails */}
          <div className="relative mb-12">
            {/* Main image with crossfade */}
            <div className="relative aspect-[16/9] rounded-2xl overflow-hidden">
              {studioImages.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt={`Studio view ${i + 1}`}
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                  style={{ opacity: i === studioIndex ? 1 : 0 }}
                />
              ))}
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

              {/* Nav arrows */}
              <button onClick={prevStudio} className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 hover:bg-[#FF4D2E] text-white transition-all backdrop-blur-sm">
                <ChevronLeft size={22} />
              </button>
              <button onClick={nextStudio} className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 hover:bg-[#FF4D2E] text-white transition-all backdrop-blur-sm">
                <ChevronRight size={22} />
              </button>

              {/* Counter */}
              <div className="absolute bottom-4 right-4 text-white/60 text-sm font-mono bg-black/40 backdrop-blur-sm px-3 py-1 rounded-full">
                {String(studioIndex + 1).padStart(2, '0')} / {studioImages.length}
              </div>
            </div>

            {/* Thumbnail strip */}
            <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
              {studioImages.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setStudioIndex(i)}
                  className={`flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden transition-all ${
                    i === studioIndex ? 'ring-2 ring-[#FF4D2E] opacity-100' : 'opacity-40 hover:opacity-70'
                  }`}
                >
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {/* Studio features grid */}
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-xl p-6 text-center">
              <Dumbbell className="text-[#FF4D2E] mx-auto mb-4" size={32} />
              <h3 className="text-white font-display font-bold text-lg mb-2">Premium Equipment</h3>
              <p className="text-white/60 text-sm">Commercial-grade racks, dumbbells, cables, and cardio machines — everything you need, nothing you don't.</p>
            </div>
            <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-xl p-6 text-center">
              <Shield className="text-[#FF4D2E] mx-auto mb-4" size={32} />
              <h3 className="text-white font-display font-bold text-lg mb-2">100% Private</h3>
              <p className="text-white/60 text-sm">No walk-ins, no crowds, no waiting. When you're here, the entire studio is yours.</p>
            </div>
            <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-xl p-6 text-center">
              <MapPin className="text-[#FF4D2E] mx-auto mb-4" size={32} />
              <h3 className="text-white font-display font-bold text-lg mb-2">Temple Terrace</h3>
              <p className="text-white/60 text-sm">Conveniently located at 13305 Sanctuary Cove Dr — easy access from Tampa, USF, and surrounding areas.</p>
            </div>
          </div>
        </div>
      </section>

      {/* What Makes Us Different */}
      <section ref={valuesRef} className="relative py-24 px-6 lg:px-[6vw]">
        <div className="absolute inset-0">
          <img src="/images/studio-interior.jpg" alt="" aria-hidden="true" className="w-full h-full object-cover blur-3xl scale-110 opacity-15" />
          <div className="absolute inset-0 bg-black/70" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="micro-label text-[#FF4D2E]/80 mb-4">OUR PHILOSOPHY</p>
            <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-4">WHY WE'RE DIFFERENT.</h2>
            <p className="text-white/60 text-lg max-w-2xl mx-auto">
              This isn't a franchise. It's a coach-owned studio built on 20 years of real experience.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {values.map((v, idx) => {
              const Icon = v.icon;
              return (
                <div
                  key={idx}
                  className="value-card bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] rounded-2xl p-8 flex gap-5"
                >
                  <div className="w-14 h-14 rounded-xl bg-[#FF4D2E]/10 flex items-center justify-center flex-shrink-0">
                    <Icon size={24} className="text-[#FF4D2E]" />
                  </div>
                  <div>
                    <h3 className="text-white font-display font-bold text-lg mb-2">{v.title}</h3>
                    <p className="text-white/60 leading-relaxed">{v.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Numbers that matter */}
      <section className="py-20 px-6 lg:px-[6vw] bg-[#0B0B0D]">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { num: '20+', label: 'Years Experience' },
            { num: '500+', label: 'Clients Trained' },
            { num: '5.0', label: 'Star Rating' },
            { num: '1-on-1', label: 'Every Session' },
          ].map((s, i) => (
            <div key={i}>
              <p className="text-3xl sm:text-5xl font-bold text-[#FF4D2E] font-display">{s.num}</p>
              <p className="text-white/50 text-sm mt-2 uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Alex's photo + personal message */}
      <section className="relative py-24 px-6 lg:px-[6vw]">
        <div className="absolute inset-0">
          <img src="/images/alex-portrait.jpg" alt="" aria-hidden="true" className="w-full h-full object-cover blur-3xl scale-125 opacity-25" />
          <div className="absolute inset-0 bg-black/60" />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="flex justify-center">
              <img
                src="/images/alex-portrait.jpg"
                alt="Alex Davis"
                className="max-h-[70vh] w-auto object-contain rounded-2xl"
              />
            </div>
            <div>
              <p className="micro-label text-[#FF4D2E]/80 mb-4">FROM ALEX</p>
              <h2 className="headline-xl text-white text-3xl sm:text-4xl lg:text-5xl mb-6">
                A PERSONAL<br />NOTE.
              </h2>
              <div className="space-y-4 text-white/70 text-lg leading-relaxed">
                <p>
                  I built this studio because I believe fitness should be personal. Not a one-size-fits-all program, not a crowded gym where nobody knows your name.
                </p>
                <p>
                  Every client who walks through that door gets my full attention. I learn how your body moves, where your weaknesses are, and what motivates you. Then I build a plan around that — not the other way around.
                </p>
                <p>
                  Whether you're recovering from an injury, training for a goal, or just want to feel strong and confident — this is your space. We got this.
                </p>
              </div>
              <div className="flex items-center gap-4 mt-8">
                <img src="/images/alex-portrait.jpg" alt="" className="w-14 h-14 rounded-full object-cover object-top" />
                <div>
                  <p className="text-white font-semibold">Alex Davis</p>
                  <p className="text-white/50 text-sm">Founder & Head Coach</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative min-h-[60vh] flex items-center">
        <div className="absolute inset-0">
          <img src="/images/studio-1.jpg" alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/70" />
        </div>
        <div className="relative z-10 px-6 lg:px-[6vw] w-full text-center">
          <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-4">READY TO START?</h2>
          <p className="text-white/70 text-lg mb-10 max-w-xl mx-auto">
            Your first consultation is free. No pressure, no commitment — just a conversation about your goals.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={onBooking} className="btn-primary flex items-center justify-center gap-2">
              <Calendar size={18} />
              Book Your Free Consultation
            </button>
            <a href="tel:8134210633" className="text-white font-semibold text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:text-[#FF4D2E] transition-colors">
              <Phone size={18} />
              Call (813) 421-0633
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0B0B0D] py-12 px-6 lg:px-[6vw] border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex flex-col items-center gap-2 mb-2">
            <div className="logo-shine logo-glow rounded-lg">
              <img src="/images/logo-circle.png" alt="Alex Davis Fitness" className="h-14 w-auto" />
            </div>
            <p className="font-display font-bold text-2xl text-white">ALEX'S FITNESS</p>
          </div>
          <p className="text-white/40 text-sm mb-6">13305 Sanctuary Cove Dr · Temple Terrace, FL 33637</p>
          <div className="flex justify-center gap-6 text-white/40 text-sm">
            <a href="tel:8134210633" className="hover:text-white transition-colors flex items-center gap-1">
              <Phone size={14} /> (813) 421-0633
            </a>
            <a href="mailto:alexdavisfit@gmail.com" className="hover:text-white transition-colors flex items-center gap-1">
              <Mail size={14} /> alexdavisfit@gmail.com
            </a>
          </div>
          <div className="mt-8">
            <button onClick={onBack} className="text-white/40 hover:text-white text-sm transition-colors flex items-center gap-1 mx-auto">
              <ArrowLeft size={14} /> Back to Home
            </button>
          </div>
          <p className="text-white/20 text-xs mt-6">
            &copy; {new Date().getFullYear()} Alex's Fitness Training. All rights reserved.
          </p>

          {/* Built By DocZeus */}
          <div className="mt-6 pt-4 border-t border-white/5">
            <a
              href="https://github.com/Hkshoonya"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-col items-center gap-2 text-white/20 hover:text-white/40 transition-colors group"
            >
              <span className="text-[10px] uppercase tracking-[0.2em]">Built by</span>
              <svg viewBox="0 0 200 48" width="100" height="24" aria-label="DocZeus" className="opacity-40 group-hover:opacity-70 transition-opacity">
                <rect x="2" y="8" width="32" height="32" rx="8" fill="none" stroke="#FF4D2E" strokeWidth="3"/>
                <circle cx="18" cy="24" r="6" fill="#FF4D2E"/>
                <text x="40" y="34" fontFamily="system-ui, -apple-system, sans-serif" fontSize="28" fontWeight="bold" fill="currentColor" letterSpacing="1">oczeus</text>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
