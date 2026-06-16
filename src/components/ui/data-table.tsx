import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T, index: number) => React.ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
}

interface DataTableProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyText?: string;
  rowKey?: (row: T) => string | number;
}

export function DataTable<T>({
  columns,
  data,
  isLoading = false,
  emptyText = "Không có dữ liệu",
  rowKey,
  className,
  ...props
}: DataTableProps<T>) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm",
        className
      )}
      {...props}
    >
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm text-left text-zinc-900">
          <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-bold uppercase tracking-wider text-zinc-500">
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={col.key || idx}
                  className={cn(
                    "px-6 py-4 font-bold select-none",
                    col.align === "center" && "text-center",
                    col.align === "right" && "text-right",
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-12 text-center text-zinc-500">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-[--color-primary]" />
                    <span className="font-semibold text-xs uppercase tracking-wider">Đang tải...</span>
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-6 py-12 text-center text-zinc-400">
                  <div className="flex flex-col items-center justify-center gap-1.5 py-6">
                    <span className="text-zinc-300 font-bold text-lg">Empty</span>
                    <p className="text-sm font-semibold">{emptyText}</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row, rowIdx) => {
                const key = rowKey ? rowKey(row) : rowIdx;
                return (
                  <tr
                    key={key}
                    className="hover:bg-zinc-50/50 transition-colors"
                  >
                    {columns.map((col, colIdx) => (
                      <td
                        key={col.key || colIdx}
                        className={cn(
                          "px-6 py-4 align-middle",
                          !col.className?.includes("whitespace-") && "whitespace-nowrap",
                          col.align === "center" && "text-center",
                          col.align === "right" && "text-right",
                          col.className
                        )}
                      >
                        {col.render
                          ? col.render(row, rowIdx)
                          : String((row as Record<string, unknown>)[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
