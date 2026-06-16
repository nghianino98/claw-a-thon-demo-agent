"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { Tabs } from "@/components/ui/tabs";
import { BotConnectionPanel } from "@/components/bot-management/bot-connection-panel";
import { BotAccessPanel } from "@/components/bot-management/bot-access-panel";
import { useTranslation } from "@/lib/store/i18n-store";
import { Plug, ShieldCheck } from "lucide-react";

export default function BotManagementPage() {
  const t = useTranslation();
  const [tab, setTab] = React.useState("connect");

  return (
    <PageShell>
      <PageHeader title={t("navBotManagement")} subtitle={t("botMgmtSubtitle")} />

      <Tabs
        tabs={[
          { id: "connect", label: t("botMgmtTabConnect"), icon: Plug },
          { id: "access", label: t("botMgmtTabAccess"), icon: ShieldCheck },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      <div className="mt-4">{tab === "connect" ? <BotConnectionPanel /> : <BotAccessPanel />}</div>
    </PageShell>
  );
}
