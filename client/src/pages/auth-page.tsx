import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Mail, Lock, User, ArrowLeft, Loader2 } from "lucide-react";

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
        description: err.message?.includes("401")
          ? "Неверный email или пароль"
          : err.message?.includes("400")
            ? "Проверьте введённые данные"
            : "Произошла ошибка. Попробуйте снова.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <Button
            variant="ghost"
            size="sm"
            className="mb-8"
            onClick={() => setLocation("/")}
            data-testid="button-back-landing"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            На главную
          </Button>

          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">НейроЗодчий</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={isLogin ? "login" : "register"}
              initial={{ opacity: 0, x: isLogin ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isLogin ? 20 : -20 }}
              transition={{ duration: 0.2 }}
            >
              <h1 className="text-2xl font-bold mb-1" data-testid="text-auth-title">
                {isLogin ? "Войти в аккаунт" : "Создать аккаунт"}
              </h1>
              <p className="text-muted-foreground mb-6">
                {isLogin
                  ? "Введите данные для входа в личный кабинет"
                  : "Заполните данные для регистрации"}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <div className="space-y-2">
                    <Label htmlFor="displayName">Имя</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="displayName"
                        type="text"
                        placeholder="Ваше имя"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="pl-9"
                        required={!isLogin}
                        data-testid="input-displayname"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                      required
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Пароль</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Минимум 6 символов"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9"
                      required
                      minLength={6}
                      data-testid="input-password"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-submit-auth">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {isLogin ? "Вход..." : "Регистрация..."}
                    </>
                  ) : (
                    isLogin ? "Войти" : "Зарегистрироваться"
                  )}
                </Button>
              </form>

              <p className="text-sm text-muted-foreground text-center mt-6">
                {isLogin ? "Нет аккаунта?" : "Уже есть аккаунт?"}{" "}
                <button
                  type="button"
                  className="text-primary font-medium"
                  onClick={() => setIsLogin(!isLogin)}
                  data-testid="button-toggle-auth"
                >
                  {isLogin ? "Зарегистрироваться" : "Войти"}
                </button>
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-muted/30 p-8 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full bg-chart-3/5 blur-3xl" />
        </div>

        <div className="relative max-w-md text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-8">
              <Sparkles className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-3">
              Создавайте сайты с помощью ИИ
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Опишите свой сайт текстом, загрузите скриншот или выберите шаблон.
              НейроЗодчий сгенерирует полный HTML/CSS/JS код за секунды.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
