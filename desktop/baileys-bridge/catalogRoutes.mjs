import { json, requestBody } from "./httpUtil.mjs";
import { parseDataUrl } from "./audioConvert.mjs";

function productPayload(product) {
  return {
    id: product.id,
    name: product.name || "",
    description: product.description || "",
    price: Number(product.price) || 0,
    currency: product.currency || "",
    retailerId: product.retailerId || "",
    url: product.url || "",
    imageUrl: Object.values(product.imageUrls || {}).find(Boolean) || "",
  };
}

function imageBuffer(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed?.mime.startsWith("image/") || !parsed.buf.length || parsed.buf.length > 10_000_000) {
    throw new Error("商品图片无效，图片需小于 10 MB");
  }
  return parsed.buf;
}

function productFields(body) {
  const name = String(body.name || "").trim().slice(0, 100);
  const description = String(body.description || "").trim().slice(0, 2000);
  const currency = String(body.currency || "").trim().toUpperCase();
  const amount = Number(body.price);
  if (!name || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(amount) || amount < 0) {
    throw new Error("请填写商品名称、有效价格和三位货币代码");
  }
  const price = Math.round(amount * 1000);
  if (!Number.isSafeInteger(price)) throw new Error("商品价格超出可用范围");
  return {
    name,
    description,
    price,
    currency,
    retailerId: String(body.retailerId || "").trim().slice(0, 100) || undefined,
    url: String(body.url || "").trim().slice(0, 2000) || undefined,
    isHidden: false,
  };
}

export async function tryHandleCatalogRoutes(req, res, url, d) {
  if (!["/catalog", "/catalog/send", "/catalog/create", "/catalog/update", "/catalog/delete"].includes(url.pathname)) return false;
  if (d.connection !== "connected" || !d.socket) {
    json(res, 409, { error: "WhatsApp is not connected" });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/catalog") {
    const products = [];
    let cursor;
    for (let page = 0; page < 5; page++) {
      const result = await d.socket.getCatalog({ limit: 50, cursor });
      products.push(...(result.products || []));
      cursor = result.nextPageCursor;
      if (!cursor) break;
    }
    const visible = products.filter((product) => !product.isHidden);
    d.products.clear();
    for (const product of visible) if (product?.id) d.products.set(product.id, product);
    json(res, 200, { ok: true, products: visible.map(productPayload) });
    return true;
  }

  if (req.method !== "POST") return false;
  const body = await requestBody(req);
  if (url.pathname === "/catalog/send") {
    const address = String(body.jid || body.phoneE164 || "").trim();
    const product = d.products.get(String(body.productId || "").trim());
    if (!address || !product) {
      json(res, 400, { error: "Missing recipient or catalog product" });
      return true;
    }
    const imageUrl = Object.values(product.imageUrls || {}).find(Boolean);
    if (!imageUrl) {
      json(res, 400, { error: "Product has no image" });
      return true;
    }
    const jid = await d.resolveSendJid(address);
    if (!jid) {
      json(res, 400, { error: "Invalid recipient" });
      return true;
    }
    const ownerJid = String(d.socket.user?.id || "").replace(/:\\d+@/, "@");
    const result = await d.socket.sendMessage(jid, {
      product: {
        productImage: { url: imageUrl },
        productId: product.id,
        title: product.name,
        description: product.description || "",
        currencyCode: product.currency,
        priceAmount1000: Number(product.price) || 0,
        retailerId: product.retailerId,
        url: product.url,
        productImageCount: Object.keys(product.imageUrls || {}).length,
      },
      businessOwnerJid: ownerJid,
      body: String(body.caption || "").trim() || undefined,
    });
    json(res, 200, { ok: true, id: result?.key?.id, jid, productId: product.id });
    return true;
  }
  if (url.pathname === "/catalog/create") {
    let fields;
    let image;
    try {
      fields = productFields(body);
      image = imageBuffer(body.imageDataUrl);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const originCountryCode = String(body.originCountryCode || "").trim().toUpperCase();
    if (originCountryCode && !/^[A-Z]{2}$/.test(originCountryCode)) {
      json(res, 400, { error: "原产国请使用两位国家代码" });
      return true;
    }
    const product = await d.socket.productCreate({
      ...fields,
      originCountryCode: originCountryCode || undefined,
      images: [image],
    });
    if (product?.id) d.products.set(product.id, product);
    json(res, 200, { ok: true, product: productPayload(product) });
    return true;
  }

  if (url.pathname === "/catalog/update") {
    const id = String(body.id || "").trim();
    const previous = d.products.get(id);
    if (!id || !previous) {
      json(res, 404, { error: "商品目录已过期，请先刷新" });
      return true;
    }
    let fields;
    let image;
    try {
      fields = productFields(body);
      image = body.imageDataUrl
        ? imageBuffer(body.imageDataUrl)
        : { url: Object.values(previous.imageUrls || {}).find(Boolean) || "" };
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    if (!image.url && !Buffer.isBuffer(image)) {
      json(res, 400, { error: "商品没有可用图片，请重新选择图片" });
      return true;
    }
    const product = await d.socket.productUpdate(id, {
      ...fields,
      images: [image],
    });
    if (product?.id) d.products.set(product.id, product);
    json(res, 200, { ok: true, product: productPayload(product) });
    return true;
  }

  if (url.pathname === "/catalog/delete") {
    const id = String(body.id || "").trim();
    if (!id || !d.products.has(id)) {
      json(res, 404, { error: "商品目录已过期，请先刷新" });
      return true;
    }
    const result = await d.socket.productDelete([id]);
    d.products.delete(id);
    json(res, 200, { ok: true, deleted: result.deleted });
    return true;
  }

  return false;
}
