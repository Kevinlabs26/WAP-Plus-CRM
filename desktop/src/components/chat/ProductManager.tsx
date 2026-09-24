import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/store/appStore";
import type { WhatsAppProduct } from "@/types/crm";
import {
  baileysCreateProduct,
  baileysDeleteProduct,
  baileysUpdateProduct,
} from "@/lib/baileys";

type Props = {
  products: WhatsAppProduct[];
  loading: boolean;
  accountId: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
};

type Draft = {
  name: string;
  description: string;
  price: string;
  currency: string;
  retailerId: string;
  url: string;
  originCountryCode: string;
};

const emptyDraft: Draft = {
  name: "",
  description: "",
  price: "",
  currency: "EUR",
  retailerId: "",
  url: "",
  originCountryCode: "",
};

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function imageFor(product: WhatsAppProduct) {
  return product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : null;
}

export function ProductManager({ products, loading, accountId, onClose, onRefresh }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<WhatsAppProduct | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const toast = useAppStore((state) => state.pushToast);

  const startCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setImage(null);
    setFormOpen(true);
  };

  const startEdit = (product: WhatsAppProduct) => {
    setEditing(product);
    setDraft({
      name: product.name,
      description: product.description,
      price: (product.price / 1000).toString(),
      currency: product.currency || "EUR",
      retailerId: product.retailerId,
      url: product.url,
      originCountryCode: "",
    });
    setImage(null);
    setFormOpen(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing && !image) {
      toast(t("catalog.imageRequired"), "error");
      return;
    }
    if (image && image.size > 10_000_000) {
      toast(t("catalog.imageTooLarge"), "error");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...draft,
        price: Number(draft.price),
        imageDataUrl: image ? await fileDataUrl(image) : undefined,
      };
      if (editing) await baileysUpdateProduct(editing.id, payload, accountId);
      else await baileysCreateProduct(payload, accountId);
      await onRefresh();
      toast(t(editing ? "catalog.updated" : "catalog.created"), "success");
      setFormOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("catalog.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (product: WhatsAppProduct) => {
    if (!window.confirm(t("catalog.confirmDelete", { name: product.name }))) return;
    setBusy(true);
    try {
      await baileysDeleteProduct(product.id, accountId);
      await onRefresh();
      toast(t("catalog.deleted"), "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : t("catalog.deleteFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof Draft, label: string, type = "text", required = false) => (
    <label className="block text-[11px] text-zinc-400">
      {label}
      <input
        type={type}
        required={required}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
        value={draft[key]}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        className="mt-1 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 text-[12px] text-zinc-100 outline-none focus:border-brand"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[71] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[2px]">
      <section className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-[13px] font-semibold text-zinc-100">{t("catalog.manageTitle")}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40" aria-label={t("tooltip.closePicker")}>
            <X className="h-4 w-4" />
          </button>
        </header>

        {formOpen ? (
          <form onSubmit={save} className="space-y-3 overflow-y-auto p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {field("name", t("catalog.name"), "text", true)}
              {field("price", t("catalog.price"), "number", true)}
              {field("currency", t("catalog.currency"), "text", true)}
              {field("retailerId", t("catalog.retailerId"))}
              {field("url", t("catalog.url"), "url")}
              {!editing && field("originCountryCode", t("catalog.originCountry"))}
            </div>
            <label className="block text-[11px] text-zinc-400">
              {t("catalog.description")}
              <textarea
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                className="mt-1 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-[12px] text-zinc-100 outline-none focus:border-brand"
              />
            </label>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-800">
                {editing ? imageFor(editing) : <ImagePlus className="h-5 w-5 text-zinc-500" />}
              </div>
              <div>
                <button type="button" onClick={() => imageInput.current?.click()} className="rounded-lg border border-zinc-700 px-3 py-2 text-[11px] text-zinc-200 hover:bg-zinc-800">
                  {t("catalog.chooseImage")}
                </button>
                <div className="mt-1 text-2xs text-zinc-500">{image?.name || t(editing ? "catalog.imageOptional" : "catalog.imageRequiredHint")}</div>
                <input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={(event) => setImage(event.target.files?.[0] || null)} />
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
              <button type="button" disabled={busy} onClick={() => setFormOpen(false)} className="rounded-lg px-3 py-2 text-[11px] text-zinc-400 hover:bg-zinc-800">{t("composer.cancel")}</button>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-[11px] font-medium text-white disabled:opacity-50">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("catalog.save")}
              </button>
            </footer>
          </form>
        ) : (
          <>
            <div className="flex justify-end border-b border-zinc-800 p-3">
              <button type="button" onClick={startCreate} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[11px] font-medium text-white disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" />{t("catalog.add")}
              </button>
            </div>
            <div className="min-h-48 overflow-y-auto p-3">
              {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-zinc-500" /></div> : products.length ? (
                <div className="space-y-2">
                  {products.map((product) => (
                    <div key={product.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-2.5">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-800">{imageFor(product)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-zinc-100">{product.name}</div>
                        <div className="text-2xs text-zinc-500">{product.currency} {(product.price / 1000).toFixed(2)}</div>
                      </div>
                      <button type="button" onClick={() => startEdit(product)} disabled={busy} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40" title={t("catalog.edit")}><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void remove(product)} disabled={busy} className="rounded-lg p-2 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40" title={t("catalog.delete")}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              ) : <div className="flex h-48 items-center justify-center text-[12px] text-zinc-500">{t("catalog.empty")}</div>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
