"use client";

import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { BotAccessPanel } from "@/components/bot-management/bot-access-panel";
import { useTranslation } from "@/lib/store/i18n-store";

export default function AccessPage() {
  const t = useTranslation();
  return (
    <PageShell>
      <PageHeader title={t("accessTitle")} subtitle={t("accessSubtitle")} />
      <BotAccessPanel />
    </PageShell>
  );
}
