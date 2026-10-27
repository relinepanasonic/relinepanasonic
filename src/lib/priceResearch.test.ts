import { describe, expect, it } from "vitest";
import { actorFor, buildInput, estimateCost, keyOfUrl, logHint, parseItem, shopeeCookieLooksLoggedIn, urlMatchesPlatform } from "./priceResearch";

describe("price research helpers", () => {
  it("accepts a product URL only on its own marketplace", () => {
    expect(urlMatchesPlatform("shopee", "https://shopee.co.id/Some-Product-i.123.456")).toBe(true);
    expect(urlMatchesPlatform("shopee", "https://www.tokopedia.com/shop/p")).toBe(false);
    expect(urlMatchesPlatform("tokopedia", "https://www.tokopedia.com/shop/p")).toBe(true);
    expect(urlMatchesPlatform("tiktok", "https://shop-id.tokopedia.com/pdp/x/1729653353364556550")).toBe(true);
    expect(urlMatchesPlatform("shopee", "not a url")).toBe(false);
  });

  it("builds each actor's input and lets an env var replace the actor", () => {
    expect(buildInput("shopee", ["u"], { APIFY_SHOPEE_COOKIE: "c" })).toMatchObject({ mode: "product_detail", urls: ["u"], region: "id", cookie: "c" });
    expect(buildInput("tokopedia", ["u"], {})).toMatchObject({ startUrls: ["u"], maxResults: 1 });
    expect(buildInput("tiktok", ["u"], {})).toMatchObject({ productUrls: ["u"] });
    expect(actorFor("tiktok", {})).toBe("kulqiz~tiktok-shop-scraper");
    expect(actorFor("tiktok", { APIFY_ACTOR_TIKTOK: "me/other-actor" })).toBe("me~other-actor");
  });

  it("matches a result to its link: Shopee item id, Tokopedia path, TikTok product id", () => {
    expect(keyOfUrl("shopee", "https://shopee.co.id/Name-i.111.987654321?sp_atk=x")).toBe("987654321");
    expect(keyOfUrl("tokopedia", "https://www.tokopedia.com/Shop/Product-Name/?x=1")).toBe("/shop/product-name");
    expect(keyOfUrl("tiktok", "https://shop-id.tokopedia.com/pdp/some-name/1729653353364556550")).toBe("1729653353364556550");
  });

  it("reads the price fields of each actor", () => {
    expect(parseItem("shopee", { itemId: 987654321, priceMin: 4500000, originalPrice: 5000000, totalSales: 120, ratingAverage: 4.9, name: "AC", shopName: "Rival" }))
      .toMatchObject({ key: "987654321", price: 4500000, original: 5000000, sold: 120, rating: 4.9, title: "AC", shop: "Rival" });
    expect(parseItem("shopee", { itemId: 1, priceMin: 450000000000 }).price).toBe(4500000);   // Shopee's x100,000 money unit
    expect(parseItem("tokopedia", { url: "https://www.tokopedia.com/s/p", priceInt: 123000, price: "Rp123.000", rating: "4.8" }))
      .toMatchObject({ key: "/s/p", price: 123000, rating: 4.8 });
    expect(parseItem("tokopedia", { url: "https://www.tokopedia.com/s/p", price: "Rp1.250.000" }).price).toBe(1250000);
    expect(parseItem("tiktok", { product_id: "1729653353364556550", sale_price_value: 99000, origin_price: "Rp120.000", sold_count: 33, shop_name: "X" }))
      .toMatchObject({ key: "1729653353364556550", price: 99000, original: 120000, sold: 33, shop: "X" });
  });

  it("turns an actor log into a short hint without any cookie value", () => {
    const log = ["2026-10-27T07:00:00.000Z INFO  Starting", "2026-10-27T07:00:01.000Z WARN  Login required: cookie SPC_EC=abcdef123456 is not valid", "2026-10-27T07:00:02.000Z INFO  Done, 0 results"].join("\n");
    const h = logHint(log);
    expect(h).toMatch(/Login required/);
    expect(h).not.toMatch(/abcdef123456/);
    expect(logHint("")).toBe("");
  });

  it("tells a logged-in Shopee cookie from a visitor cookie", () => {
    expect(shopeeCookieLooksLoggedIn("SPC_F=1; SPC_EC=xyz; SPC_ST=abc")).toBe(true);
    expect(shopeeCookieLooksLoggedIn("SPC_R_T_IV=1; SPC_T_ID=2; SPC_SI=3")).toBe(false);
    expect(shopeeCookieLooksLoggedIn(undefined)).toBe(false);
  });

  it("estimates the Apify cost", () => {
    expect(estimateCost({ shopee: 100, tokopedia: 100, tiktok: 100 })).toBeCloseTo(1.6, 5);
    expect(estimateCost({})).toBe(0);
  });
});
