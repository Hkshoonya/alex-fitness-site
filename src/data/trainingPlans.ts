export interface TrainingPlan {
  id: string;
  name: string;
  description: string;
  duration: number; // session length in minutes
  planWeeks: number; // 4 or 12 week plan
  pricePerSession: number;
  price: number; // base price (1x/week)
  frequency: { perWeek: number; totalSessions: number; totalPrice: number }[];
  category: 'personal-4week' | 'personal-12week' | 'online' | 'app';
  features: string[];
  popular?: boolean;
  salePrice?: number;
  originalPrice?: number;
  squareItemId?: string;
}

export interface Trainer {
  id: 'alex1' | 'alex2';
  name: string;
  title: string;
  image: string;
  bio: string;
  experience: string;
  specialties: string[];
  priceMultiplier: number;
  discount: number;
}

export const trainers: Trainer[] = [
  {
    id: 'alex1',
    name: 'Alex Davis',
    title: 'Head Trainer & Founder',
    image: '/images/alex-portrait.jpg',
    bio: 'NASM-certified personal trainer with 20+ years of experience. Former D1 collegiate athlete specializing in strength training and body transformation.',
    experience: '20+ Years',
    specialties: ['Strength Training', 'Body Transformation', 'Corrective Exercise', 'Nutrition Coaching'],
    priceMultiplier: 1.0,
    discount: 0,
  },
  {
    id: 'alex2',
    name: 'Alex Martinez',
    title: 'Associate Trainer',
    image: '/images/coach-portrait.jpg',
    bio: 'Certified personal trainer with 8+ years of experience. Specializes in HIIT, boxing, and functional fitness training.',
    experience: '8+ Years',
    specialties: ['HIIT', 'Boxing', 'Functional Fitness', 'Weight Loss'],
    priceMultiplier: 0.8,
    discount: 20,
  },
];

// ===== 4-WEEK PERSONAL TRAINING PLANS =====

export const fourWeekPlans: TrainingPlan[] = [
  {
    id: '4week-30min',
    name: '4 Week Plan - 30 Min Sessions',
    description: 'Customized 30-minute sessions designed for time-efficient progress. Perfect for busy schedules.',
    duration: 30,
    planWeeks: 4,
    pricePerSession: 45,
    price: 160,
    frequency: [
      { perWeek: 1, totalSessions: 4, totalPrice: 160 },
      { perWeek: 2, totalSessions: 8, totalPrice: 320 },
      { perWeek: 3, totalSessions: 12, totalPrice: 480 },
      { perWeek: 4, totalSessions: 16, totalPrice: 640 },
      { perWeek: 5, totalSessions: 20, totalPrice: 800 },
    ],
    category: 'personal-4week',
    features: [
      '30-minute personalized sessions',
      'Custom workout programming',
      'Form correction & technique coaching',
      'Progress tracking',
      'Flexible scheduling',
    ],
    squareItemId: '4LBY7LMMLFNTQ7JBT5JB77UB',
  },
  {
    id: '4week-60min',
    name: '4 Week Plan - 60 Min Sessions',
    description: 'Full 60-minute one-on-one personal training sessions tailored to your goals.',
    duration: 60,
    planWeeks: 4,
    pricePerSession: 70,
    price: 280,
    popular: true,
    frequency: [
      { perWeek: 1, totalSessions: 4, totalPrice: 280 },
      { perWeek: 2, totalSessions: 8, totalPrice: 560 },
      { perWeek: 3, totalSessions: 12, totalPrice: 840 },
      { perWeek: 4, totalSessions: 16, totalPrice: 1120 },
      { perWeek: 5, totalSessions: 20, totalPrice: 1400 },
    ],
    category: 'personal-4week',
    features: [
      '60-minute personalized sessions',
      'Custom workout programming',
      'Form correction & technique coaching',
      'Nutrition guidance',
      'Progress tracking',
      'Flexible scheduling',
    ],
    squareItemId: '89',
  },
  {
    id: '4week-90min',
    name: '4 Week Plan - 90 Min Sessions',
    description: 'Extended 90-minute sessions for maximum depth — warm-up, training, mobility, and cool-down.',
    duration: 90,
    planWeeks: 4,
    pricePerSession: 100,
    price: 400,
    frequency: [
      { perWeek: 1, totalSessions: 4, totalPrice: 400 },
      { perWeek: 2, totalSessions: 8, totalPrice: 800 },
      { perWeek: 3, totalSessions: 12, totalPrice: 1200 },
      { perWeek: 4, totalSessions: 16, totalPrice: 1600 },
      { perWeek: 5, totalSessions: 20, totalPrice: 2000 },
    ],
    category: 'personal-4week',
    features: [
      '90-minute comprehensive sessions',
      'Extended warm-up & mobility work',
      'Custom workout programming',
      'Cool-down & recovery protocols',
      'Nutrition coaching',
      'Progress tracking',
    ],
    squareItemId: '90',
  },
];

// ===== 12-WEEK PERSONAL TRAINING PLANS =====

export const twelveWeekPlans: TrainingPlan[] = [
  {
    id: '12week-30min',
    name: '12 Week Plan - 30 Min Sessions',
    description: 'Commit to 12 weeks of focused 30-minute sessions at a reduced per-session rate.',
    duration: 30,
    planWeeks: 12,
    pricePerSession: 35,
    price: 420,
    frequency: [
      { perWeek: 1, totalSessions: 12, totalPrice: 420 },
      { perWeek: 2, totalSessions: 24, totalPrice: 840 },
      { perWeek: 3, totalSessions: 36, totalPrice: 1260 },
      { perWeek: 4, totalSessions: 48, totalPrice: 1680 },
      { perWeek: 5, totalSessions: 60, totalPrice: 2100 },
    ],
    category: 'personal-12week',
    features: [
      '30-minute personalized sessions',
      'Save $10/session vs 4-week plan',
      'Custom progressive programming',
      'Form correction & technique coaching',
      'Weekly progress check-ins',
      'Body composition tracking',
    ],
    squareItemId: 'JDIHBQ3BBI3GIAQXP7CA7CPL',
  },
  {
    id: '12week-60min',
    name: '12 Week Plan - 60 Min Sessions',
    description: 'The ultimate transformation plan — 12 weeks of full-length sessions at the best per-session rate.',
    duration: 60,
    planWeeks: 12,
    pricePerSession: 60,
    price: 720,
    popular: true,
    frequency: [
      { perWeek: 1, totalSessions: 12, totalPrice: 720 },
      { perWeek: 2, totalSessions: 24, totalPrice: 1440 },
      { perWeek: 3, totalSessions: 36, totalPrice: 2160 },
      { perWeek: 4, totalSessions: 48, totalPrice: 2880 },
      { perWeek: 5, totalSessions: 60, totalPrice: 3600 },
    ],
    category: 'personal-12week',
    features: [
      '60-minute personalized sessions',
      'Save $10/session vs 4-week plan',
      'Advanced progressive programming',
      'Full nutrition coaching',
      'Bi-weekly progress check-ins',
      'Body composition tracking',
      'Supplement guidance',
    ],
    squareItemId: '85',
  },
  {
    id: '12week-90min',
    name: '12 Week Plan - 90 Min Sessions',
    description: 'Premium 12-week transformation with extended 90-minute sessions for maximum results.',
    duration: 90,
    planWeeks: 12,
    pricePerSession: 90,
    price: 1080,
    frequency: [
      { perWeek: 1, totalSessions: 12, totalPrice: 1080 },
      { perWeek: 2, totalSessions: 24, totalPrice: 2160 },
      { perWeek: 3, totalSessions: 36, totalPrice: 3240 },
      { perWeek: 4, totalSessions: 48, totalPrice: 4320 },
      { perWeek: 5, totalSessions: 60, totalPrice: 5400 },
    ],
    category: 'personal-12week',
    features: [
      '90-minute comprehensive sessions',
      'Save $10/session vs 4-week plan',
      'Extended warm-up & mobility work',
      'Advanced progressive programming',
      'Full nutrition & recovery coaching',
      'Weekly progress check-ins',
      'Body composition tracking',
    ],
    squareItemId: 'Q2E6JC7H4QDUO6AKOBKOR2AJ',
  },
];

// ===== ONLINE TRAINING PLANS =====

export const onlinePlans: TrainingPlan[] = [
  {
    id: 'app-only',
    name: 'Fitness App (No Coaching)',
    description: 'Access to the training app with workout programs — train on your own schedule.',
    duration: 0,
    planWeeks: 4,
    pricePerSession: 0,
    price: 10,
    originalPrice: 15,
    salePrice: 10,
    frequency: [],
    category: 'app',
    features: [
      'Training app access',
      'Pre-built workout programs',
      'Exercise video library',
      'Progress tracking',
      'Train on your schedule',
    ],
    squareItemId: 'LGZJ2MDG22SJNBDBTCI66ASJ',
  },
  {
    id: 'online-monthly',
    name: 'Custom Online Training - Monthly',
    description: 'Personalized online coaching with custom programming updated monthly.',
    duration: 0,
    planWeeks: 4,
    pricePerSession: 0,
    price: 100,
    originalPrice: 150,
    salePrice: 100,
    frequency: [],
    category: 'online',
    features: [
      'Custom workout programming',
      'Monthly program updates',
      'Form check via video',
      'Nutrition guidance',
      'Direct messaging with coach',
      'Training app access',
    ],
    squareItemId: '82',
  },
  {
    id: 'online-3month',
    name: 'Custom Online Training - 3 Months',
    description: 'Full 3-month online coaching package with progressive programming and ongoing support.',
    duration: 0,
    planWeeks: 12,
    pricePerSession: 0,
    price: 250,
    originalPrice: 300,
    salePrice: 250,
    popular: true,
    frequency: [],
    category: 'online',
    features: [
      'Custom workout programming',
      'Progressive 12-week periodization',
      'Bi-weekly program updates',
      'Form check via video',
      'Full nutrition coaching',
      'Direct messaging with coach',
      'Training app access',
      'Save $50 vs monthly',
    ],
    squareItemId: '84',
  },
];

// ===== COMBINED =====

export const allPlans = [...fourWeekPlans, ...twelveWeekPlans, ...onlinePlans];

export const getPlanPrice = (plan: TrainingPlan, trainerId: 'alex1' | 'alex2'): number => {
  const trainer = trainers.find(t => t.id === trainerId);
  if (!trainer) return plan.price;
  return Math.round(plan.price * trainer.priceMultiplier);
};

export const formatPrice = (price: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(price);
};

export const getPriceRange = (plan: TrainingPlan): string => {
  if (plan.frequency.length === 0) {
    if (plan.salePrice && plan.originalPrice) {
      return `${formatPrice(plan.salePrice)}`;
    }
    return formatPrice(plan.price);
  }
  const min = plan.frequency[0].totalPrice;
  const max = plan.frequency[plan.frequency.length - 1].totalPrice;
  return `${formatPrice(min)} - ${formatPrice(max)}`;
};
