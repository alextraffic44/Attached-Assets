import { motion, useScroll, useTransform, useInView } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { useRef, useEffect, useState } from "react";
import {
  Sparkles,
  Zap,
  Code2,
  Layers,
  ArrowRight,
  Check,
  Globe,
  Cpu,
  MousePointer2,
  MessageSquare,
  Image,
  Eye,
  Wand2,
  Download,
  ChevronRight,
} from "lucide-react";

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

const staggerContainer = {
  visible: { transition: { staggerChildren: 0.12 } },
};

function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    let start = 0;
    const duration = 2000;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [isInView, target]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

const plans = [
  {
    name: "Старт",
    price: "0",
    period: "навсегда",
    credits: 10,
    features: ["10 генераций", "Базовые шаблоны", "HTML/CSS/JS экспорт", "Адаптивный дизайн"],
    cta: "Начать бесплатно",
  },
  {
    name: "Про",
    price: "490",
    period: "/мес",
    credits: 50,
    features: ["50 генераций", "Все шаблоны", "AI изображения", "Правки через чат", "Приоритет генерации"],
    cta: "Выбрать Про",
  },
  {
    name: "Бизнес",
    price: "990",
    period: "/мес",
    credits: 200,
    popular: true,
    features: ["200 генераций", "Генерация по фото", "Веб-исследование", "Visual Editor", "AI изображения без лимита"],
    cta: "Выбрать Бизнес",
  },
  {
    name: "Корпоративный",
    price: "2 490",
    period: "/мес",
    credits: 1000,
    features: ["1000 генераций", "API доступ", "Белый лейбл", "Выделенная поддержка", "Все функции"],
    cta: "Связаться",
  },
];

const features = [
  {
    icon: MessageSquare,
    title: "Промт → Сайт",
    desc: "Опишите идею текстом — ИИ создаст полноценный сайт с анимациями, адаптивностью и SEO за 30 секунд.",
    gradient: "from-blue-500 to-cyan-400",
  },
  {
    icon: Image,
    title: "Фото → Код",
    desc: "Загрузите скриншот, набросок или фото конкурента. Vision-движок воссоздаст дизайн в чистом коде.",
    gradient: "from-purple-500 to-pink-400",
  },
  {
    icon: Globe,
    title: "Веб-исследование",
    desc: "ИИ автоматически изучает тему в интернете и использует реальные факты, цифры и данные.",
    gradient: "from-emerald-500 to-teal-400",
  },
  {
    icon: Wand2,
    title: "AI Изображения",
    desc: "Встроенный генератор изображений. Создавайте уникальные фото и иллюстрации прямо в редакторе.",
    gradient: "from-orange-500 to-amber-400",
  },
  {
    icon: MousePointer2,
    title: "Visual Editor",
    desc: "Кликайте на текст — редактируйте. Кликайте на изображения — заменяйте. Всё прямо в превью.",
    gradient: "from-rose-500 to-red-400",
  },
  {
    icon: Code2,
    title: "Чистый код",
    desc: "HTML5 + CSS3 + JS без зависимостей. Скачивайте ZIP и размещайте где угодно. Код принадлежит вам.",
    gradient: "from-indigo-500 to-violet-400",
  },
];

const steps = [
  { num: "01", title: "Опишите идею", desc: "Напишите промт или загрузите изображение-пример. ИИ поймёт контекст, стиль и задачу." },
  { num: "02", title: "ИИ создаёт", desc: "Gemini 3.1 Pro генерирует уникальный дизайн с анимациями, после исследования темы в интернете." },
  { num: "03", title: "Редактируйте", desc: "Правьте через чат или визуальный редактор. Добавляйте AI-изображения. Итерируйте до идеала." },
  { num: "04", title: "Публикуйте", desc: "Скачайте ZIP или опубликуйте в один клик. Ваш сайт готов к работе." },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#09090b] text-white selection:bg-violet-500/30 overflow-x-hidden">
      <svg className="fixed inset-0 w-full h-full pointer-events-none z-0" style={{ opacity: 0.04 }}>
        <filter id="noise">
          <feTurbulence baseFrequency="0.65" type="fractalNoise" numOctaves="3" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>

      <header className={`fixed top-0 w-full z-50 transition-all duration-500 ${scrolled ? "py-3" : "py-5"}`}>
        <nav className={`max-w-7xl mx-auto flex items-center justify-between px-6 py-3 rounded-2xl transition-all duration-500 mx-4 lg:mx-auto ${
          scrolled
            ? "bg-white/[0.07] backdrop-blur-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
            : "bg-transparent border border-transparent"
        }`}>
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setLocation("/")} data-testid="link-logo">
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25 group-hover:shadow-violet-500/40 transition-shadow">
              <Sparkles className="w-5 h-5 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent" />
            </div>
            <span className="text-lg font-black tracking-tight hidden sm:block">
              НЕЙРОЗОДЧИЙ
            </span>
          </div>

          <div className="hidden md:flex items-center gap-1 text-sm font-medium text-white/60">
            <a href="#features" className="px-4 py-2 rounded-xl hover:text-white hover:bg-white/[0.06] transition-all" data-testid="link-features">Возможности</a>
            <a href="#how" className="px-4 py-2 rounded-xl hover:text-white hover:bg-white/[0.06] transition-all" data-testid="link-how">Как работает</a>
            <a href="#pricing" className="px-4 py-2 rounded-xl hover:text-white hover:bg-white/[0.06] transition-all" data-testid="link-pricing">Тарифы</a>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              className="rounded-xl text-white/70 hover:text-white hover:bg-white/[0.06] hidden sm:flex"
              onClick={() => setLocation("/auth")}
              data-testid="button-login"
            >
              Войти
            </Button>
            <Button
              className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all border-0 font-bold px-6"
              onClick={() => setLocation("/dashboard")}
              data-testid="button-start"
            >
              Создать сайт
            </Button>
          </div>
        </nav>
      </header>

      <main>
        <section ref={heroRef} className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
          <div className="absolute inset-0 z-0">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-violet-600/20 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-fuchsia-600/10 rounded-full blur-[120px]" />
            <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#09090b]" />
          </div>

          <div className="absolute inset-0 z-0 opacity-[0.15]">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                  <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
            <div className="absolute inset-0 bg-gradient-to-b from-[#09090b] via-transparent to-[#09090b]" />
          </div>

          <motion.div style={{ y: heroY, opacity: heroOpacity }} className="relative z-10 max-w-5xl mx-auto text-center px-6">
            <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="space-y-8">
              <motion.div variants={fadeInUp}>
                <Badge className="bg-violet-500/10 text-violet-300 border border-violet-500/20 px-5 py-2 rounded-full text-xs font-bold tracking-[0.2em] uppercase backdrop-blur-sm">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full inline-block mr-2 animate-pulse" />
                  Gemini 3.1 Pro · Новое поколение
                </Badge>
              </motion.div>

              <motion.h1
                variants={fadeInUp}
                className="text-5xl sm:text-7xl lg:text-8xl font-black leading-[0.95] tracking-tight"
              >
                <span className="block">Сайт из текста</span>
                <span className="block bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
                  за секунды
                </span>
              </motion.h1>

              <motion.p
                variants={fadeInUp}
                className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto leading-relaxed font-medium"
              >
                Опишите идею — получите готовый сайт с уникальным дизайном, анимациями
                и реальным контентом. Без кода. Без дизайнера. Без компромиссов.
              </motion.p>

              <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                <Button
                  size="lg"
                  className="h-16 px-10 rounded-2xl text-lg font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-2xl shadow-violet-600/30 hover:shadow-violet-500/40 transition-all border-0 hover:-translate-y-0.5 active:translate-y-0"
                  onClick={() => setLocation("/dashboard")}
                  data-testid="button-hero-start"
                >
                  Создать бесплатно
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-16 px-10 rounded-2xl text-lg font-bold border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white backdrop-blur-sm"
                  onClick={() => {
                    const el = document.getElementById("how");
                    el?.scrollIntoView({ behavior: "smooth" });
                  }}
                  data-testid="button-hero-demo"
                >
                  <Eye className="mr-2 w-5 h-5" />
                  Как это работает
                </Button>
              </motion.div>

              <motion.div variants={fadeInUp} className="flex items-center justify-center gap-6 pt-6 text-sm text-white/40">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Бесплатный старт</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Без банковской карты</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Экспорт в ZIP</span>
                </div>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 1, ease: [0.22, 1, 0.36, 1] }}
              className="mt-20 relative"
            >
              <div className="absolute -inset-4 bg-gradient-to-b from-violet-500/20 via-fuchsia-500/10 to-transparent rounded-[2rem] blur-xl" />
              <div className="relative bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] rounded-[1.5rem] p-4 sm:p-6 shadow-2xl">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  <span className="ml-3 text-xs text-white/30 font-mono">нейрозодчий — AI Конструктор</span>
                </div>
                <div className="grid grid-cols-12 gap-4 min-h-[300px] sm:min-h-[400px]">
                  <div className="col-span-4 bg-white/[0.03] rounded-xl p-4 border border-white/[0.05] flex flex-col gap-3">
                    <div className="bg-violet-500/10 rounded-xl p-3 border border-violet-500/20">
                      <p className="text-xs text-violet-300 font-medium">Промт</p>
                      <p className="text-[11px] text-white/40 mt-1">Лендинг для AI-стартапа с тёмной темой...</p>
                    </div>
                    <div className="flex-1 flex flex-col justify-end gap-2">
                      <div className="bg-white/[0.03] rounded-lg p-2 border border-white/[0.05]">
                        <p className="text-[10px] text-emerald-400 font-medium flex items-center gap-1"><Sparkles className="w-3 h-3" /> Сайт обновлён</p>
                      </div>
                      <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-lg p-2 text-center">
                        <p className="text-[10px] font-bold">Отправить</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-span-8 bg-white/[0.02] rounded-xl border border-white/[0.05] overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 via-transparent to-fuchsia-600/5" />
                    <div className="p-6 relative z-10">
                      <div className="w-32 h-2 bg-white/10 rounded-full mb-6" />
                      <div className="w-3/4 h-4 bg-white/[0.07] rounded-full mb-3" />
                      <div className="w-1/2 h-4 bg-white/[0.05] rounded-full mb-8" />
                      <div className="grid grid-cols-3 gap-3">
                        {[1,2,3].map(i => (
                          <div key={i} className="aspect-[4/3] rounded-xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/[0.05]" />
                        ))}
                      </div>
                      <div className="mt-6 flex gap-3">
                        <div className="w-28 h-8 rounded-lg bg-violet-500/20 border border-violet-500/20" />
                        <div className="w-28 h-8 rounded-lg bg-white/[0.05] border border-white/[0.05]" />
                      </div>
                    </div>
                    <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-xl rounded-lg px-3 py-1.5 border border-white/[0.08] flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-[10px] font-mono text-white/50">Preview</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </section>

        <section className="py-24 px-6 relative z-10">
          <div className="max-w-6xl mx-auto">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="flex flex-wrap items-center justify-center gap-x-16 gap-y-8"
            >
              {[
                { value: 10000, suffix: "+", label: "Сайтов создано" },
                { value: 5000, suffix: "+", label: "Пользователей" },
                { value: 30, suffix: "сек", label: "Среднее время" },
                { value: 98, suffix: "%", label: "Довольных" },
              ].map((stat, i) => (
                <div key={i} className="text-center" data-testid={`stat-${i}`}>
                  <p className="text-4xl sm:text-5xl font-black tracking-tight bg-gradient-to-b from-white to-white/50 bg-clip-text text-transparent">
                    <AnimatedCounter target={stat.value} suffix={stat.suffix} />
                  </p>
                  <p className="text-sm text-white/30 font-medium mt-1 uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        <section id="features" className="py-32 px-6 relative z-10">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={staggerContainer}
              className="text-center mb-20"
            >
              <motion.div variants={fadeInUp}>
                <Badge className="bg-white/[0.06] text-white/60 border border-white/[0.08] px-4 py-1.5 rounded-full text-xs font-bold tracking-[0.15em] uppercase mb-6">
                  Возможности
                </Badge>
              </motion.div>
              <motion.h2 variants={fadeInUp} className="text-4xl sm:text-6xl font-black tracking-tight mb-6">
                Всё, что нужно для<br />
                <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">идеального сайта</span>
              </motion.h2>
              <motion.p variants={fadeInUp} className="text-lg text-white/40 max-w-2xl mx-auto">
                Инструменты, которые превращают идею в рабочий продукт за минуты, а не недели.
              </motion.p>
            </motion.div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {features.map((feat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                  data-testid={`feature-card-${i}`}
                >
                  <div className="group h-full bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-8 transition-all duration-500 hover:-translate-y-1">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feat.gradient} flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      <feat.icon className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-white/90">{feat.title}</h3>
                    <p className="text-white/40 leading-relaxed text-[15px]">{feat.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-32 px-6 relative z-10">
          <div className="max-w-6xl mx-auto">
            <div className="relative rounded-[2.5rem] overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-600/30 via-fuchsia-600/20 to-blue-600/30" />
              <div className="absolute inset-0 bg-[#09090b]/60 backdrop-blur-sm" />
              <div className="relative z-10 grid lg:grid-cols-2 gap-12 p-10 sm:p-16 items-center">
                <div className="space-y-8">
                  <Badge className="bg-white/[0.08] text-violet-300 border border-violet-500/20 px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase">
                    Технология
                  </Badge>
                  <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-[1.1]">
                    Не шаблоны.<br />
                    <span className="text-white/40">Уникальный дизайн</span><br />
                    каждый раз.
                  </h2>
                  <p className="text-white/40 text-lg leading-relaxed max-w-md">
                    Gemini 3.1 Pro анализирует тему, изучает конкурентов через интернет
                    и создаёт дизайн уровня студии — с анимациями, микро-взаимодействиями
                    и продуманной типографикой.
                  </p>
                  <div className="space-y-4">
                    {[
                      "Scroll-анимации и parallax эффекты",
                      "Glassmorphism и noise-текстуры",
                      "Кинематографичная типографика",
                      "Адаптивность для всех устройств",
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
                          <Check className="w-3.5 h-3.5 text-violet-400" />
                        </div>
                        <span className="text-white/60 text-sm font-medium">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <div className="absolute -inset-8 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 rounded-3xl blur-2xl" />
                  <div className="relative bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 backdrop-blur-xl">
                    <div className="space-y-3 font-mono text-sm">
                      <div className="text-white/20">{"// Gemini 3.1 Pro Output"}</div>
                      <div><span className="text-fuchsia-400">{"<section"}</span> <span className="text-violet-300">class</span>=<span className="text-emerald-400">"hero"</span><span className="text-fuchsia-400">{">"}</span></div>
                      <div className="pl-4"><span className="text-fuchsia-400">{"<h1"}</span> <span className="text-violet-300">style</span>=<span className="text-emerald-400">"..."</span><span className="text-fuchsia-400">{">"}</span></div>
                      <div className="pl-8 text-white/70">Ваш уникальный заголовок</div>
                      <div className="pl-4"><span className="text-fuchsia-400">{"</h1>"}</span></div>
                      <div className="pl-4 text-white/20">{"// Scroll-анимации"}</div>
                      <div className="pl-4"><span className="text-violet-300">{"observer"}</span>.<span className="text-blue-300">observe</span>(el)</div>
                      <div><span className="text-fuchsia-400">{"</section>"}</span></div>
                    </div>
                    <div className="mt-6 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs text-white/30">65,536 tokens max</span>
                      </div>
                      <Badge className="bg-violet-500/10 text-violet-300 border-violet-500/20 text-[10px]">Gemini 3.1</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="py-32 px-6 relative z-10">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={staggerContainer}
              className="text-center mb-20"
            >
              <motion.div variants={fadeInUp}>
                <Badge className="bg-white/[0.06] text-white/60 border border-white/[0.08] px-4 py-1.5 rounded-full text-xs font-bold tracking-[0.15em] uppercase mb-6">
                  Процесс
                </Badge>
              </motion.div>
              <motion.h2 variants={fadeInUp} className="text-4xl sm:text-6xl font-black tracking-tight">
                Четыре шага к<br />
                <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">готовому сайту</span>
              </motion.h2>
            </motion.div>

            <div className="space-y-6">
              {steps.map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  data-testid={`step-${i}`}
                >
                  <div className="group flex items-start gap-8 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] hover:border-white/[0.1] rounded-2xl p-8 transition-all duration-500">
                    <span className="text-5xl font-black text-white/[0.06] group-hover:text-violet-500/20 transition-colors shrink-0 leading-none">
                      {step.num}
                    </span>
                    <div>
                      <h3 className="text-2xl font-bold mb-2">{step.title}</h3>
                      <p className="text-white/40 leading-relaxed">{step.desc}</p>
                    </div>
                    <ChevronRight className="w-6 h-6 text-white/10 group-hover:text-violet-400 transition-colors shrink-0 mt-1 ml-auto" />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="py-32 px-6 relative z-10">
          <div className="max-w-7xl mx-auto">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={staggerContainer}
              className="text-center mb-20"
            >
              <motion.div variants={fadeInUp}>
                <Badge className="bg-white/[0.06] text-white/60 border border-white/[0.08] px-4 py-1.5 rounded-full text-xs font-bold tracking-[0.15em] uppercase mb-6">
                  Тарифы
                </Badge>
              </motion.div>
              <motion.h2 variants={fadeInUp} className="text-4xl sm:text-6xl font-black tracking-tight mb-6">
                Простое ценообразование
              </motion.h2>
              <motion.p variants={fadeInUp} className="text-lg text-white/40 max-w-xl mx-auto">
                Начните бесплатно. Масштабируйтесь когда будете готовы.
              </motion.p>
            </motion.div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {plans.map((plan, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  data-testid={`pricing-card-${i}`}
                >
                  <div className={`relative h-full flex flex-col rounded-2xl p-8 transition-all duration-500 ${
                    plan.popular
                      ? "bg-gradient-to-b from-violet-600/20 to-fuchsia-600/10 border-2 border-violet-500/30 shadow-[0_0_40px_rgba(139,92,246,0.15)]"
                      : "bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12]"
                  }`}>
                    {plan.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                        <Badge className="bg-gradient-to-r from-violet-500 to-fuchsia-500 border-0 px-4 py-1 text-[10px] font-bold tracking-widest shadow-lg shadow-violet-500/30">
                          ПОПУЛЯРНЫЙ
                        </Badge>
                      </div>
                    )}

                    <div className="mb-8">
                      <p className="text-sm font-bold text-white/40 uppercase tracking-widest mb-3">{plan.name}</p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-5xl font-black tracking-tighter">{plan.price}</span>
                        <span className="text-lg font-bold text-white/30">₽{plan.period}</span>
                      </div>
                    </div>

                    <div className="space-y-3 flex-1 mb-8">
                      <div className="flex items-center gap-2 text-sm font-bold text-violet-400">
                        <Sparkles className="w-4 h-4" />
                        {plan.credits} кредитов
                      </div>
                      <div className="h-px bg-white/[0.06]" />
                      {plan.features.map((f, j) => (
                        <div key={j} className="flex items-center gap-3 text-sm text-white/50">
                          <div className="w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 text-violet-400" />
                          </div>
                          {f}
                        </div>
                      ))}
                    </div>

                    <Button
                      className={`w-full h-14 rounded-2xl font-bold text-base transition-all ${
                        plan.popular
                          ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-500/20 border-0"
                          : "bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08]"
                      }`}
                      onClick={() => setLocation("/dashboard")}
                      data-testid={`button-plan-${i}`}
                    >
                      {plan.cta}
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-32 px-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-5xl mx-auto"
          >
            <div className="relative rounded-[2.5rem] overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-600/40 via-fuchsia-600/30 to-pink-600/20" />
              <div className="absolute inset-0 bg-[#09090b]/30" />
              <div className="relative z-10 text-center py-20 px-8 sm:px-16 space-y-8">
                <h2 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1]">
                  Готовы создать<br />
                  <span className="bg-gradient-to-r from-white via-violet-200 to-white bg-clip-text text-transparent">свой идеальный сайт?</span>
                </h2>
                <p className="text-lg text-white/50 max-w-xl mx-auto">
                  Присоединяйтесь к тысячам пользователей, которые уже создают
                  сайты будущего с помощью ИИ.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Button
                    size="lg"
                    className="h-16 px-12 rounded-2xl text-xl font-black bg-white text-black hover:bg-white/90 shadow-2xl hover:-translate-y-0.5 transition-all border-0"
                    onClick={() => setLocation("/dashboard")}
                    data-testid="button-cta-final"
                  >
                    Начать сейчас
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] bg-[#09090b]">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <span className="text-lg font-black tracking-tight">НЕЙРОЗОДЧИЙ</span>
              </div>
              <p className="text-sm text-white/30 leading-relaxed">
                AI-конструктор сайтов нового поколения на базе Gemini 3.1 Pro.
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-white/50 uppercase tracking-widest mb-4">Продукт</p>
              <div className="space-y-3">
                <a href="#features" className="block text-sm text-white/30 hover:text-white transition-colors">Возможности</a>
                <a href="#pricing" className="block text-sm text-white/30 hover:text-white transition-colors">Тарифы</a>
                <a href="#how" className="block text-sm text-white/30 hover:text-white transition-colors">Как работает</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-white/50 uppercase tracking-widest mb-4">Ресурсы</p>
              <div className="space-y-3">
                <a href="#" className="block text-sm text-white/30 hover:text-white transition-colors">Документация</a>
                <a href="#" className="block text-sm text-white/30 hover:text-white transition-colors">Шаблоны</a>
                <a href="#" className="block text-sm text-white/30 hover:text-white transition-colors">Блог</a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-white/50 uppercase tracking-widest mb-4">Соцсети</p>
              <div className="space-y-3">
                <a href="#" className="block text-sm text-white/30 hover:text-white transition-colors">Telegram</a>
                <a href="#" className="block text-sm text-white/30 hover:text-white transition-colors">Twitter / X</a>
                <a href="#" className="block text-sm text-white/30 hover:text-white transition-colors">GitHub</a>
              </div>
            </div>
          </div>
          <div className="border-t border-white/[0.06] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-white/20 font-medium">© 2025 НейроЗодчий. Все права защищены.</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-white/30 font-medium">System Operational</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
