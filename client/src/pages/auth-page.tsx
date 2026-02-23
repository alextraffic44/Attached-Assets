import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Mail, Lock, User, ArrowLeft, Loader2 } from "lucide-react";

const SkeuoCard = ({ children, className = "" }) => (
  <div className={`bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-skeuo-lg rounded-[2.5rem] p-10 ${className}`}>
    {children}
  </div>
);

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, displayName);
      }
      setLocation("/dashboard");
    } catch (err: any) {
      toast({
        title: "Ошибка",
        description: err.message?.includes("401") ? "Неверный email или пароль" : "Произошла ошибка",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0F172A] flex items-center justify-center p-6 overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-full -z-10">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-chart-3/10 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-lg"
      >
        <Button
          variant="ghost"
          className="mb-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Назад
        </Button>

        <SkeuoCard>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-chart-3 flex items-center justify-center shadow-lg shadow-primary/20">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-black tracking-tighter uppercase">НЕЙРОЗОДЧИЙ</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={isLogin ? "login" : "register"}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <h1 className="text-3xl font-black mb-2 tracking-tight">
                {isLogin ? "С возвращением" : "Создать аккаунт"}
              </h1>
              <p className="text-slate-500 mb-8 font-medium">
                {isLogin ? "Рады видеть вас снова в системе" : "Присоединяйтесь к нашему сообществу"}
              </p>

              <form onSubmit={handleSubmit} className="space-y-6">
                {!isLogin && (
                  <div className="space-y-2">
                    <Label className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">Имя</Label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        placeholder="Ваше имя"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="h-14 pl-12 rounded-2xl border-none bg-slate-100 dark:bg-slate-800 shadow-skeuo-inner focus-visible:ring-2 ring-primary/20 font-medium"
                        required={!isLogin}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-14 pl-12 rounded-2xl border-none bg-slate-100 dark:bg-slate-800 shadow-skeuo-inner focus-visible:ring-2 ring-primary/20 font-medium"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-black uppercase tracking-widest text-slate-400 px-1">Пароль</Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-14 pl-12 rounded-2xl border-none bg-slate-100 dark:bg-slate-800 shadow-skeuo-inner focus-visible:ring-2 ring-primary/20 font-medium"
                      required
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-16 rounded-2xl text-lg font-black shadow-xl shadow-primary/25 hover-elevate mt-4" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : (isLogin ? "Войти" : "Начать")}
                </Button>
              </form>

              <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800 text-center">
                <button
                  type="button"
                  className="text-sm font-bold text-slate-500 hover:text-primary transition-colors"
                  onClick={() => setIsLogin(!isLogin)}
                >
                  {isLogin ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </SkeuoCard>
      </motion.div>
    </div>
  );
}
