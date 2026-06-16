import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, WifiOff, ShieldAlert, RotateCcw } from "lucide-react";
import { Button } from "./button";

interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  errorType?: "unreachable" | "forbidden" | "not_configured" | "general";
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  errorType = "general",
  title,
  description,
  onRetry,
  className,
  ...props
}: ErrorStateProps) {
  const icons = {
    unreachable: <WifiOff className="w-8 h-8 text-[--color-danger]" />,
    forbidden: <ShieldAlert className="w-8 h-8 text-[--color-warning]" />,
    not_configured: <AlertCircle className="w-8 h-8 text-[--color-warning]" />,
    general: <AlertCircle className="w-8 h-8 text-[--color-danger]" />,
  };

  const bgs = {
    unreachable: "bg-[--color-danger-soft]",
    forbidden: "bg-[--color-warning-soft]",
    not_configured: "bg-[--color-warning-soft]",
    general: "bg-[--color-danger-soft]",
  };

  const defaultTitles = {
    unreachable: "Không thể kết nối Agent",
    forbidden: "Không có quyền truy cập",
    not_configured: "Chưa cấu hình quản trị Agent",
    general: "Đã xảy ra lỗi hệ thống",
  };

  const defaultDescriptions = {
    unreachable:
      "Backend Didi không thể kết nối tới Agent Backend. Vui lòng kiểm tra endpoint trong Agent Connect hoặc trạng thái dịch vụ Agent.",
    forbidden:
      "Bạn không có quyền thực hiện hành động này. Vui lòng liên hệ Admin để được nâng cấp vai trò.",
    not_configured:
      "Hệ thống chưa có Agent Connect hợp lệ. Vui lòng vào Quản trị Agent / Agent Connect để khai báo endpoint và token.",
    general:
      "Không thể xử lý yêu cầu lúc này. Vui lòng thử lại sau hoặc liên hệ bộ phận hỗ trợ.",
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center p-8 py-16 bg-white border border-zinc-200 rounded-2xl shadow-sm min-h-[300px]",
        className
      )}
      {...props}
    >
      <div className={cn("p-4 rounded-2xl mb-4 shrink-0", bgs[errorType])}>
        {icons[errorType]}
      </div>
      <h3 className="font-bold text-zinc-900 text-lg mb-1">
        {title || defaultTitles[errorType]}
      </h3>
      <p className="text-zinc-500 text-sm max-w-md mb-6 leading-relaxed">
        {description || defaultDescriptions[errorType]}
      </p>
      {onRetry && (
        <Button
          onClick={onRetry}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Thử lại</span>
        </Button>
      )}
    </div>
  );
}
