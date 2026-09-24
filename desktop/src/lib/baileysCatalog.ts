import { request } from "./baileysCore";

export type BaileysProductDraft = {
  name: string;
  description: string;
  price: number;
  currency: string;
  retailerId?: string;
  url?: string;
  originCountryCode?: string;
  imageDataUrl?: string;
};

export const baileysCreateProduct = (
  product: BaileysProductDraft,
  accountId?: string | null
) =>
  request<{ ok: boolean }>(
    "/catalog/create",
    { method: "POST", body: JSON.stringify(product) },
    accountId
  );

export const baileysUpdateProduct = (
  id: string,
  product: BaileysProductDraft,
  accountId?: string | null
) =>
  request<{ ok: boolean }>(
    "/catalog/update",
    { method: "POST", body: JSON.stringify({ ...product, id }) },
    accountId
  );

export const baileysDeleteProduct = (
  id: string,
  accountId?: string | null
) =>
  request<{ ok: boolean; deleted: number }>(
    "/catalog/delete",
    { method: "POST", body: JSON.stringify({ id }) },
    accountId
  );
