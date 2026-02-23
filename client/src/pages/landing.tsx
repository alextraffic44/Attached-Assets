import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
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
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: {
    transition: { staggerChildren: 0.1 },
  },
};

const plans = [
  {
    name: "Бронза",
    price: "Бесплатно",
    credits: 10,
    color: "from-amber-700 to-amber-900",
    borderColor: "border-amber-700/30",
    features: ["10 генераций", "Базовые шаблоны", "Скачивание HTML"],
    popular: false,
  },
  {
    name: "Серебро",
    price: "490 руб/мес",
    credits: 50,
    color: "from-slate-400 to-slate-600",
    borderColor: "border-slate-400/30",
    features: ["50 генераций", "Все шаблоны", "Правки через чат", "Скачивание ZIP"],
    popular: false,
  },
  {
    name: "Золото",
    price: "990 руб/мес",
    credits: 200,
    color: "from-yellow-500 to-amber-600",
    borderColor: "border-yellow-500/30",
    features: [
      "200 генераций",
      "Все шаблоны",
      "Генерация по фото",
      "Приоритетная генерация",
      "Экспорт в ZIP",
    ],
    popular: true,
  },
  {
    name: "Платина",
    price: "2490 руб/мес",
    credits: 1000,
    color: "from-cyan-400 to-blue-600",
    borderColor: "border-cyan-400/30",
    features: [
      "1000 генераций",
      "Все функции",
      "API доступ",
      "Приоритетная поддержка",
      "Генерация изображений",
    ],
    popular: false,
  },
];

const features = [
  {
    icon: MessageSquare,
    title: "Генерация по промту",
    description: "Опишите сайт текстом — ИИ создаст полный HTML/CSS/JS код за секунды",
  },
  {
    icon: Layers,
    title: "Готовые шаблоны",
    description: "Выберите структуру из библиотеки шаблонов и настройте под себя",
  },
  {
    icon: Image,
    title: "Генерация по фото",
    description: "Загрузите скриншот — ИИ воссоздаст дизайн в чистом коде",
  },
  {
    icon: Eye,
    title: "Живой превью",
    description: "Мгновенный предпросмотр сайта прямо в редакторе",
  },
  {
    icon: Code2,
    title: "Чистый код",
    description: "Семантический HTML5, адаптивный CSS и современный JavaScript",
  },
  {
    icon: Download,
    title: "Экспорт в ZIP",
    description: "Скачайте готовый сайт одним архивом и разместите где угодно",
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold" data-testid="text-logo">НейроЗодчий</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground transition-colors" data-testid="link-features">Возможности</a>
            <a href="#pricing" className="text-sm text-muted-foreground transition-colors" data-testid="link-pricing">Тарифы</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/auth")} data-testid="button-login">
              Войти
            </Button>
            <Button size="sm" onClick={() => setLocation("/auth")} data-testid="button-register">
              Начать бесплатно
            </Button>
          </div>
        </div>
      </header>

      <section className="relative pt-20 pb-32 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute top-20 -left-20 w-72 h-72 rounded-full bg-chart-3/5 blur-3xl" />
          <div className="absolute bottom-0 right-1/3 w-80 h-80 rounded-full bg-chart-2/5 blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center max-w-4xl mx-auto"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.div variants={fadeUp} transition={{ duration: 0.6 }}>
              <Badge variant="secondary" className="mb-6 px-4 py-1.5">
                <Zap className="w-3 h-3 mr-1" />
                Gemini 3.1 Pro
              </Badge>
            </motion.div>

            <motion.h1
              className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-tight"
              variants={fadeUp}
              transition={{ duration: 0.6, delay: 0.1 }}
              data-testid="text-hero-title"
            >
              Создавайте сайты{" "}
              <span className="text-primary">силой мысли</span>
            </motion.h1>

            <motion.p
              className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed"
              variants={fadeUp}
              transition={{ duration: 0.6, delay: 0.2 }}
              data-testid="text-hero-description"
            >
              ИИ-конструктор нового поколения. Опишите сайт, загрузите скриншот
              или выберите шаблон — получите готовый код за секунды.
            </motion.p>

            <motion.div
              className="flex flex-wrap justify-center gap-3"
              variants={fadeUp}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <Button size="lg" onClick={() => setLocation("/auth")} data-testid="button-hero-start">
                Создать сайт бесплатно
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })} data-testid="button-hero-learn">
                Узнать больше
              </Button>
            </motion.div>
          </motion.div>

          <motion.div
            className="mt-20 relative max-w-5xl mx-auto"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
          >
            <div className="rounded-xl border bg-card/50 backdrop-blur-sm p-1.5 shadow-xl">
              <div className="rounded-lg bg-card overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-3 border-b bg-muted/30">
                  <div className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-chart-4/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-chart-2/60" />
                  <span className="text-xs text-muted-foreground ml-2">НейроЗодчий — Редактор</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                  <div className="p-6 border-r border-border/50">
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <MessageSquare className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="rounded-lg bg-muted/50 p-3 text-sm">
                          Создай лендинг для кофейни с тёмным дизайном, меню и формой бронирования
                        </div>
                      </div>
                      <div className="flex items-start gap-3 justify-end">
                        <div className="rounded-lg bg-primary/10 p-3 text-sm max-w-[80%]">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Sparkles className="w-3 h-3 text-primary" />
                            <span className="text-xs font-medium text-primary">НейроЗодчий</span>
                          </div>
                          Генерирую сайт с адаптивным дизайном...
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 bg-muted/20">
                    <div className="space-y-2">
                      <div className="h-4 w-3/4 rounded bg-muted/50" />
                      <div className="h-20 w-full rounded bg-muted/30" />
                      <div className="grid grid-cols-3 gap-2">
                        <div className="h-14 rounded bg-muted/40" />
                        <div className="h-14 rounded bg-muted/40" />
                        <div className="h-14 rounded bg-muted/40" />
                      </div>
                      <div className="h-3 w-1/2 rounded bg-muted/30" />
                      <div className="h-3 w-2/3 rounded bg-muted/30" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="features" className="py-24 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
          >
            <motion.h2
              className="text-3xl sm:text-4xl font-bold mb-4"
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              data-testid="text-features-title"
            >
              Всё для создания сайтов
            </motion.h2>
            <motion.p
              className="text-muted-foreground text-lg max-w-2xl mx-auto"
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Мощные инструменты для превращения ваших идей в работающие сайты
            </motion.p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
          >
            {features.map((feature) => (
              <motion.div key={feature.title} variants={fadeUp} transition={{ duration: 0.5 }}>
                <Card className="p-6 h-full hover-elevate cursor-default" data-testid={`card-feature-${feature.title}`}>
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                    <feature.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section id="pricing" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
          >
            <motion.h2
              className="text-3xl sm:text-4xl font-bold mb-4"
              variants={fadeUp}
              transition={{ duration: 0.5 }}
              data-testid="text-pricing-title"
            >
              Выберите свой тариф
            </motion.h2>
            <motion.p
              className="text-muted-foreground text-lg max-w-2xl mx-auto"
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Начните бесплатно и масштабируйте по мере роста
            </motion.p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
          >
            {plans.map((plan) => (
              <motion.div key={plan.name} variants={fadeUp} transition={{ duration: 0.5 }}>
                <Card
                  className={`relative p-6 h-full flex flex-col ${plan.popular ? "ring-2 ring-primary" : ""}`}
                  data-testid={`card-plan-${plan.name}`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="px-3">
                        <Star className="w-3 h-3 mr-1" />
                        Популярный
                      </Badge>
                    </div>
                  )}

                  <div className={`w-full h-1.5 rounded-full bg-gradient-to-r ${plan.color} mb-5`} />

                  <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                  <p className="text-2xl font-bold mb-1">{plan.price}</p>
                  <p className="text-sm text-muted-foreground mb-5">{plan.credits} генераций</p>

                  <ul className="space-y-2.5 mb-6 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    className="w-full"
                    variant={plan.popular ? "default" : "outline"}
                    onClick={() => setLocation("/auth")}
                    data-testid={`button-plan-${plan.name}`}
                  >
                    {plan.price === "Бесплатно" ? "Начать бесплатно" : "Подключить"}
                  </Button>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-24 bg-muted/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.h2
              className="text-3xl sm:text-4xl font-bold mb-4"
              variants={fadeUp}
              transition={{ duration: 0.5 }}
            >
              Готовы создать свой сайт?
            </motion.h2>
            <motion.p
              className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto"
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Присоединяйтесь к тысячам пользователей, которые уже создают сайты с помощью ИИ
            </motion.p>
            <motion.div variants={fadeUp} transition={{ duration: 0.5, delay: 0.2 }}>
              <Button size="lg" onClick={() => setLocation("/auth")} data-testid="button-cta-start">
                Начать бесплатно
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <footer className="border-t py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold">НейроЗодчий</span>
            </div>
            <p className="text-sm text-muted-foreground">
              2025 НейроЗодчий. Все права защищены.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
