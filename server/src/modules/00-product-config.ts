import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { can } from "../middleware/auth";
import { ah, parse } from "../lib/http";
import { badRequest } from "../lib/errors";
import { audit } from "../services/audit";
import {
  featureForPath,
  readProductConfig,
  productConfigDto,
} from "../services/product-config";
import type { ModuleDef } from "../app";
const router = Router();
// Mounted first, after host authentication; disabled modules cannot be called through direct APIs.
router.use(
  ah(async (req, res, next) => {
    const key = featureForPath(req.path);
    if (key) {
      const c = await readProductConfig();
      if (!c.features[key]) {
        res
          .status(403)
          .json({
            error: "This feature is disabled for this company.",
            feature: key,
          });
        return;
      }
    }
    if (
      /^\/products(?:\/\d+)?$/.test(req.path.toLowerCase()) &&
      ["POST", "PUT", "PATCH"].includes(req.method) &&
      req.body
    ) {
      const c = await readProductConfig();
      if (!c.features.vehicleCompatibility && req.body.vehicles !== undefined)
        throw badRequest("Compatibility is switched off for this company.");
      if (
        !c.features.partNumbers &&
        (req.body.partNumbers !== undefined || req.body.oemNumber !== undefined)
      )
        throw badRequest("Part numbers are switched off for this company.");
    }
    next();
  }),
);
router.get(
  "/product-config",
  ah(async (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await productConfigDto());
  }),
);
const short = z.string().trim().max(200);
const schema = z
  .object({
    company: z
      .object({
        name: short.min(1),
        address: z.string().trim().max(1000),
        phone: short,
        email: z.union([z.literal(""), z.string().trim().email().max(200)]),
        trn: short,
        country: short,
      })
      .strict(),
    appName: short.min(1),
    productLabel: short.min(1).max(40),
    compatibilityLabel: short.min(1).max(80),
    industry: z.enum(["equipment", "spare-parts", "general"]),
    features: z
      .object({
        partNumbers: z.boolean(),
        vehicleCompatibility: z.boolean(),
        amc: z.boolean(),
        hr: z.boolean(),
        serialTracking: z.boolean(),
        assistant: z.boolean(),
        productImages: z.boolean(),
      })
      .strict(),
  })
  .strict();
router.put(
  "/product-config",
  can("settings", "edit"),
  ah(async (req, res) => {
    const b = parse(schema, req.body);
    const before = await readProductConfig();
    const company = await prisma.company.findFirst({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });
    if (!company)
      throw badRequest(
        "Create the company master before configuring this deployment.",
      );
    await prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: b.company });
      const values: Record<string, string> = {
        "app.name": b.appName,
        "app.productLabel": b.productLabel,
        "app.compatibilityLabel": b.compatibilityLabel,
        "app.industry": b.industry,
      };
      for (const [k, v] of Object.entries(b.features))
        values["features." + k] = String(v);
      for (const [key, value] of Object.entries(values))
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      await audit(tx, req.user, "UPDATE", "CompanyConfiguration", company.id, {
        before: {
          company: before.company,
          features: before.features,
          appName: before.appName,
          industry: before.industry,
          productLabel: before.productLabel,
          compatibilityLabel: before.compatibilityLabel,
        },
        after: b,
      });
    });
    res.json(await productConfigDto());
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
router.post(
  "/product-config/logo",
  can("settings", "edit"),
  (req, res, next) =>
    upload.single("file")(req, res, (err: unknown) =>
      next(
        err ? badRequest("Choose one JPEG, PNG or WebP up to 5 MB") : undefined,
      ),
    ),
  ah(async (req, res) => {
    if (!req.file) throw badRequest("Choose a company logo");
    let png: Buffer;
    try {
      const image = sharp(req.file.buffer, { limitInputPixels: 40000000 });
      const m = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(m.format ?? "")) throw Error();
      png = await image
        .rotate()
        .resize({
          width: 600,
          height: 240,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    } catch {
      throw badRequest("Choose a valid JPEG, PNG or WebP logo");
    }
    const file = randomUUID() + ".png",
      directory = path.resolve(env.uploadDir, "company-brand");
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, file);
    await fs.writeFile(target, png, { flag: "wx" });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: "branding.logoFile" },
          create: { key: "branding.logoFile", value: file },
          update: { value: file },
        });
        const company = await tx.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
        if (company) await tx.company.update({ where: { id: company.id }, data: { logo: null } });
        await audit(
          tx,
          req.user,
          "UPDATE_LOGO",
          "CompanyConfiguration",
          undefined,
          { fileName: file },
        );
      });
    } catch (e) {
      await fs.rm(target, { force: true });
      throw e;
    }
    res.json(await productConfigDto());
  }),
);
router.delete(
  "/product-config/logo",
  can("settings", "edit"),
  ah(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: "branding.logoFile" },
        create: { key: "branding.logoFile", value: "" },
        update: { value: "" },
      });
      const company = await tx.company.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
      if (company) await tx.company.update({ where: { id: company.id }, data: { logo: '' } });
      await audit(tx, req.user, "REMOVE_LOGO", "CompanyConfiguration");
    });
    res.json(await productConfigDto());
  }),
);
export default [{ path: "/", router }] satisfies ModuleDef[];
