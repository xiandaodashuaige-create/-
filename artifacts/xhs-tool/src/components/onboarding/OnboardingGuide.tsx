import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  Search, Wand2, ShieldCheck, Coins,
  ChevronRight, ChevronLeft, X, Sparkles
} from "lucide-react";

const STEPS = [
  { icon: Search, color: "from-blue-500 to-cyan-500", image: "🔍" },
  { icon: Wand2, color: "from-purple-500 to-pink-500", image: "✨" },
  { icon: ShieldCheck, color: "from-green-500 to-emerald-500", image: "🛡️" },
  { icon: Coins, color: "from-amber-500 to-orange-500", image: "💰" },
];

export default function OnboardingGuide() {
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    const localSeen = localStorage.getItem("onboarding-completed");
    if (localSeen) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    fetch("/api/user/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((user) => {
        if (user?.onboardingCompleted) {
          localStorage.setItem("onboarding-completed", "1");
        } else {
          timer = setTimeout(() => setVisible(true), 800);
        }
      })
      .catch(() => {
        timer = setTimeout(() => setVisible(true), 800);
      });
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  function handleClose() {
    setVisible(false);
    localStorage.setItem("onboarding-completed", "1");
    fetch("/api/user/me", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingCompleted: 1 }),
    }).catch(() => {});
  }

  function handleNext() {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  }

  if (!visible) return null;

  const step = STEPS[currentStep];
  const StepIcon = step.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-w-[90vw] overflow-hidden">
        <div className={`bg-gradient-to-r ${step.color} p-8 text-white text-center relative`}>
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {currentStep === 0 && (
            <div className="mb-4">
              <Sparkles className="h-10 w-10 mx-auto mb-2 animate-pulse" />
              <h2 className="text-xl font-bold">{t("onboarding.welcome")}</h2>
              <p className="text-sm text-white/80 mt-1">{t("onboarding.welcomeDesc")}</p>
            </div>
          )}

          <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center mx-auto text-4xl">
            {step.image}
          </div>
        </div>

        <div className="p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <StepIcon className="h-5 w-5 text-gray-700" />
            <h3 className="text-lg font-bold">
              {t(`onboarding.step${currentStep + 1}.title`)}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t(`onboarding.step${currentStep + 1}.desc`)}
          </p>

          <div className="flex justify-center gap-1.5 my-5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep ? "w-6 bg-red-500" : "w-1.5 bg-gray-200"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div>
              {currentStep > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(currentStep - 1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  {t("common.prev")}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground">
                  {t("onboarding.skip")}
                </Button>
              )}
            </div>
            <Button
              onClick={handleNext}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {currentStep < STEPS.length - 1 ? (
                <>{t("onboarding.next")}<ChevronRight className="h-4 w-4 ml-1" /></>
              ) : (
                t("onboarding.start")
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
