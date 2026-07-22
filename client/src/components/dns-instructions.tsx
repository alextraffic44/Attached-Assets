import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f1f5f9", borderRadius: 8, padding: "0.45rem 0.75rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
      <span style={{ color: "#1e40af", fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#374151" }}>{value}</span>
        <button onClick={copy} type="button" style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#16a34a" : "#6b7280", fontSize: "0.7rem", padding: "2px 6px", borderRadius: 4 }} title="Скопировать">
          {copied ? "✓" : "📋"}
        </button>
      </div>
    </div>
  );
}

export function DnsInstructions({
  customDomain,
  aRecordIp,
  domainChecking,
  domainVerified,
  domainDnsReady,
  domainStatusMessage,
  onCheck,
  testId,
}: {
  customDomain: string;
  aRecordIp: string;
  domainChecking: boolean;
  domainVerified: boolean | null;
  domainDnsReady: boolean;
  domainStatusMessage: string;
  onCheck: () => void;
  testId?: string;
}) {
  const apex = customDomain.replace(/^www\./, "");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "0.75rem 1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1d4ed8", marginBottom: 10 }}>
          Осталось одно действие — добавьте A-записи в DNS домена
        </div>
        <div style={{ fontSize: "0.78rem", color: "#374151", lineHeight: 1.8 }}>
          <div style={{ marginBottom: 8 }}>
            <b>1.</b> Откройте панель управления DNS у вашего регистратора (например,{" "}
            <a href="https://www.reg.ru/user/domain-list" target="_blank" rel="noreferrer" style={{ color: "#1d4ed8", textDecoration: "underline" }}>
              reg.ru
            </a>{" "}
            → <b>Домены</b> → <b>{apex}</b> → «<b>Управление DNS-записями</b>»)
          </div>
          <div style={{ marginBottom: 8 }}><b>2.</b> Добавьте две A-записи, указывающие на наш сервер:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "4px 0 10px" }}>
            <CopyRow label="A  @ (или пусто)" value={aRecordIp || "—"} />
            <CopyRow label="A  www" value={aRecordIp || "—"} />
          </div>
          <div>
            <b>3.</b> Сохраните. DNS обновится обычно за 5–30 минут (иногда до 24 часов), после чего сайт откроется на <b>{apex}</b> с бесплатным SSL-сертификатом.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Button size="sm" variant="outline" onClick={onCheck} disabled={domainChecking} style={{ borderRadius: 10, fontSize: "0.78rem" }} data-testid={testId}>
          {domainChecking ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Проверить DNS
        </Button>
        {domainChecking === false && domainVerified === false && !domainDnsReady && domainVerified !== null && (
          <span style={{ fontSize: "0.75rem", color: "#f59e0b", fontWeight: 500 }}>{domainStatusMessage || "DNS ещё обновляется — подождите"}</span>
        )}
        {domainChecking === false && domainVerified === false && domainDnsReady && (
          <span style={{ fontSize: "0.75rem", color: "#3b82f6", fontWeight: 500 }}>🔒 {domainStatusMessage || "DNS готов, SSL выпускается (до 1 минуты)"}</span>
        )}
        {domainChecking === false && domainVerified === true && (
          <span style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 500 }}>✓ Домен полностью работает!</span>
        )}
      </div>
    </div>
  );
}
