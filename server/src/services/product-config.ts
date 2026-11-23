import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";

export const featureDefaults = {
  partNumbers: true,
  vehicleCompatibility: true,
  amc: true,
  hr: true,
  serialTracking: true,
  assistant: true,
  productImages: true,
};
export type FeatureKey = keyof typeof featureDefaults;
export async function readProductConfig() {
  const [company, rows] = await Promise.all([
    prisma.company.findFirst({
      where: { isActive: true },
      orderBy: { id: "asc" },
    }),
    prisma.systemSetting.findMany({
      where: {
        OR: [
          { key: { startsWith: "features." } },
          { key: { startsWith: "app." } },
          { key: "branding.logoFile" },
        ],
      },
    }),
  ]);
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const features = Object.fromEntries(
    Object.entries(featureDefaults).map(([k, v]) => [
      k,
      settings["features." + k] === undefined
        ? v
        : settings["features." + k] === "true",
    ]),
  ) as typeof featureDefaults;
  return {
    company,
    features,
    appName: settings["app.name"] || "Business ERP",
    productLabel: settings["app.productLabel"] || "Product",
    compatibilityLabel:
      settings["app.compatibilityLabel"] || "Equipment Compatibility",
    industry: settings["app.industry"] || "equipment",
    logoFile: settings["branding.logoFile"],
  };
}
export async function readCompanyLogo(
  config?: Awaited<ReturnType<typeof readProductConfig>>,
) {
  const c = config ?? (await readProductConfig());
  if (c.company?.logo === "") return null;
  if (c.company?.logo) {
    const match = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(c.company.logo);
    if (match) {
      const image = Buffer.from(match[1], "base64");
      const name = createHash("sha256").update(image).digest("hex") + ".png";
      const directory = path.resolve(env.uploadDir, "company-brand");
      const file = path.join(directory, name);
      try {
        return { file, data: await fs.readFile(file) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const data = await sharp(image, { limitInputPixels: 20_000_000 }).resize({ width: 1000, height: 500, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      await fs.mkdir(directory, { recursive: true });
      try { await fs.writeFile(file, data, { flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      return { file, data };
    }
  }
  let file: string | undefined;
  if (c.logoFile && /^[a-f0-9-]+\.png$/i.test(c.logoFile))
    file = path.resolve(env.uploadDir, "company-brand", c.logoFile);
  else if (c.logoFile !== "" && /fortune\s*7/i.test(c.company?.name ?? ""))
    {
    const demo = await prisma.systemSetting.findUnique({where:{key:'demo.fortune7.activity.v1'}});
    if (demo) file = path.resolve(__dirname, "../../assets/brand/fortune7-logo.jpeg");
  }
  if (!file) return null;
  try {
    return { file, data: await fs.readFile(file) };
  } catch {
    return null;
  }
}
export async function productConfigDto() {
  const c = await readProductConfig(),
    logo = await readCompanyLogo(c);
  const mime = logo?.file.endsWith(".png") ? "image/png" : "image/jpeg";
  return {
    company: c.company,
    features: c.features,
    appName: c.appName,
    productLabel: c.productLabel,
    compatibilityLabel: c.compatibilityLabel,
    industry: c.industry,
    logoDataUri: logo
      ? "data:" + mime + ";base64," + logo.data.toString("base64")
      : null,
  };
}
export function featureForPath(p: string): FeatureKey | undefined {
  p = p.toLowerCase();
  if (/^\/amc(?:\/|$)/.test(p)) return "amc";
  if (/^\/hr(?:\/|$)/.test(p)) return "hr";
  if (/^\/equipment-units(?:\/|$)/.test(p)) return "serialTracking";
  if (/^\/assistant(?:\/|$)/.test(p)) return "assistant";
  if (
    /^\/products\/(?:by-vehicle|vehicle-makes|vehicle-models)(?:\/|$)/.test(p)
  )
    return "vehicleCompatibility";
  if (/^\/products\/\d+\/photo(?:\/|$)/.test(p)) return "productImages";
}
