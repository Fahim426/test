import "dotenv/config";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";
import { ACCOUNTS } from "../src/services/deployment-accounts";
import { DOC_DEFAULTS } from "../src/services/numbering";
import { ACTIONS, PERMISSION_MODULES } from "../src/lib/permissions";
const db = new PrismaClient();
const schema = z
  .object({
    company: z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      country: z.string().default("United Arab Emirates"),
      baseCurrency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .default("AED"),
      address: z.string().default(""),
      phone: z.string().default(""),
      email: z.string().email().or(z.literal("")).default(""),
      trn: z.string().default(""),
    }),
    appName: z.string().min(1),
    industry: z
      .enum(["equipment", "spare-parts", "general"])
      .default("general"),
    vatRate: z.number().min(0).max(100),
    adminUsername: z.string().min(3).default("admin"),
  })
  .strict();
async function main() {
  // Refuse all non-empty databases. There is deliberately no reset, overwrite or force option.
  for (const model of Prisma.dmmf.datamodel.models) {
    const key = model.name[0].toLowerCase() + model.name.slice(1);
    if (await (db as any)[key].count())
      throw Error(
        "Refusing setup: database is not empty (" +
          model.name +
          "). Existing demo/customer data was not changed.",
      );
  }
  const configPath = process.argv[process.argv.indexOf("--config") + 1];
  if (!process.argv.includes("--config") || !configPath)
    throw Error(
      "Pass --config <customer.json> pointing to a reviewed deployment configuration.",
    );
  const c = schema.parse(JSON.parse(fs.readFileSync(configPath, "utf8"))),
    password = process.env.CUSTOMER_ADMIN_PASSWORD;
  if (!password || password.length < 12)
    throw Error(
      "Set CUSTOMER_ADMIN_PASSWORD to a unique password of at least 12 characters.",
    );
  const hash = await bcrypt.hash(password, 12);
  await db.$transaction(
    async (tx) => {
      const role = await tx.role.create({
        data: {
          name: "Admin",
          description: "Deployment administrator",
          isSystem: true,
        },
      });
      await tx.rolePermission.createMany({
        data: PERMISSION_MODULES.flatMap((module) =>
          ACTIONS.map((action) => ({ roleId: role.id, module, action })),
        ),
      });
      await tx.user.create({
        data: {
          username: c.adminUsername,
          fullName: "System Administrator",
          passwordHash: hash,
          roleId: role.id,
        },
      });
      await tx.company.create({ data: c.company });
      const branch = await tx.branch.create({
        data: { code: "MAIN", name: "Main Branch" },
      });
      await tx.warehouse.create({
        data: { code: "MAIN", name: "Main Warehouse", branchId: branch.id },
      });
      await tx.currency.create({
        data: {
          code: c.company.baseCurrency,
          name: c.company.baseCurrency,
          rate: 1,
          isBase: true,
        },
      });
      await tx.vatCode.createMany({
        data: [
          {
            code: "STANDARD",
            name: "Standard rate",
            rate: c.vatRate,
            category: "TAXABLE",
            isDefault: true,
          },
          { code: "ZERO", name: "Zero rated", rate: 0, category: "ZERO_RATED" },
        ],
      });
      await tx.unit.createMany({
        data: [
          { code: "PCS", name: "Pieces" },
          { code: "SET", name: "Set" },
        ],
      });
      await tx.paymentTerm.createMany({
        data: [
          { code: "COD", name: "Cash on Delivery", days: 0 },
          { code: "NET30", name: "Net 30", days: 30 },
        ],
      });
      const ids: Record<string, number> = {};
      for (const a of ACCOUNTS) {
        const r = await tx.account.create({
          data: {
            code: a.code,
            name: a.name,
            type: a.type,
            isGroup: !!a.group,
            systemKey: a.key,
            isBank: !!a.bank,
            parentId: a.parent ? ids[a.parent] : null,
          },
        });
        ids[a.code] = r.id;
      }
      await tx.documentNumbering.createMany({
        data: Object.entries(DOC_DEFAULTS).map(([docType, prefix]) => ({
          docType,
          prefix,
        })),
      });
      const equipment = c.industry === "equipment",
        parts = c.industry === "spare-parts";
      const flags = {
        partNumbers: parts,
        vehicleCompatibility: parts,
        amc: equipment,
        hr: true,
        serialTracking: equipment,
        assistant: true,
        productImages: true,
      };
      const settings: Record<string, string> = {
        "app.name": c.appName,
        "app.industry": c.industry,
        "app.productLabel": equipment ? "Machine" : parts ? "Part" : "Product",
        "app.compatibilityLabel": parts
          ? "Vehicle Compatibility"
          : "Equipment Compatibility",
        "branding.logoFile": "",
      };
      for (const [k, v] of Object.entries(flags))
        settings["features." + k] = String(v);
      await tx.systemSetting.createMany({
        data: Object.entries(settings).map(([key, value]) => ({ key, value })),
      });
    },
    { timeout: 60000 },
  );
  console.log(
    "Customer setup complete: company, admin, main branch/warehouse and empty core masters. No sample products, transactions or demo records were created. Review VAT, chart of accounts, numbering, approvals and user roles before go-live.",
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
