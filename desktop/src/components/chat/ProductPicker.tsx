import { Loader2, RefreshCw, Search, ShoppingBag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WhatsAppProduct } from "@/types/crm";
import { useI18n } from "@/i18n";

type Props = {
  products: WhatsAppProduct[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSend: (product: WhatsAppProduct) => Promise<void>;
};

function priceLabel(product: WhatsAppProduct) {
  const amount = product.price / 1000;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: product.currency,
    }).format(amount);
  } catch {
    return `${product.currency} ${amount.toFixed(2)}`.trim();
  }
}

export function ProductPicker({
  products,
  loading,
  onClose,
  onRefresh,
  onSend,
}: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return products;
    return products.filter((product) =>
      `${product.name} ${product.description} ${product.retailerId}`
        .toLowerCase()
        .includes(value)
    );
  }, [products, query]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyId) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busyId, onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busyId) onClose();
      }}
    >
      <div className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
            <ShoppingBag className="h-4 w-4 text-brand" />
            {"WhatsApp \u5546\u54c1\u76ee\u5f55"}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || busyId !== null}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
              title={t("tooltip.refreshCatalog")}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busyId !== null}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
              aria-label={t("tooltip.closePicker")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="border-b border-zinc-800 p-3">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 focus-within:border-brand/60">
            <Search className="h-4 w-4 text-zinc-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={"\u641c\u7d22\u5546\u54c1"}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
              autoFocus
            />
          </label>
        </div>
        <div className="min-h-64 overflow-y-auto p-3">
          {loading && !products.length ? (
            <div className="flex h-64 items-center justify-center gap-2 text-[12px] text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {"\u6b63\u5728\u540c\u6b65\u5546\u54c1\u76ee\u5f55\u2026"}
            </div>
          ) : filtered.length ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.map((product) => (
                <div
                  key={product.id}
                  className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5"
                >
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-800">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ShoppingBag className="h-6 w-6 text-zinc-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-zinc-100">
                      {product.name}
                    </div>
                    <div className="mt-0.5 text-[12px] font-semibold text-brand">
                      {priceLabel(product)}
                    </div>
                    <div className="mt-1 line-clamp-2 text-2xs leading-4 text-zinc-500">
                      {product.description || product.retailerId}
                    </div>
                    <button
                      type="button"
                      disabled={busyId !== null || !product.imageUrl}
                      onClick={() => {
                        setBusyId(product.id);
                        void onSend(product)
                          .then(onClose)
                          .catch(() => undefined)
                          .finally(() => setBusyId(null));
                      }}
                      className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-[11px] font-medium text-white hover:brightness-110 disabled:opacity-40"
                    >
                      {busyId === product.id && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {"\u53d1\u9001\u5546\u54c1"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-[12px] text-zinc-600">
              {query ? "\u6ca1\u6709\u5339\u914d\u5546\u54c1" : "\u5546\u54c1\u76ee\u5f55\u4e3a\u7a7a"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
