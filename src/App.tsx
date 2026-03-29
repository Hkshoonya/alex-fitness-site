import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { asset } from '@/lib/assets';
import { 
  Menu, 
  X, 
  Phone, 
  Mail, 
  MapPin, 
  Clock, 
  Instagram,
  ChevronRight,
  Dumbbell,
  Users,
  Target,
  Calendar,
  CreditCard
} from 'lucide-react';
import { useState } from 'react';
import BookingModal from '@/components/BookingModal';
import TrainingPlansShop from '@/components/TrainingPlansShop';
import PostPurchaseBooking from '@/components/PostPurchaseBooking';
import TransformationGallery from '@/components/TransformationGallery';
import GoogleReviews from '@/components/GoogleReviews';
import AboutPage from '@/components/AboutPage';
import QuickMessageModal from '@/components/QuickMessageModal';
import CoachSection from '@/components/CoachSection';
import ChallengesSection from '@/components/ChallengesSection';
import type { TrainingPlan, Trainer } from '@/data/trainingPlans';

gsap.registerPlugin(ScrollTrigger);

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookNowModalOpen, setBookNowModalOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [postPurchaseOpen, setPostPurchaseOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [purchasedPlan, setPurchasedPlan] = useState<TrainingPlan | undefined>();
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | undefined>();
  const heroRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLDivElement>(null);
  const plansRef = useRef<HTMLDivElement>(null);
  const studioRef = useRef<HTMLDivElement>(null);
  const transformationsRef = useRef<HTMLDivElement>(null);
  const coachRef = useRef<HTMLDivElement>(null);
  const testimonialsRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Hero entrance animation
    const heroTl = gsap.timeline();
    heroTl
      .fromTo('.hero-bg', 
        { opacity: 0, scale: 1.06 }, 
        { opacity: 1, scale: 1, duration: 1.1, ease: 'power2.out' }
      )
      .fromTo('.hero-label', 
        { y: -12, opacity: 0 }, 
        { y: 0, opacity: 1, duration: 0.5 }, 
        0.15
      )
      .fromTo('.hero-headline', 
        { y: 40, opacity: 0 }, 
        { y: 0, opacity: 1, duration: 0.9 }, 
        0.25
      )
      .fromTo('.hero-subheadline', 
        { y: 18, opacity: 0 }, 
        { y: 0, opacity: 1, duration: 0.6 }, 
        0.55
      )
      .fromTo('.hero-cta', 
        { y: 18, opacity: 0 }, 
        { y: 0, opacity: 1, duration: 0.6 }, 
        0.7
      )
      .fromTo('.hero-scroll', 
        { opacity: 0 }, 
        { opacity: 1, duration: 0.4 }, 
        1.0
      );

    // Scroll-driven animations for sections
    const sections = [
      { ref: valueRef, class: 'value' },
      { ref: plansRef, class: 'plans' },
      { ref: studioRef, class: 'studio' },
      { ref: transformationsRef, class: 'transformations' },
      { ref: coachRef, class: 'coach' },
      { ref: bookRef, class: 'book' },
    ];

    sections.forEach(({ ref, class: className }) => {
      if (ref.current) {
        gsap.fromTo(`.${className}-content`,
          { y: 60, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: ref.current,
              start: 'top 80%',
              end: 'top 30%',
              toggleActions: 'play none none reverse',
            }
          }
        );
      }
    });

    // Coach section — hero-style staggered entrance
    if (coachRef.current) {
      // Background fade in
      gsap.fromTo('.coach-bg',
        { opacity: 0 },
        {
          opacity: 1,
          duration: 1.2,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 80%',
            toggleActions: 'play none none reverse',
          }
        }
      );

      // Photo reveal
      gsap.fromTo('.coach-photo',
        { x: -60, opacity: 0, scale: 0.95 },
        {
          x: 0,
          opacity: 1,
          scale: 1,
          duration: 1,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 75%',
            toggleActions: 'play none none reverse',
          }
        }
      );

      // Label
      gsap.fromTo('.coach-label',
        { y: -12, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.5,
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 70%',
            toggleActions: 'play none none reverse',
          }
        }
      );

      // Headline
      gsap.fromTo('.coach-headline',
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 70%',
            toggleActions: 'play none none reverse',
          }
        }
      );

      // Subtitle
      gsap.fromTo('.coach-sub',
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          delay: 0.15,
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 70%',
            toggleActions: 'play none none reverse',
          }
        }
      );

      // Stats — pop in with bounce
      gsap.fromTo('.coach-stat',
        { y: 30, opacity: 0, scale: 0.85 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.6,
          stagger: 0.12,
          ease: 'back.out(1.7)',
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 60%',
            toggleActions: 'play none none reverse',
          }
        }
      );

      // Credentials — slide in from right
      gsap.fromTo('.coach-credential',
        { x: 80, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.5,
          stagger: 0.1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 55%',
            toggleActions: 'play none none reverse',
          }
        }
      );

      // CTA button
      gsap.fromTo('.coach-cta',
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.5,
          scrollTrigger: {
            trigger: coachRef.current,
            start: 'top 50%',
            toggleActions: 'play none none reverse',
          }
        }
      );
    }

    // Testimonials animation
    if (testimonialsRef.current) {
      gsap.fromTo('.testimonial-card',
        { x: -60, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.15,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: testimonialsRef.current,
            start: 'top 80%',
            toggleActions: 'play none none reverse',
          }
        }
      );
    }

    return () => {
      ScrollTrigger.getAll().forEach(st => st.kill());
    };
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setMobileMenuOpen(false);
    }
  };

  const handlePurchaseComplete = (plan: TrainingPlan, trainer: Trainer) => {
    setPurchasedPlan(plan);
    setSelectedTrainer(trainer);
    setShopOpen(false);
    setPostPurchaseOpen(true);
  };

  if (showAbout) {
    return (
      <>
        <AboutPage
          onBack={() => { setShowAbout(false); window.scrollTo(0, 0); }}
          onBooking={() => setBookingModalOpen(true)}
        />
        <BookingModal isOpen={bookingModalOpen} onClose={() => setBookingModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="relative bg-[#0B0B0D] min-h-screen">
      {/* Grain overlay */}
      <div className="grain-overlay" />
      
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0B0B0D]/90 backdrop-blur-sm border-b border-white/5">
        <div className="flex items-center justify-between px-6 lg:px-12 py-4">
          {/* Logo */}
          <button onClick={() => scrollToSection('hero')} className="flex items-center gap-3 group">
            <div className="logo-shine logo-glow rounded-lg">
              <img src={asset("/images/logo-circle.png")} alt="Alex Davis Fitness" className="h-10 w-auto group-hover:scale-105 transition-transform" />
            </div>
            <span className="font-display font-bold text-xl tracking-tight text-white hidden sm:block">ALEX'S FITNESS</span>
          </button>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-8">
            <button onClick={() => scrollToSection('plans')} className="text-sm text-white/80 hover:text-white transition-colors">
              Training
            </button>
            <button onClick={() => scrollToSection('studio')} className="text-sm text-white/80 hover:text-white transition-colors">
              Studio
            </button>
            <button onClick={() => scrollToSection('transformations')} className="text-sm text-white/80 hover:text-white transition-colors">
              Results
            </button>
            <button onClick={() => setShowAbout(true)} className="text-sm text-white/80 hover:text-white transition-colors">
              About
            </button>
            <a href="https://www.instagram.com/alexdavisfit/reels/" target="_blank" rel="noopener noreferrer" className="text-sm text-white/80 hover:text-white transition-colors flex items-center gap-1">
              <Instagram size={16} />
            </a>
            <button onClick={() => setBookNowModalOpen(true)} className="btn-primary text-xs">
              Book Now
            </button>
          </div>

          {/* Mobile menu button */}
          <button
            className="lg:hidden text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-[#0B0B0D] border-t border-white/10 px-6 py-6">
            <div className="flex flex-col gap-4">
              <button onClick={() => scrollToSection('plans')} className="text-left text-white/80 py-2">Training</button>
              <button onClick={() => scrollToSection('studio')} className="text-left text-white/80 py-2">Studio</button>
              <button onClick={() => scrollToSection('transformations')} className="text-left text-white/80 py-2">Results</button>
              <button onClick={() => { setShowAbout(true); setMobileMenuOpen(false); }} className="text-left text-white/80 py-2">About</button>
              <a href="https://www.instagram.com/alexdavisfit/reels/" target="_blank" rel="noopener noreferrer" className="text-white/80 py-2 flex items-center gap-2">
                <Instagram size={18} /> Follow on Instagram
              </a>
              <button onClick={() => { setBookNowModalOpen(true); setMobileMenuOpen(false); }} className="btn-primary text-xs w-fit mt-2">Book Now</button>
            </div>
          </div>
        )}
      </nav>

      {/* Section 1: Hero */}
      <section id="hero" ref={heroRef} className="relative min-h-screen flex items-center">
        {/* Background image */}
        <div className="absolute inset-0 hero-bg">
          <img 
            src={asset("/images/hero-lifting.jpg")}
            alt="Athlete lifting weights" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
        </div>

        {/* Content */}
        <div className="relative z-10 px-6 lg:px-[6vw] pt-24 pb-16 w-full">
          <div className="max-w-2xl">
            <p className="micro-label text-white/70 mb-6 hero-label">
              PERSONAL TRAINING • TEMPLE TERRACE
            </p>
            <h1 className="headline-xl text-white text-4xl sm:text-6xl lg:text-7xl xl:text-8xl mb-6 hero-headline break-words">
              BE THE BEST YOU.
            </h1>
            <p className="text-white/80 text-lg lg:text-xl max-w-lg mb-10 hero-subheadline">
              1-on-1 coaching for strength, fat loss, and real confidence—built around your schedule.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 hero-cta">
              <button onClick={() => setBookingModalOpen(true)} className="btn-primary flex items-center justify-center gap-2">
                <Calendar size={18} />
                Book Your Free Consultation
              </button>
              <button onClick={() => scrollToSection('plans')} className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2 hover:text-[#FF4D2E] transition-colors">
                View Training Plans
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/50 text-sm hero-scroll hidden lg:block">
          Scroll to explore
        </div>
      </section>

      {/* Section 2: Stronger Body, Stronger Mind */}
      <section ref={valueRef} className="relative min-h-screen flex items-center">
        <div className="absolute inset-0">
          <img 
            src={asset("/images/value-seated.jpg")}
            alt="Athlete with dumbbell" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-l from-black/80 via-black/40 to-transparent" />
        </div>

        <div className="relative z-10 px-6 lg:px-[6vw] py-24 w-full">
          <div className="flex justify-end">
            <div className="max-w-xl text-right value-content">
              <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-6">
                STRONGER BODY,<br />STRONGER MIND.
              </h2>
              <p className="text-white/70 text-lg mb-8">
                Train with a plan that adapts to you—form coaching, accountability, and pacing that protects your joints and builds real strength.
              </p>
              <button onClick={() => scrollToSection('plans')} className="text-[#FF4D2E] font-semibold text-sm uppercase tracking-wider link-underline">
                See How It Works
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Training Plans */}
      <section id="plans" ref={plansRef} className="relative min-h-screen flex items-center">
        <div className="absolute inset-0">
          <img 
            src={asset("/images/plans-dumbbells.jpg")}
            alt="Athlete with dumbbells" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/60" />
        </div>

        <div className="relative z-10 px-6 lg:px-[6vw] py-24 w-full">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="plans-content">
              <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-4">
                TRAINING PLANS
              </h2>
              <p className="text-white/70 text-lg mb-8">
                Choose the format that fits your schedule—both built for results.
              </p>
              <button 
                onClick={() => setShopOpen(true)}
                className="btn-primary flex items-center gap-2"
              >
                <CreditCard size={18} />
                View All Plans & Pricing
              </button>
            </div>

            <div className="space-y-6">
              {/* Personal Training Card */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-lg animate-float plans-content">
                <div className="flex items-center gap-3 mb-4">
                  <Dumbbell className="text-[#FF4D2E]" size={28} />
                  <h3 className="font-display font-bold text-xl text-white">Personal Training</h3>
                </div>
                <p className="text-white/70 mb-6">
                  In-studio sessions with hands-on coaching, form checks, and progressive programming.
                </p>
                <button onClick={() => setBookingModalOpen(true)} className="btn-primary text-xs">
                  Book In-Studio
                </button>
              </div>

              {/* Virtual Training Card */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-lg animate-float-delayed plans-content">
                <div className="flex items-center gap-3 mb-4">
                  <Target className="text-[#FF4D2E]" size={28} />
                  <h3 className="font-display font-bold text-xl text-white">Virtual Training</h3>
                </div>
                <p className="text-white/70 mb-6">
                  Live video coaching, real-time feedback, and a plan you can follow anywhere.
                </p>
                <button onClick={() => setBookingModalOpen(true)} className="btn-primary text-xs">
                  Start Virtual
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Private Training Studio */}
      <section id="studio" ref={studioRef} className="relative min-h-screen flex items-center">
        <div className="absolute inset-0">
          <img 
            src={asset("/images/studio-interior.jpg")}
            alt="Alex's private training studio" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        </div>

        <div className="relative z-10 px-6 lg:px-[6vw] py-24 w-full">
          <div className="max-w-xl studio-content">
            <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-6">
              PRIVATE TRAINING STUDIO.
            </h2>
            <p className="text-white/70 text-lg mb-8">
              No crowds. No waiting for equipment. Just you, your coach, and a plan that evolves with you.
            </p>
            <button onClick={() => scrollToSection('book')} className="text-[#FF4D2E] font-semibold text-sm uppercase tracking-wider link-underline">
              See the Studio
            </button>
          </div>
        </div>
      </section>

      {/* Section 5: Client Transformations */}
      <section id="transformations" ref={transformationsRef} className="relative min-h-screen flex items-center">
        <TransformationGallery />

        <div className="relative z-10 px-6 lg:px-[6vw] py-24 w-full text-center">
          <div className="max-w-3xl mx-auto transformations-content">
            <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-4">
              CLIENT TRANSFORMATIONS.
            </h2>
            <p className="text-white/70 text-lg mb-10">
              Real people. Real progress. Built session by session.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button onClick={() => setBookingModalOpen(true)} className="btn-primary flex items-center justify-center gap-2">
                <Users size={18} />
                Start Your Transformation
              </button>
              <button onClick={() => scrollToSection('testimonials')} className="text-white font-semibold text-sm uppercase tracking-wider flex items-center justify-center gap-2 hover:text-[#FF4D2E] transition-colors">
                View Client Reviews
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 6: Meet Your Coach */}
      <section ref={coachRef} className="relative min-h-screen flex items-center overflow-hidden">
        <CoachSection
          onBookCall={() => setMessageModalOpen(true)}
          onBookMeeting={() => setBookingModalOpen(true)}
        />
      </section>

      {/* Section 7: Reviews */}
      <section id="testimonials" ref={testimonialsRef} className="relative py-24 px-6 lg:px-[6vw] overflow-hidden">
        <div className="absolute inset-0">
          <img src={asset("/images/alex-portrait.jpg")} alt="" aria-hidden="true" className="w-full h-full object-cover blur-3xl scale-125 opacity-50" style={{ objectPosition: 'center 18%' }} />
          <div className="absolute inset-0 bg-black/60" />
        </div>
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="text-center mb-4">
            <p className="micro-label text-[#FF4D2E]/80 mb-4">CLIENT REVIEWS</p>
            <h2 className="headline-xl text-white text-3xl sm:text-5xl break-words mb-4">WHAT CLIENTS SAY</h2>
            <p className="text-white/60 mb-12">Honest feedback from real sessions.</p>
          </div>

          {/* Real client success photo */}
          <div className="mb-12 rounded-xl overflow-hidden">
            <img
              src={asset("/images/alex-with-client.jpg")}
              alt="Alex with June 2024 Fitness Challenge Winner"
              className="w-full h-auto object-cover"
            />
          </div>

          <GoogleReviews />
        </div>
      </section>

      {/* Challenges */}
      <ChallengesSection onBooking={() => setBookingModalOpen(true)} />

      {/* Section 8: Book Your Session */}
      <section id="book" ref={bookRef} className="relative min-h-screen flex items-center">
        <div className="absolute inset-0">
          <img
            src={asset("/images/book-lifting.jpg")}
            alt="Athlete lifting"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
        </div>

        <div className="relative z-10 px-6 lg:px-[6vw] py-24 w-full">
          <div className="max-w-2xl book-content">
            <p className="micro-label text-white/70 mb-6">READY WHEN YOU ARE</p>
            <h2 className="headline-xl text-white text-3xl sm:text-5xl lg:text-6xl break-words mb-6">
              LET'S GET STARTED.
            </h2>
            <p className="text-white/70 text-lg mb-10">
              Tell me your goals. I'll map the first 4 weeks—no guesswork.
            </p>

            {/* Two options */}
            <div className="grid sm:grid-cols-2 gap-4">
              {/* Book Free Call */}
              <button
                onClick={() => setMessageModalOpen(true)}
                className="bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-2xl p-6 text-left hover:border-[#FF4D2E]/30 hover:bg-white/[0.09] transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-[#FF4D2E]/20 flex items-center justify-center mb-4 group-hover:bg-[#FF4D2E] transition-colors">
                  <Phone size={22} className="text-[#FF4D2E] group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-white font-display font-bold text-lg mb-2">Book a Free Call</h3>
                <p className="text-white/50 text-sm">
                  Send Alex a message — he'll text you back to set up a quick call.
                </p>
              </button>

              {/* Meet Me */}
              <button
                onClick={() => setBookingModalOpen(true)}
                className="bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] rounded-2xl p-6 text-left hover:border-[#FF4D2E]/30 hover:bg-white/[0.09] transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-[#FF4D2E]/20 flex items-center justify-center mb-4 group-hover:bg-[#FF4D2E] transition-colors">
                  <Calendar size={22} className="text-[#FF4D2E] group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-white font-display font-bold text-lg mb-2">Meet Me</h3>
                <p className="text-white/50 text-sm">
                  Book a free 30-min consultation — in-studio or virtual.
                </p>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Section 9: Location & Hours */}
      <section className="bg-[#6B6B6B] py-24 px-6 lg:px-[6vw]">
        <div className="max-w-6xl mx-auto">
          <h2 className="headline-xl text-white text-3xl sm:text-5xl break-words mb-12">LOCATION & HOURS</h2>

          <div className="grid lg:grid-cols-2 gap-12">
            {/* Map & Address */}
            <div>
              <div className="bg-white/10 rounded-lg overflow-hidden mb-6">
                <img 
                  src={asset("/images/map-static.jpg")}
                  alt="Location map" 
                  className="w-full h-64 object-cover"
                />
              </div>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="text-[#FF4D2E] mt-1 flex-shrink-0" size={20} />
                  <div>
                    <p className="text-white font-semibold">Alex Davis Fitness</p>
                    <p className="text-white/70">13305 Sanctuary Cove Dr</p>
                    <p className="text-white/70">Temple Terrace, FL 33637</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="text-[#FF4D2E] flex-shrink-0" size={20} />
                  <a href="tel:8134210633" className="text-white/70 hover:text-white transition-colors">
                    (813) 421-0633
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="text-[#FF4D2E] flex-shrink-0" size={20} />
                  <a href="mailto:alexdavisfit@gmail.com" className="text-white/70 hover:text-white transition-colors">
                    alexdavisfit@gmail.com
                  </a>
                </div>
                <a 
                  href="https://www.google.com/maps/dir/?api=1&destination=13305+Sanctuary+Cove+Dr+Temple+Terrace+FL+33637"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary text-xs inline-flex mt-4"
                >
                  <MapPin size={16} className="mr-2" />
                  Get Directions
                </a>
              </div>
            </div>

            {/* Hours */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <Clock className="text-[#FF4D2E]" size={24} />
                <h3 className="font-display font-bold text-xl text-white">Business Hours</h3>
              </div>
              <div className="space-y-3">
                {[
                  { day: 'Monday', hours: '7:30 am - 8:00 pm' },
                  { day: 'Tuesday', hours: '7:30 am - 8:00 pm' },
                  { day: 'Wednesday', hours: '7:30 am - 8:00 pm' },
                  { day: 'Thursday', hours: '7:30 am - 8:00 pm' },
                  { day: 'Friday', hours: '7:30 am - 8:00 pm' },
                  { day: 'Saturday', hours: '9:00 am - 6:00 pm' },
                  { day: 'Sunday', hours: '9:00 am - 6:00 pm' },
                ].map(({ day, hours }) => (
                  <div key={day} className="flex justify-between py-2 border-b border-white/10">
                    <span className="text-white">{day}</span>
                    <span className="text-white/70">{hours}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 10: Footer */}
      <footer className="bg-[#0B0B0D] py-16 px-6 lg:px-[6vw]">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex flex-col items-center gap-3 mb-4">
            <div className="logo-shine logo-glow rounded-lg">
              <img src={asset("/images/logo-circle.png")} alt="Alex Davis Fitness" className="h-16 w-auto" />
            </div>
            <h2 className="font-display font-bold text-3xl sm:text-4xl text-white">ALEX'S FITNESS</h2>
          </div>
          <p className="text-white/60 mb-8">Be the best you.</p>
          
          <button onClick={() => setBookingModalOpen(true)} className="btn-primary mb-12">
            Book Now
          </button>

          <div className="flex flex-wrap justify-center gap-6 mb-12">
            <button onClick={() => scrollToSection('plans')} className="text-white/60 hover:text-white text-sm transition-colors">Training</button>
            <button onClick={() => scrollToSection('studio')} className="text-white/60 hover:text-white text-sm transition-colors">Studio</button>
            <button onClick={() => scrollToSection('transformations')} className="text-white/60 hover:text-white text-sm transition-colors">Results</button>
            <button onClick={() => setShowAbout(true)} className="text-white/60 hover:text-white text-sm transition-colors">About</button>
            <button onClick={() => scrollToSection('book')} className="text-white/60 hover:text-white text-sm transition-colors">Contact</button>
            <a
              href="https://www.instagram.com/alexdavisfit/reels/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/60 hover:text-white text-sm flex items-center gap-1 transition-colors"
            >
              <Instagram size={16} />
              @alexdavisfit
            </a>
          </div>

          {/* Accepted Payment Methods */}
          <div className="flex items-center justify-center gap-2 mb-8 flex-wrap">
            {/* Visa */}
            <div className="bg-white/[0.06] border border-white/[0.06] rounded px-2.5 py-1.5">
              <svg viewBox="0 0 48 32" width="36" height="24" fill="none"><rect width="48" height="32" rx="4" fill="#1A1F71"/><path d="M19.5 21h-3l1.9-10h3l-1.9 10zm12.4-9.7c-.6-.2-1.5-.5-2.7-.5-3 0-5 1.5-5 3.7 0 1.6 1.5 2.5 2.6 3 1.1.6 1.5 1 1.5 1.5 0 .8-1 1.2-1.8 1.2-1.2 0-1.9-.2-2.9-.6l-.4-.2-.4 2.5c.7.3 2 .6 3.4.6 3.2 0 5.2-1.5 5.2-3.8 0-1.3-.8-2.3-2.5-3.1-1-.5-1.7-.9-1.7-1.4 0-.5.5-1 1.7-1 1 0 1.7.2 2.2.4l.3.1.5-2.4zM37 11h-2.3c-.7 0-1.3.2-1.6 1l-4.5 9.5h3.2l.6-1.7h3.9l.4 1.7H40L37 11zm-3.8 6.5l1.6-4.2.9 4.2h-2.5zM17 11l-3 7-.3-1.5c-.5-1.8-2.2-3.7-4-4.7l2.7 9.7h3.2l4.8-10.5H17z" fill="#fff"/><path d="M12 12.5c-.2-.7-.7-.9-1.4-.9H6.1L6 12c3.6.9 6 3 7 5.5l-1-5z" fill="#F9A533"/></svg>
            </div>
            {/* Mastercard */}
            <div className="bg-white/[0.06] border border-white/[0.06] rounded px-2.5 py-1.5">
              <svg viewBox="0 0 48 32" width="36" height="24" fill="none"><rect width="48" height="32" rx="4" fill="#252525"/><circle cx="19" cy="16" r="8" fill="#EB001B"/><circle cx="29" cy="16" r="8" fill="#F79E1B"/><path d="M24 9.8a8 8 0 010 12.4 8 8 0 000-12.4z" fill="#FF5F00"/></svg>
            </div>
            {/* Amex */}
            <div className="bg-white/[0.06] border border-white/[0.06] rounded px-2.5 py-1.5">
              <svg viewBox="0 0 48 32" width="36" height="24" fill="none"><rect width="48" height="32" rx="4" fill="#2E77BB"/><path d="M6 16l2.5-5h3l1.4 3.4L14.4 11h3L20 16l-2.5 5h-3l-1.4-3.4L11.6 21h-3L6 16zm18-5h8l1.5 2L35 11h7l-5 5 5 5h-7l-1.5-2-1.5 2h-8l5-5-5-5z" fill="#fff"/></svg>
            </div>
            {/* Discover */}
            <div className="bg-white/[0.06] border border-white/[0.06] rounded px-2.5 py-1.5">
              <svg viewBox="0 0 48 32" width="36" height="24" fill="none"><rect width="48" height="32" rx="4" fill="#fff"/><rect x=".5" y=".5" width="47" height="31" rx="3.5" stroke="#ddd"/><circle cx="28" cy="16" r="6" fill="#F48120"/><text x="8" y="19" fontFamily="Arial" fontSize="8" fontWeight="bold" fill="#333">DISC</text></svg>
            </div>
            {/* Apple Pay */}
            <div className="bg-white/[0.06] border border-white/[0.06] rounded px-2.5 py-1.5">
              <svg viewBox="0 0 48 32" width="36" height="24" fill="none"><rect width="48" height="32" rx="4" fill="#000"/><text x="24" y="19" textAnchor="middle" fontFamily="system-ui" fontSize="10" fontWeight="600" fill="#fff">Pay</text><path d="M15 10c-.8 0-1.7.5-2.2 1.1-.5.6-.8 1.3-.7 2.1.8 0 1.6-.4 2.1-1 .5-.6.8-1.3.8-2.2zm.1 2.5c-1.2 0-2.2.7-2.8.7-.6 0-1.5-.6-2.5-.6-1.3 0-2.5.7-3.1 1.9-1.3 2.3-.3 5.6 1 7.5.6.9 1.4 2 2.4 1.9 1-.1 1.3-.6 2.4-.6 1.1 0 1.4.6 2.5.6 1 0 1.7-1 2.3-1.9.7-1 1-2 1-2.1-1-.4-1.7-1.6-1.7-3 0-1.2.6-2.2 1.4-2.9-.8-1-1.9-1.5-2.9-1.5z" fill="#fff"/></svg>
            </div>
            {/* Google Pay */}
            <div className="bg-white/[0.06] border border-white/[0.06] rounded px-2.5 py-1.5">
              <svg viewBox="0 0 48 32" width="36" height="24" fill="none"><rect width="48" height="32" rx="4" fill="#fff"/><rect x=".5" y=".5" width="47" height="31" rx="3.5" stroke="#ddd"/><text x="28" y="20" fontFamily="system-ui" fontSize="10" fontWeight="500" fill="#5F6368">Pay</text><path d="M18.5 18v-3.5h2.3c.6 0 1.1.2 1.5.6.4.4.6.9.6 1.2s-.2.8-.6 1.2c-.4.4-.9.5-1.5.5h-2.3z" fill="#4285F4"/><circle cx="15" cy="16" r="3" fill="#EA4335"/><path d="M15 13l2.5 3H15v-3z" fill="#FBBC04"/><path d="M15 19l2.5-3H15v3z" fill="#34A853"/></svg>
            </div>
            {/* Cash App */}
            <div className="bg-white/[0.06] border border-white/[0.06] rounded px-2.5 py-1.5">
              <svg viewBox="0 0 48 32" width="36" height="24" fill="none"><rect width="48" height="32" rx="4" fill="#00D632"/><text x="24" y="20" textAnchor="middle" fontFamily="system-ui" fontSize="12" fontWeight="700" fill="#fff">$</text></svg>
            </div>
          </div>

          <p className="text-white/40 text-sm">
            &copy; {new Date().getFullYear()} Alex's Fitness Training. All rights reserved.
          </p>

          {/* Built By DocZeus */}
          <div className="mt-8 pt-6 border-t border-white/5">
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

      {/* Floating Instagram */}
      <a
        href="https://www.instagram.com/alexdavisfit/reels/"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-5 left-5 z-50 w-10 h-10 rounded-full bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-white/40 hover:text-[#FF4D2E] hover:border-white/20 transition-all"
        title="@alexdavisfit"
      >
        <Instagram size={16} />
      </a>

      {/* Consultation Modal (all site buttons) */}
      <BookingModal
        isOpen={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
      />

      {/* Book Now Modal (nav button — shows Session / Consultation choice) */}
      <BookingModal
        isOpen={bookNowModalOpen}
        onClose={() => setBookNowModalOpen(false)}
        showChoice
      />

      {/* Training Plans Shop */}
      <TrainingPlansShop
        isOpen={shopOpen}
        onClose={() => setShopOpen(false)}
        onPurchaseComplete={handlePurchaseComplete}
      />

      {/* Post-Purchase Booking */}
      <PostPurchaseBooking
        isOpen={postPurchaseOpen}
        onClose={() => setPostPurchaseOpen(false)}
        plan={purchasedPlan}
        trainer={selectedTrainer}
      />

      {/* Quick Message Modal */}
      <QuickMessageModal
        isOpen={messageModalOpen}
        onClose={() => setMessageModalOpen(false)}
      />
    </div>
  );
}

export default App;
