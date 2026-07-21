/**
 * Multi-cloud Object Storage pool manager.
 *
 * Yandex default quota: 25 buckets per cloud (storage.buckets.count).
 * When a pool approaches its soft limit we provision a new cloud + folder +
 * service account + static access keys, then continue creating buckets there.
 *
 * Required for auto-create:
 *   YC_ORG_ID, YC_BILLING_ACCOUNT_ID, YC_SERVICE_ACCOUNT_KEY
 * Bootstrap (first pool) from existing:
 *   YC_KEY_ID, YC_SECRET, YC_FOLDER_ID, optional YC_CLOUD_ID
 */
import {
  S3Client,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import { db } from "./db";
import { ycStoragePools, type YcStoragePool } from "@shared/schema";
import { eq, asc, sql } from "drizzle-orm";
import { ycApi, waitOperation } from "./yc-iam";

const DEFAULT_SOFT_LIMIT = Math.max(
  5,
  Math.min(24, Number(process.env.YC_BUCKETS_PER_CLOUD || 20) || 20),
);

export type StoragePool = YcStoragePool;

const s3Cache = new Map<number, S3Client>();

export function getPoolS3Client(pool: Pick<StoragePool, "id" | "accessKeyId" | "secretAccessKey">): S3Client {
  let client = s3Cache.get(pool.id);
  if (client) return client;
  client = new S3Client({
    region: "ru-central1",
    endpoint: "https://storage.yandexcloud.net",
    credentials: {
      accessKeyId: pool.accessKeyId,
      secretAccessKey: pool.secretAccessKey,
    },
  });
  s3Cache.set(pool.id, client);
  return client;
}

async function countBuckets(pool: StoragePool): Promise<number> {
  try {
    const client = getPoolS3Client(pool);
    const out = await client.send(new ListBucketsCommand({}));
    return (out.Buckets || []).length;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[YC-POOL] listBuckets failed for pool ${pool.id}: ${msg}`);
    return pool.bucketCount;
  }
}

async function refreshPoolCount(pool: StoragePool): Promise<StoragePool> {
  const count = await countBuckets(pool);
  const status = count >= pool.bucketLimit ? "full" : "active";
  const [updated] = await db
    .update(ycStoragePools)
    .set({ bucketCount: count, status, updatedAt: new Date() })
    .where(eq(ycStoragePools.id, pool.id))
    .returning();
  return updated || { ...pool, bucketCount: count, status };
}

export async function ensurePrimaryPoolBootstrapped(): Promise<StoragePool> {
  const existing = await db.select().from(ycStoragePools).orderBy(asc(ycStoragePools.id)).limit(1);
  if (existing[0]) return existing[0];

  const keyId = process.env.YC_KEY_ID || "";
  const secret = process.env.YC_SECRET || "";
  const folderId = process.env.YC_FOLDER_ID || "unknown";
  const cloudId = process.env.YC_CLOUD_ID || "primary";
  if (!keyId || !secret) {
    throw new Error("YC_KEY_ID / YC_SECRET не настроены");
  }

  const [row] = await db
    .insert(ycStoragePools)
    .values({
      name: "craft-primary",
      cloudId,
      folderId,
      accessKeyId: keyId,
      secretAccessKey: secret,
      bucketCount: 0,
      bucketLimit: DEFAULT_SOFT_LIMIT,
      status: "active",
    })
    .returning();

  console.log(`[YC-POOL] bootstrapped primary pool #${row.id} (limit=${DEFAULT_SOFT_LIMIT})`);
  return refreshPoolCount(row);
}

function canAutoProvision(): boolean {
  return !!(
    process.env.YC_ORG_ID &&
    process.env.YC_BILLING_ACCOUNT_ID &&
    process.env.YC_SERVICE_ACCOUNT_KEY
  );
}

let provisionLock: Promise<StoragePool> | null = null;

async function provisionNewCloudPool(): Promise<StoragePool> {
  if (provisionLock) return provisionLock;
  provisionLock = (async () => {
    try {
      return await provisionNewCloudPoolUnlocked();
    } finally {
      provisionLock = null;
    }
  })();
  return provisionLock;
}

async function provisionNewCloudPoolUnlocked(): Promise<StoragePool> {
  const orgId = process.env.YC_ORG_ID!;
  const billingId = process.env.YC_BILLING_ACCOUNT_ID!;
  const stamp = Date.now().toString(36).slice(-6);
  const cloudName = `craft-sites-${stamp}`;
  const folderName = `sites`;
  const saName = `craft-storage-${stamp}`;

  console.log(`[YC-POOL] provisioning new cloud "${cloudName}" in org ${orgId}…`);

  // 1. Create cloud
  const cloudOp = await ycApi<{ id: string }>(
    "POST",
    "https://resource-manager.api.cloud.yandex.net/resource-manager/v1/clouds",
    { organizationId: orgId, name: cloudName, description: "Craft AI sites storage pool (auto)" },
  );
  const cloud = await waitOperation<{ id: string; name?: string }>(cloudOp.id);
  const cloudId = cloud.id;
  if (!cloudId) throw new Error("Cloud create returned no id");
  console.log(`[YC-POOL] cloud created: ${cloudId}`);

  // 2. Bind billing
  const bindOp = await ycApi<{ id: string }>(
    "POST",
    `https://billing.api.cloud.yandex.net/billing/v1/billingAccounts/${billingId}/billableObjectBindings`,
    { billableObject: { id: cloudId, type: "cloud" } },
  );
  if (bindOp?.id) {
    await waitOperation(bindOp.id);
  }
  console.log(`[YC-POOL] billing bound to ${billingId}`);

  // 3. Create folder
  const folderOp = await ycApi<{ id: string }>(
    "POST",
    "https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders",
    { cloudId, name: folderName, description: "Object Storage for published Craft AI sites" },
  );
  const folder = await waitOperation<{ id: string }>(folderOp.id);
  const folderId = folder.id;
  if (!folderId) throw new Error("Folder create returned no id");
  console.log(`[YC-POOL] folder created: ${folderId}`);

  // 4. Service account
  const saOp = await ycApi<{ id: string }>(
    "POST",
    "https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts",
    { folderId, name: saName, description: "Object Storage admin for Craft AI pool" },
  );
  const sa = await waitOperation<{ id: string }>(saOp.id);
  const saId = sa.id;
  if (!saId) throw new Error("Service account create returned no id");
  console.log(`[YC-POOL] SA created: ${saId}`);

  // 5. Grant storage.admin on the folder
  const roleOp = await ycApi<{ id: string }>(
    "POST",
    `https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders/${folderId}:updateAccessBindings`,
    {
      accessBindingDeltas: [
        {
          action: "ADD",
          accessBinding: {
            roleId: "storage.admin",
            subject: { id: saId, type: "serviceAccount" },
          },
        },
      ],
    },
  );
  if (roleOp?.id) await waitOperation(roleOp.id);

  // 6. Static access key (S3)
  const keyRes = await ycApi<{
    accessKey?: { keyId?: string };
    secret?: string;
  }>("POST", "https://iam.api.cloud.yandex.net/iam/aws-compatibility/v1/accessKeys", {
    serviceAccountId: saId,
    description: "Craft AI Object Storage pool key",
  });
  const accessKeyId = keyRes.accessKey?.keyId;
  const secretAccessKey = keyRes.secret;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Access key create returned no keyId/secret");
  }

  const [row] = await db
    .insert(ycStoragePools)
    .values({
      name: cloudName,
      cloudId,
      folderId,
      accessKeyId,
      secretAccessKey,
      bucketCount: 0,
      bucketLimit: DEFAULT_SOFT_LIMIT,
      status: "active",
    })
    .returning();

  console.log(`[YC-POOL] new pool #${row.id} ready (cloud=${cloudId}, limit=${DEFAULT_SOFT_LIMIT})`);
  return row;
}

/**
 * Pick a pool with enough free bucket slots. Creates a new cloud when all
 * pools are full and auto-provision credentials are configured.
 */
export async function acquireStoragePool(slotsNeeded = 1): Promise<StoragePool> {
  await ensurePrimaryPoolBootstrapped();

  const pools = await db.select().from(ycStoragePools).orderBy(asc(ycStoragePools.id));
  for (const pool of pools) {
    if (pool.status === "error") continue;
    const fresh = await refreshPoolCount(pool);
    if (fresh.bucketCount + slotsNeeded <= fresh.bucketLimit) {
      return fresh;
    }
  }

  if (!canAutoProvision()) {
    throw new Error(
      "Все облака Object Storage заполнены (квота бакетов). " +
        "Настройте YC_ORG_ID, YC_BILLING_ACCOUNT_ID и YC_SERVICE_ACCOUNT_KEY " +
        "для автосоздания нового облака, либо увеличьте квоту storage.buckets.count.",
    );
  }

  // Serialize provisioning — only one new cloud at a time.
  return provisionNewCloudPool();
}

export async function getStoragePoolById(id: number | null | undefined): Promise<StoragePool | null> {
  if (!id) return null;
  const [row] = await db.select().from(ycStoragePools).where(eq(ycStoragePools.id, id)).limit(1);
  return row || null;
}

export async function bumpPoolBucketCount(poolId: number, delta: number): Promise<void> {
  await db
    .update(ycStoragePools)
    .set({
      bucketCount: sql`GREATEST(0, ${ycStoragePools.bucketCount} + ${delta})`,
      updatedAt: new Date(),
    })
    .where(eq(ycStoragePools.id, poolId));
}

export async function resolvePoolForProject(opts: {
  ycStoragePoolId?: number | null;
}): Promise<StoragePool> {
  if (opts.ycStoragePoolId) {
    const existing = await getStoragePoolById(opts.ycStoragePoolId);
    if (existing) return existing;
  }
  return acquireStoragePool(1);
}
