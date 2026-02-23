import { motion, useScroll, useTransform } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { useRef } from "react";
import {
  Sparkles,
  Zap,
  Code2,
  Layers,
  Download,
  Eye,
  MessageSquare,
  Image,
  ArrowRight,
  Check,
  Star,
  Globe,
  Cpu,
  MousePointer2,
} from "lucide-react";

const fadeInUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  visible: {
    transition: { staggerChildren: 0.15 },
  },
};

const FloatingSVG = () => (
  <motion.svg
    width="100%"
    height="100%"
    viewBox="0 0 800 600"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="absolute top-0 left-0 w-full h-full -z-10 opacity-30 pointer-events-none"
    initial={{ opacity: 0 }}
    animate={{ opacity: 0.3 }}
    transition={{ duration: 2 }}
  >
    <motion.circle
      cx="400"
      cy="300"
      r="200"
      stroke="url(#paint0_linear)"
      strokeWidth="2"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
    />
    <motion.rect
      x="200"
      y="150"
      width="400"
      height="300"
      rx="20"
      stroke="url(#paint1_linear)"
      strokeWidth="1"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear", delay: 1 }}
    />
    <defs>
      <linearGradient id="paint0_linear" x1="400" y1="100" x2="400" y2="500" gradientUnits="userSpaceOnUse">
        <stop stopColor="hsl(var(--primary))" />
        <stop offset="1" stopColor="hsl(var(--chart-3))" />
      </linearGradient>
      <linearGradient id="paint1_linear" x1="200" y1="300" x2="600" y2="300" gradientUnits="userSpaceOnUse">
        <stop stopColor="hsl(var(--chart-1))" />
        <stop offset="1" stopColor="hsl(var(--chart-2))" />
      </linearGradient>
    </defs>
  </motion.svg>
);

const SkeuoCard = ({ children, className = "", dataTestId = "" }) => (
  <Card 
    className={`bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-md border-white/20 dark:border-white/5 shadow-skeuo-md hover:shadow-skeuo-lg transition-all duration-300 rounded-3xl p-8 ${className}`}
    data-testid={dataTestId}
  >
    {children}
  </Card>
);

const plans = [
  {
    name: "Бронза",
    price: "0₽",
    credits: 10,
    features: ["10 генераций", "Базовые шаблоны", "Чистый HTML"],
    color: "from-slate-400 to-slate-500",
  },
  {
    name: "Серебро",
    price: "490₽",
    credits: 50,
    features: ["50 генераций", "Все шаблоны", "Правки через чат"],
    color: "from-blue-400 to-blue-600",
  },
  {
    name: "Золото",
    price: "990₽",
    credits: 200,
    features: ["200 генераций", "Генерация по фото", "Приоритет"],
    popular: true,
    color: "from-amber-400 to-orange-500",
  },
  {
    name: "Платина",
    price: "2490₽",
    credits: 1000,
    features: ["1000 генераций", "API доступ", "Все функции"],
    color: "from-purple-500 to-pink-600",
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A] text-slate-900 dark:text-slate-100 selection:bg-primary/20">
      <FloatingSVG />
      
      <header className="fixed top-0 w-full z-50 px-6 py-4">
        <nav className="max-w-7xl mx-auto flex items-center justify-between bg-white/40 dark:bg-black/20 backdrop-blur-xl border border-white/20 dark:border-white/5 rounded-2xl px-6 py-3 shadow-glass">
          <div className="flex items-center gap-3 group cursor-pointer">
            <motion.div 
              whileHover={{ rotate: 180 }}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-chart-3 flex items-center justify-center shadow-lg shadow-primary/20"
            >
              <Sparkles className="w-5 h-5 text-white" />
            </motion.div>
            <span className="text-xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-500 dark:from-white dark:to-slate-400">
              НЕЙРОЗОДЧИЙ
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a href="#features" className="hover:text-primary transition-colors">Возможности</a>
            <a href="#pricing" className="hover:text-primary transition-colors">Тарифы</a>
            <Button variant="ghost" className="rounded-xl" onClick={() => setLocation("/auth")}>Войти</Button>
            <Button className="rounded-xl shadow-lg shadow-primary/25 hover-elevate px-6" onClick={() => setLocation("/auth")}>
              Создать сайт
            </Button>
          </div>
        </nav>
      </header>

      <main>
        <section ref={heroRef} className="relative pt-40 pb-20 px-6 overflow-hidden min-h-screen flex items-center">
          <motion.div style={{ y, opacity }} className="max-w-7xl mx-auto w-full grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
              className="space-y-8"
            >
              <motion.div variants={fadeInUp}>
                <Badge className="bg-primary/10 text-primary border-primary/20 px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase">
                  AI-POWERED REVOLUTION
                </Badge>
              </motion.div>
              
              <motion.h1 
                variants={fadeInUp}
                className="text-6xl sm:text-7xl font-black leading-[1.1] tracking-tight"
              >
                Создавайте <br />
                <span className="italic font-serif text-primary">шедевры</span> <br />
                голосом и ИИ
              </motion.h1>
              
              <motion.p 
                variants={fadeInUp}
                className="text-xl text-slate-500 dark:text-slate-400 max-w-lg leading-relaxed"
              >
                Первый в мире конструктор, который понимает ваши чувства. Загрузите фото или опишите мечту — мы превратим её в код.
              </motion.p>
              
              <motion.div variants={fadeInUp} className="flex flex-wrap gap-4">
                <Button size="lg" className="h-16 px-8 rounded-2xl text-lg font-bold shadow-xl shadow-primary/30 active-elevate-2" onClick={() => setLocation("/auth")}>
                  Начать бесплатно
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
                <Button size="lg" variant="outline" className="h-16 px-8 rounded-2xl text-lg font-bold border-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Посмотреть демо
                </Button>
              </motion.div>

              <motion.div variants={fadeInUp} className="flex items-center gap-4 pt-4">
                <div className="flex -space-x-3">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="w-10 h-10 rounded-full border-2 border-background bg-slate-200 dark:bg-slate-800 overflow-hidden shadow-sm">
                      <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${i+10}`} alt="avatar" />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-slate-500">
                  <span className="font-bold text-slate-900 dark:text-white">10,000+</span> дизайнеров уже с нами
                </p>
              </motion.div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.8, rotateY: 20 }}
              animate={{ opacity: 1, scale: 1, rotateY: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="relative hidden lg:block"
            >
              <div className="absolute inset-0 bg-primary/20 blur-[120px] rounded-full" />
              <SkeuoCard className="relative overflow-hidden aspect-[4/3] flex items-center justify-center group">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-chart-3 to-primary" />
                <div className="grid grid-cols-2 gap-4 w-full">
                  <div className="space-y-4">
                    <motion.div animate={{ scale: [1, 1.02, 1] }} transition={{ repeat: Infinity, duration: 3 }} className="h-32 rounded-2xl bg-slate-100 dark:bg-slate-800 shadow-skeuo-inner border border-white/10" />
                    <div className="h-20 rounded-2xl bg-primary/10 shadow-skeuo-inner" />
                  </div>
                  <div className="space-y-4 pt-8">
                    <div className="h-24 rounded-2xl bg-chart-2/10 shadow-skeuo-inner" />
                    <div className="h-32 rounded-2xl bg-slate-100 dark:bg-slate-800 shadow-skeuo-inner border border-white/10" />
                  </div>
                </div>
                <div className="absolute bottom-8 left-8 right-8 bg-white/80 dark:bg-black/80 backdrop-blur-xl p-4 rounded-2xl border border-white/20 shadow-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-bold">Сайт готов!</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-tighter">Gemini 3.1 Pro</Badge>
                </div>
                <motion.div 
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-2xl border border-white/30 flex items-center justify-center shadow-glass">
                    <Sparkles className="w-10 h-10 text-primary animate-pulse" />
                  </div>
                </motion.div>
              </SkeuoCard>
            </motion.div>
          </motion.div>
        </section>

        <section id="features" className="py-32 px-6">
          <div className="max-w-7xl mx-auto space-y-20">
            <div className="text-center space-y-4">
              <h2 className="text-4xl sm:text-5xl font-black">Будущее уже здесь</h2>
              <p className="text-xl text-slate-500 max-w-2xl mx-auto">Мы переосмыслили процесс создания сайтов, сделав его интуитивным и тактильным.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                { icon: MessageSquare, title: "Магия промтов", desc: "Просто скажите, что вы хотите. Наш ИИ понимает контекст и эстетику.", color: "text-blue-500" },
                { icon: Image, title: "Vision-движок", desc: "Сфотографируйте набросок на салфетке или скриншот — мы оживим его.", color: "text-purple-500" },
                { icon: Cpu, title: "Умная вёрстка", desc: "Чистый HTML5 и CSS3, который обожают поисковики и разработчики.", color: "text-emerald-500" },
                { icon: MousePointer2, title: "Интерактивность", desc: "Автоматическое добавление анимаций и микро-взаимодействий.", color: "text-orange-500" },
                { icon: Globe, title: "Мгновенный деплой", desc: "Публикация в один клик. Ваш сайт доступен миру за считанные секунды.", color: "text-cyan-500" },
                { icon: Layers, title: "Компоненты", desc: "Огромная библиотека скевоморфных элементов в вашем распоряжении.", color: "text-rose-500" },
              ].map((feat, i) => (
                <motion.div
                  key={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeInUp}
                >
                  <SkeuoCard className="h-full group hover:-translate-y-2 transition-transform duration-500">
                    <div className={`w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 shadow-skeuo-inner flex items-center justify-center mb-6 ${feat.color}`}>
                      <feat.icon className="w-7 h-7" />
                    </div>
                    <h3 className="text-2xl font-bold mb-3">{feat.title}</h3>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed">{feat.desc}</p>
                  </SkeuoCard>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="py-32 px-6 bg-slate-50 dark:bg-slate-900/50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-20 space-y-4">
              <h2 className="text-4xl font-black">Простые тарифы</h2>
              <p className="text-slate-500">Выбирайте тот, который подходит вашему масштабу</p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {plans.map((plan, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                >
                  <SkeuoCard className={`relative h-full flex flex-col ${plan.popular ? "border-primary/50 ring-4 ring-primary/10" : ""}`}>
                    {plan.popular && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary px-4 py-1 text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-primary/30">BEST VALUE</Badge>
                      </div>
                    )}
                    <div className="mb-8">
                      <h3 className="text-lg font-bold text-slate-500 uppercase tracking-widest mb-2">{plan.name}</h3>
                      <div className="flex items-baseline gap-1">
                        <span className="text-5xl font-black tracking-tighter">{plan.price.replace('₽', '')}</span>
                        <span className="text-xl font-bold text-slate-400">₽</span>
                      </div>
                    </div>
                    
                    <div className="space-y-4 flex-1 mb-8">
                      <div className="flex items-center gap-2 text-sm font-bold text-primary">
                        <Sparkles className="w-4 h-4" />
                        {plan.credits} кредитов
                      </div>
                      <div className="h-px bg-slate-200 dark:bg-slate-800" />
                      {plan.features.map((f, j) => (
                        <div key={j} className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                          <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 text-primary" />
                          </div>
                          {f}
                        </div>
                      ))}
                    </div>

                    <Button 
                      className={`w-full h-14 rounded-2xl font-bold text-lg shadow-lg transition-all ${
                        plan.popular ? "bg-primary hover:bg-primary/90 shadow-primary/20" : "bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
                      }`}
                      onClick={() => setLocation("/auth")}
                    >
                      Выбрать
                    </Button>
                  </SkeuoCard>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-32 px-6">
          <SkeuoCard className="max-w-5xl mx-auto bg-gradient-to-br from-primary/10 to-chart-3/10 border-primary/20 p-12 text-center overflow-hidden relative">
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
              className="absolute -top-24 -right-24 w-64 h-64 bg-primary/20 rounded-full blur-[80px]"
            />
            <div className="relative z-10 space-y-8">
              <h2 className="text-5xl font-black tracking-tight leading-tight">Готовы изменить <br /> своё будущее?</h2>
              <p className="text-xl text-slate-600 dark:text-slate-400 max-w-xl mx-auto">Присоединяйтесь к революции в веб-разработке. Создайте свой первый сайт за 60 секунд.</p>
              <Button size="lg" className="h-16 px-12 rounded-2xl text-xl font-black shadow-2xl shadow-primary/40 hover-elevate" onClick={() => setLocation("/auth")}>
                Попробовать сейчас
              </Button>
            </div>
          </SkeuoCard>
        </section>
      </main>

      <footer className="py-12 px-6 border-t border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3 opacity-50">
            <div className="w-8 h-8 rounded-lg bg-slate-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-black tracking-tighter">НЕЙРОЗОДЧИЙ</span>
          </div>
          <div className="flex gap-8 text-sm text-slate-500 font-medium">
            <a href="#" className="hover:text-primary transition-colors">Twitter</a>
            <a href="#" className="hover:text-primary transition-colors">Dribbble</a>
            <a href="#" className="hover:text-primary transition-colors">Github</a>
          </div>
          <p className="text-sm text-slate-400 font-medium">© 2024 НейроЗодчий. Все права защищены.</p>
        </div>
      </footer>
    </div>
  );
}
