import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { Coins, MessageCircle, Phone, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCredits?: number;
  requiredCredits?: number;
}

export default function InsufficientCreditsDialog({ open, onOpenChange, currentCredits, requiredCredits }: Props) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            {t("credits.insufficientTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {(currentCredits !== undefined || requiredCredits !== undefined) && (
            <div className="flex gap-3 justify-center">
              {currentCredits !== undefined && (
                <div className="text-center p-3 rounded-lg bg-amber-50 border border-amber-200 flex-1">
                  <p className="text-xs text-amber-600 mb-1">{t("credits.currentBalance")}</p>
                  <p className="text-2xl font-bold text-amber-700">{currentCredits}</p>
                </div>
              )}
              {requiredCredits !== undefined && (
                <div className="text-center p-3 rounded-lg bg-red-50 border border-red-200 flex-1">
                  <p className="text-xs text-red-600 mb-1">{t("credits.requiredCredits")}</p>
                  <p className="text-2xl font-bold text-red-700">{requiredCredits}</p>
                </div>
              )}
            </div>
          )}

          <p className="text-sm text-muted-foreground text-center">
            {t("credits.insufficientDesc")}
          </p>

          <div className="space-y-2 p-4 rounded-xl bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200">
            <p className="text-sm font-medium text-blue-800 text-center mb-3">{t("credits.contactConsultant")}</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-2 rounded-lg bg-white/70">
                <MessageCircle className="h-4 w-4 text-green-600 shrink-0" />
                <span className="text-sm font-medium">{t("credits.consultantWeChat")}</span>
              </div>
              <div className="flex items-center gap-3 p-2 rounded-lg bg-white/70">
                <Phone className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="text-sm font-medium">{t("credits.consultantWhatsApp")}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
            {t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
