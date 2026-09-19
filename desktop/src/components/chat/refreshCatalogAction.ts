import { baileysCatalog } from "@/lib/baileys";
import type { AppState } from "@/store/appStore";
import type { WhatsAppProduct } from "@/types/crm";

type RefreshCatalogActionDeps = {
  chatAccountId: string | null;
  setCatalogLoading: (loading: boolean) => void;
  setProducts: (products: WhatsAppProduct[]) => void;
  pushToast: AppState["pushToast"];
};

export async function refreshCatalog({
  chatAccountId,
  setCatalogLoading,
  setProducts,
  pushToast,
}: RefreshCatalogActionDeps) {
  setCatalogLoading(true);
  try {
    const result = await baileysCatalog(chatAccountId);
    setProducts(result.products || []);
  } catch (error) {
    pushToast(
      error instanceof Error ? error.message : "商品目录同步失败",
      "error"
    );
  } finally {
    setCatalogLoading(false);
  }
}
