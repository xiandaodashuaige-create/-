import { useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type Props = {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

// 统一二次确认弹窗：替换原生 confirm()，风格与项目 Radix UI 一致。
// 危险操作（destructive=true）按钮显示红色。
export function ConfirmDialog({
  trigger, title, description,
  confirmLabel = "确定", cancelLabel = "取消",
  destructive = false, onConfirm,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            onClick={async (e) => {
              e.preventDefault();
              setPending(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "处理中…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
