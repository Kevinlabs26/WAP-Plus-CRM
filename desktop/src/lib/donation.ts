/**
 * 捐赠配置（海外平台）。软件免费，这里只是给愿意支持的用户一个入口。
 * 支持链接：Ko-fi、Buy Me a Coffee、Lemon Squeezy。
 */
export type DonationPlatform = {
  id: string;
  label: string;
  descriptionKey:
    | "donate.platform.koFi"
    | "donate.platform.buyMeACoffee"
    | "donate.platform.lemonSqueezy";
  url: string;
  icon: "coffee" | "github" | "heart" | "star";
};

export const DONATION_PLATFORMS: DonationPlatform[] = [
  {
    id: "ko-fi",
    label: "Ko-fi",
    descriptionKey: "donate.platform.koFi",
    url: "https://ko-fi.com/kevinlabs",
    icon: "coffee",
  },
  {
    id: "bmac",
    label: "Buy Me a Coffee",
    descriptionKey: "donate.platform.buyMeACoffee",
    url: "https://buymeacoffee.com/kevinlabs26",
    icon: "coffee",
  },
  {
    id: "lemonsqueezy",
    label: "Lemon Squeezy",
    descriptionKey: "donate.platform.lemonSqueezy",
    url: "https://kevinlabs.lemonsqueezy.com/checkout/buy/7b60b363-50b5-4233-a982-91a0611eccd6",
    icon: "star",
  },
];

export function donationQrUrl(url: string, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=12&data=${encodeURIComponent(url)}`;
}
